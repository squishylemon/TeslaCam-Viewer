import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getSiteHostname } from './site-hostname';

const PASSWORD_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

export interface SftpCredentials {
  host: string;
  port: number;
  username: string;
  password: string;
  createdAt: string;
}

export function sftpConfigDir(): string {
  const env = process.env.SFTP_CONFIG_DIR?.trim();
  return env ? path.resolve(env) : path.resolve(process.cwd(), 'data', 'sftp');
}

function credentialsPath(): string {
  return path.join(sftpConfigDir(), 'sftp.json');
}

function randomPassword(length = 20): string {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += PASSWORD_CHARS[bytes[i]! % PASSWORD_CHARS.length];
  }
  return out;
}

function randomPort(): number {
  return 20000 + crypto.randomInt(40000);
}

function writeCredentials(creds: SftpCredentials): void {
  const dir = sftpConfigDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = credentialsPath();
  fs.writeFileSync(file, `${JSON.stringify(creds, null, 2)}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* Windows */
  }
}

function readStoredCredentials(): SftpCredentials | null {
  try {
    const file = credentialsPath();
    if (!fs.existsSync(file)) return null;
    const data = JSON.parse(fs.readFileSync(file, 'utf8')) as SftpCredentials;
    if (data.port && data.username && data.password) return data;
  } catch {
    /* ignore */
  }
  return null;
}

/** Keep SFTP host on the .local site domain (same as passkeys). */
export function tryUpdateSftpHostFromRequest(): void {
  const host = getSiteHostname();
  const stored = readStoredCredentials();
  if (!stored || stored.host === host) return;
  writeCredentials({ ...stored, host });
}

let hostRefreshPromise: Promise<void> | null = null;

export async function ensureSftpHostDetected(): Promise<void> {
  if (hostRefreshPromise) return hostRefreshPromise;
  hostRefreshPromise = (async () => {
    const stored = readStoredCredentials();
    const host = getSiteHostname();
    if (!stored) {
      writeCredentials({
        host,
        port: randomPort(),
        username: process.env.SFTP_USER?.trim() || 'teslacam',
        password: randomPassword(20),
        createdAt: new Date().toISOString(),
      });
      return;
    }
    if (stored.host !== host) {
      writeCredentials({ ...stored, host });
    }
  })();
  return hostRefreshPromise;
}

export function getSftpCredentials(): SftpCredentials {
  const stored = readStoredCredentials();
  if (!stored) {
    throw new Error(
      'SFTP credentials missing. Run docker compose up so sftp-init can create them.',
    );
  }
  return { ...stored, host: getSiteHostname() };
}

export function resolveSftpHost(): string {
  return getSiteHostname();
}

export function sftpClientUrl(creds: SftpCredentials): string {
  const user = encodeURIComponent(creds.username);
  const pass = encodeURIComponent(creds.password);
  return `sftp://${user}:${pass}@${creds.host}:${creds.port}/`;
}

export function winScpUrl(creds: SftpCredentials): string {
  const user = encodeURIComponent(creds.username);
  const pass = encodeURIComponent(creds.password);
  return `winscp://${user}:${pass}@${creds.host}:${creds.port}/`;
}
