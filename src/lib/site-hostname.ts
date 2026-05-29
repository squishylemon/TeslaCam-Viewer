import { isDockerInternalHost } from './detect-lan-ip';

const DEFAULT_HOSTNAME = 'teslacam.local';

/** From config.env — your PC's LAN IPv4 (required). */
export function getConfiguredLanIp(): string | null {
  const ip = process.env.LAN_IP?.trim();
  if (!ip) return null;
  if (!isIpv4Hostname(ip) || isDockerInternalHost(ip)) return null;
  return ip;
}

export function requireConfiguredLanIp(): string {
  const ip = getConfiguredLanIp();
  if (!ip) {
    throw new Error(
      'LAN_IP is not set in config.env. Copy config.env.example to config.env and set your machine IP (ipconfig).',
    );
  }
  return ip;
}

export function getSiteHostname(): string {
  const env = process.env.SITE_HOSTNAME?.trim().toLowerCase();
  if (env && env.endsWith('.local')) return env;
  if (env) return env;
  return DEFAULT_HOSTNAME;
}

export function isIpv4Hostname(host: string): boolean {
  const h = host.trim();
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(h)) return false;
  const parts = h.split('.').map(Number);
  return parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255);
}

export function useHttpsMode(): boolean {
  const flag = process.env.USE_HTTPS?.trim().toLowerCase();
  if (flag === 'true' || flag === '1') return true;
  if (flag === 'false' || flag === '0') return false;
  return Boolean(
    process.env.SERVER_CERT_PATH?.trim() && process.env.SERVER_KEY_PATH?.trim(),
  );
}

export function siteUsesHttps(): boolean {
  return useHttpsMode();
}

export function getWebPort(): string {
  return process.env.WEB_PORT?.trim() || process.env.PORT?.trim() || '4321';
}

export function canonicalSiteUrl(): string {
  const host = getSiteHostname();
  const port = getWebPort();
  const proto = useHttpsMode() ? 'https' : 'http';
  if ((proto === 'https' && port === '443') || (proto === 'http' && port === '80')) {
    return `${proto}://${host}`;
  }
  return `${proto}://${host}:${port}`;
}

/** Works immediately — no hosts file (use https, not http). */
export function directSiteUrl(): string {
  const ip = requireConfiguredLanIp();
  const port = getWebPort();
  const proto = useHttpsMode() ? 'https' : 'http';
  if ((proto === 'https' && port === '443') || (proto === 'http' && port === '80')) {
    return `${proto}://${ip}`;
  }
  return `${proto}://${ip}:${port}`;
}

export function canonicalOrigin(): string {
  return canonicalSiteUrl();
}

export interface SiteAccessInfo {
  hostname: string;
  siteUrl: string;
  directUrl: string;
  lanIp: string;
  hostsFileLine: string;
  hostsFilePathWindows: string;
  hostsFilePathUnix: string;
}

export function getSiteAccessInfo(): SiteAccessInfo {
  const hostname = getSiteHostname();
  const lanIp = requireConfiguredLanIp();
  return {
    hostname,
    siteUrl: canonicalSiteUrl(),
    directUrl: directSiteUrl(),
    lanIp,
    hostsFileLine: `${lanIp} ${hostname}`,
    hostsFilePathWindows: 'C:\\Windows\\System32\\drivers\\etc\\hosts',
    hostsFilePathUnix: '/etc/hosts',
  };
}
