import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const CONFIG_DIR = process.env.SFTP_CONFIG_DIR || '/config';
const CONFIG_FILE = path.join(CONFIG_DIR, 'sftp.json');
const PASSWORD_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

function isDockerInternalHost(host) {
  const h = host.trim().toLowerCase();
  if (!h || h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0') return true;
  if (/^192\.168\.65\./.test(h)) return true;
  if (/^172\.17\./.test(h) || /^172\.18\./.test(h)) return true;
  return false;
}

function rankLanIp(ip) {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip) || isDockerInternalHost(ip)) return -1;
  if (/^192\.168\.(?!65\.)/.test(ip)) return 100;
  if (/^10\./.test(ip)) return 80;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return 60;
  return 10;
}

function pickBest(candidates) {
  const best = [...new Set(candidates)]
    .map((ip) => ({ ip, rank: rankLanIp(ip) }))
    .filter((x) => x.rank >= 0)
    .sort((a, b) => b.rank - a.rank)[0];
  return best?.ip ?? null;
}

function interfaceIps() {
  const out = [];
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) out.push(iface.address);
    }
  }
  return out;
}

function ipsFromIpRoute() {
  const out = [];
  try {
    const src = execSync(
      "ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i=1;i<=NF;i++) if ($i==\"src\") print $(i+1)}'",
      { encoding: 'utf8', timeout: 3000 },
    ).trim();
    if (src) out.push(src);
  } catch {
    /* ignore */
  }
  try {
    const lines = execSync(
      "ip -4 -o addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1",
      { encoding: 'utf8', timeout: 3000 },
    );
    for (const line of lines.split('\n')) {
      const ip = line.trim();
      if (ip) out.push(ip);
    }
  } catch {
    /* ignore */
  }
  return out;
}

async function localIpViaUdp() {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '8.8.8.8', port: 53 });
    const finish = (ip) => {
      socket.destroy();
      resolve(ip);
    };
    socket.setTimeout(2000, () => finish(null));
    socket.on('connect', () => {
      const addr = socket.address();
      finish(typeof addr === 'object' && addr.address ? addr.address : null);
    });
    socket.on('error', () => finish(null));
  });
}

async function detectMachineLanIp() {
  const candidates = [...interfaceIps(), ...ipsFromIpRoute()];
  const udp = await localIpViaUdp();
  if (udp) candidates.push(udp);
  for (const name of ['host.docker.internal', 'gateway.docker.internal']) {
    try {
      const { address } = await dns.lookup(name, { family: 4 });
      if (address && !isDockerInternalHost(address)) candidates.push(address);
    } catch {
      /* ignore */
    }
  }
  const best = pickBest(candidates);
  if (best && !isDockerInternalHost(best)) return best;

  const viaWeb = await discoverHostViaWebPort();
  if (viaWeb) return viaWeb;

  return best ?? '';
}

function lanSubnetsFromRoutes() {
  const subnets = [];
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

function hostsFromCidr(cidr) {
  const [base, prefixStr] = cidr.split('/');
  const prefix = Number(prefixStr);
  if (!base || !Number.isFinite(prefix)) return [];
  const parts = base.split('.').map(Number);
  if (parts.length !== 4) return [];
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  const baseNum =
    ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
  const first = (baseNum & mask) + 1;
  const last = (baseNum | ~mask) - 1;
  const hosts = [];
  const count = Math.min(last - first + 1, 254);
  for (let i = 0; i < count; i++) {
    const n = first + i;
    hosts.push(
      `${(n >>> 24) & 255}.${(n >>> 16) & 255}.${(n >>> 8) & 255}.${n & 255}`,
    );
  }
  return hosts;
}

function probeTcpPort(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.on('connect', () => done(true));
    socket.on('error', () => done(false));
  });
}

async function discoverHostViaWebPort() {
  const port = Number(process.env.PORT || 4321);
  const hosts = [];
  for (const cidr of lanSubnetsFromRoutes()) {
    hosts.push(...hostsFromCidr(cidr));
  }
  const unique = [...new Set(hosts)].filter((ip) => !isDockerInternalHost(ip));
  for (let i = 0; i < unique.length; i += 40) {
    const batch = unique.slice(i, i + 40);
    const hits = await Promise.all(
      batch.map(async (ip) => ((await probeTcpPort(ip, port, 150)) ? ip : null)),
    );
    const found = hits.find((h) => h !== null);
    if (found) return found;
  }
  return null;
}

function randomPassword(len = 20) {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += PASSWORD_CHARS[bytes[i] % PASSWORD_CHARS.length];
  return out;
}

function randomPort() {
  return 20000 + crypto.randomInt(40000);
}

function siteHostname() {
  const env = process.env.SITE_HOSTNAME?.trim().toLowerCase();
  return env && env.endsWith('.local') ? env : 'teslacam.local';
}

async function main() {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  const host = siteHostname();

  if (fs.existsSync(CONFIG_FILE)) {
    const data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    if (data.host !== host) {
      data.host = host;
      fs.writeFileSync(CONFIG_FILE, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
      console.log(`Updated SFTP host to ${host}`);
      return;
    }
    console.log(`SFTP credentials OK (host=${data.host})`);
    return;
  }

  const creds = {
    host,
    port: randomPort(),
    username: process.env.SFTP_USER?.trim() || 'teslacam',
    password: randomPassword(20),
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(CONFIG_FILE, `${JSON.stringify(creds, null, 2)}\n`, { mode: 0o600 });
  console.log(`Generated SFTP credentials: host=${host} port=${creds.port} user=${creds.username}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
