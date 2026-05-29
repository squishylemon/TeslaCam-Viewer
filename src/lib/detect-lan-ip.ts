import { execSync } from 'node:child_process';
import dns from 'node:dns/promises';
import net from 'node:net';
import os from 'node:os';

/** Addresses that are not useful for LAN SFTP clients. */
export function isDockerInternalHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  if (!h || h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0') return true;
  if (h === 'host.docker.internal' || h === 'gateway.docker.internal') return true;
  if (/^192\.168\.65\./.test(h)) return true;
  if (/^172\.17\./.test(h)) return true;
  if (/^172\.18\./.test(h)) return true;
  return false;
}

/** Hostname from the browser URL (e.g. 192.168.50.189 when opened on your LAN). */
export function hostFromRequest(requestHostname?: string): string | null {
  const raw = requestHostname?.trim().toLowerCase();
  if (!raw || raw === 'localhost' || raw === '127.0.0.1') return null;
  if (isDockerInternalHost(raw)) return null;
  if (isIpv4(raw)) return raw;
  if (/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i.test(raw)) return raw;
  return null;
}

function isIpv4(host: string): boolean {
  const parts = host.trim().split('.');
  if (parts.length !== 4) return false;
  return parts.every((p) => {
    const n = Number(p);
    return Number.isInteger(n) && n >= 0 && n <= 255;
  });
}

function rankLanIp(ip: string): number {
  if (!isIpv4(ip) || isDockerInternalHost(ip)) return -1;
  if (/^192\.168\.(?!65\.)/.test(ip)) return 100;
  if (/^10\./.test(ip)) return 80;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return 60;
  return 10;
}

function pickBestLanIp(candidates: string[]): string | null {
  const best = [...new Set(candidates)]
    .map((ip) => ({ ip, rank: rankLanIp(ip) }))
    .filter((x) => x.rank >= 0)
    .sort((a, b) => b.rank - a.rank)[0];
  return best?.ip ?? null;
}

function interfaceIps(): string[] {
  const out: string[] = [];
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        out.push(iface.address);
      }
    }
  }
  return out;
}

async function localIpViaUdpAsync(): Promise<string | null> {
  try {
    return await new Promise<string | null>((resolve) => {
      const socket = net.createConnection({ host: '8.8.8.8', port: 53 });
      const finish = (ip: string | null) => {
        socket.destroy();
        resolve(ip);
      };
      socket.setTimeout(2000, () => finish(null));
      socket.on('connect', () => {
        const addr = socket.address();
        finish(typeof addr === 'object' && 'address' in addr ? addr.address : null);
      });
      socket.on('error', () => finish(null));
    });
  } catch {
    return null;
  }
}

function ipsFromIpRoute(): string[] {
  const out: string[] = [];
  try {
    const raw = execSync("ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i=1;i<=NF;i++) if ($i==\"src\") print $(i+1)}'", {
      encoding: 'utf8',
      timeout: 3000,
    });
    const src = raw.trim();
    if (src) out.push(src);
  } catch {
    /* no ip command */
  }
  try {
    const addrs = execSync(
      "ip -4 -o addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1",
      { encoding: 'utf8', timeout: 3000 },
    );
    for (const line of addrs.split('\n')) {
      const ip = line.trim();
      if (ip) out.push(ip);
    }
  } catch {
    /* ignore */
  }
  return out;
}

/** Subnets routed on this machine (e.g. 192.168.50.0/24), excluding Docker Desktop VM. */
function lanSubnetsFromRoutes(): string[] {
  const subnets: string[] = [];
  try {
    const raw = execSync('ip -4 route show 2>/dev/null', { encoding: 'utf8', timeout: 3000 });
    for (const line of raw.split('\n')) {
      const m = line.match(/^(\d+\.\d+\.\d+\.\d+)\/(\d+)\s/);
      if (!m) continue;
      const [, base, prefix] = m;
      const p = Number(prefix);
      if (p < 16 || p > 24) continue;
      if (/^192\.168\.65\./.test(base)) continue;
      if (/^172\.(1[7-9]|2[0-9]|3[01])\./.test(base)) continue;
      if (/^192\.168\./.test(base) || /^10\./.test(base)) subnets.push(`${base}/${prefix}`);
    }
  } catch {
    /* ignore */
  }
  return subnets;
}

function hostsFromCidr(cidr: string): string[] {
  const [base, prefixStr] = cidr.split('/');
  const prefix = Number(prefixStr);
  if (!base || !Number.isFinite(prefix) || prefix < 16 || prefix > 24) return [];
  const parts = base.split('.').map(Number);
  if (parts.length !== 4) return [];
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  const baseNum =
    ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
  const first = (baseNum & mask) + 1;
  const last = (baseNum | ~mask) - 1;
  const hosts: string[] = [];
  const maxHosts = Math.min(last - first + 1, 254);
  for (let i = 0; i < maxHosts; i++) {
    const n = first + i;
    hosts.push(
      `${(n >>> 24) & 255}.${(n >>> 16) & 255}.${(n >>> 8) & 255}.${n & 255}`,
    );
  }
  return hosts;
}

function probeTcpPort(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.on('connect', () => done(true));
    socket.on('error', () => done(false));
  });
}

/** Find the machine publishing the web UI (Docker Desktop forwards 4321 to the host). */
async function discoverHostViaWebPort(): Promise<string | null> {
  const port = Number(process.env.PORT || process.env.WEB_PORT || 4321);
  const subnets = lanSubnetsFromRoutes();
  const candidates: string[] = [];
  for (const cidr of subnets) {
    candidates.push(...hostsFromCidr(cidr));
  }
  const unique = [...new Set(candidates)].filter((ip) => !isDockerInternalHost(ip));
  const batchSize = 40;
  for (let i = 0; i < unique.length; i += batchSize) {
    const batch = unique.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (ip) => ((await probeTcpPort(ip, port, 120)) ? ip : null)),
    );
    const hit = results.find((r) => r !== null);
    if (hit) return hit;
  }
  return null;
}

async function resolveDockerInternalHost(): Promise<string | null> {
  for (const name of ['host.docker.internal', 'gateway.docker.internal']) {
    try {
      const { address } = await dns.lookup(name, { family: 4 });
      if (address && !isDockerInternalHost(address)) return address;
    } catch {
      /* not resolvable */
    }
  }
  return null;
}

/**
 * Best-effort LAN IPv4 of the machine running this process.
 * Works when the process uses the host network namespace (Linux server or Docker Desktop host networking).
 */
export async function detectMachineLanIp(): Promise<string> {
  const candidates: string[] = [
    ...interfaceIps(),
    ...ipsFromIpRoute(),
  ];

  const udp = await localIpViaUdpAsync();
  if (udp) candidates.push(udp);

  const dockerHost = await resolveDockerInternalHost();
  if (dockerHost) candidates.push(dockerHost);

  let best = pickBestLanIp(candidates);
  if (best && !isDockerInternalHost(best)) return best;

  const viaWeb = await discoverHostViaWebPort();
  if (viaWeb) return viaWeb;

  return best ?? '';
}
