import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { LibraryLocation } from './types';
import { decryptSecret } from './crypto';
import { mountPointForId, normalizeLocationPath } from './paths';

export type MountableLocation = LibraryLocation & {
  smbUsername?: string | null;
  smbPasswordEnc?: string | null;
};

export function libraryMountRoot(): string {
  return process.env.LIBRARY_MOUNT_ROOT?.trim() || '/app/data/libraries';
}

function isMounted(mountPoint: string): boolean {
  try {
    execSync(`mountpoint -q "${mountPoint}"`, { stdio: 'ignore' });
    return true;
  } catch {
    return fs.existsSync(path.join(mountPoint, '.teslacam-mounted'));
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function mountExecDetail(err: unknown): string {
  const e = err as { stderr?: Buffer | string; stdout?: Buffer | string; message?: string };
  return [e.stderr, e.stdout, e.message]
    .map((part) => {
      if (part == null) return '';
      return typeof part === 'string' ? part : part.toString('utf8');
    })
    .join('\n')
    .trim();
}

function mountExecError(err: unknown, requiresCredentials: boolean): Error {
  const detail = mountExecDetail(err);

  if (/Unable to apply new capability set/i.test(detail)) {
    return new Error(
      'SMB mount blocked by Docker security (Unable to apply new capability set). ' +
        'Recreate the web container after updating docker-compose.yml (SYS_ADMIN, DAC_READ_SEARCH, seccomp unconfined). ' +
        'On Docker Desktop you can also mount the share on the host and add the folder as a local library path.',
    );
  }

  if (/Key has been revoked|mount error\(128\)/i.test(detail)) {
    if (requiresCredentials) {
      return new Error(
        'Windows rejected the SMB sign-in (error 128). Check the username and password, and that the account can open this share. ' +
          'Try DOMAIN\\user if the PC is on a domain.',
      );
    }
    return new Error(
      'Windows rejected guest access to this share (error 128). Enable "Requires credentials" and sign in with a Windows user that can open the folder, ' +
        'or on the host PC enable insecure guest logons (Network → Advanced sharing → guest access).',
    );
  }

  if (/STATUS_LOGON_FAILURE|denied|access denied|permission denied/i.test(detail)) {
    return new Error(
      requiresCredentials
        ? 'SMB sign-in failed. Check username and password for this share.'
        : 'SMB sign-in failed. This share likely requires a username and password — enable "Requires credentials".',
    );
  }

  return new Error(detail || 'SMB mount failed');
}

type MountAttempt = { label: string; opts: string[] };

function parseSmbUser(username: string | null): { user: string; domain?: string } {
  const raw = username?.trim() || '';
  if (!raw) return { user: '' };
  const slash = raw.indexOf('\\');
  if (slash > 0) {
    return { domain: raw.slice(0, slash), user: raw.slice(slash + 1) };
  }
  const at = raw.indexOf('@');
  if (at > 0) {
    return { user: raw.slice(0, at), domain: raw.slice(at + 1) };
  }
  return { user: raw };
}

function buildMountAttempts(
  requiresCredentials: boolean,
  username: string | null,
  password: string | null,
  credFile: string | null,
): MountAttempt[] {
  const common = [
    'uid=1000',
    'gid=1000',
    'iocharset=utf8',
    'file_mode=0775',
    'dir_mode=0775',
    'noperm',
    'noserverino',
  ];

  if (requiresCredentials) {
    const auth = [`credentials=${credFile!}`];
    return [
      { label: 'ntlmssp/3.0', opts: [...auth, ...common, 'vers=3.0', 'sec=ntlmssp'] },
      { label: 'ntlmv2/3.0', opts: [...auth, ...common, 'vers=3.0', 'sec=ntlmv2'] },
      { label: 'ntlm/2.1', opts: [...auth, ...common, 'vers=2.1', 'sec=ntlm'] },
    ];
  }

  return [
    { label: 'guest/ntlmssp/3.0', opts: ['guest', ...common, 'vers=3.0', 'sec=ntlmssp'] },
    { label: 'guest/ntlmv2/3.0', opts: ['guest', ...common, 'vers=3.0', 'sec=ntlmv2'] },
    { label: 'guest/2.1', opts: ['guest', ...common, 'vers=2.1', 'sec=ntlm'] },
  ];
}

function tryMountCifs(source: string, mountPoint: string, attempts: MountAttempt[]): void {
  let lastErr: unknown;
  for (const attempt of attempts) {
    const opts = attempt.opts.join(',');
    try {
      execSync(
        `mount.cifs ${shellQuote(source)} ${shellQuote(mountPoint)} -o ${shellQuote(opts)}`,
        { stdio: 'pipe', timeout: 30_000 },
      );
      return;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

function mountSmb(
  source: string,
  mountPoint: string,
  username: string | null,
  password: string | null,
  requiresCredentials: boolean,
): void {
  fs.mkdirSync(mountPoint, { recursive: true });
  if (isMounted(mountPoint)) {
    try {
      execSync(`umount ${shellQuote(mountPoint)}`, { stdio: 'ignore' });
    } catch {
      /* ignore */
    }
  }

  let credFile: string | null = null;
  if (requiresCredentials) {
    const { user, domain } = parseSmbUser(username);
    if (!user) throw new Error('Username is required when credentials are enabled.');
    credFile = path.join(os.tmpdir(), `teslacam-cifs-${randomBytes(8).toString('hex')}.cred`);
    const pass = password ?? '';
    const credLines = [`username=${user}`, `password=${pass}`];
    if (domain) credLines.push(`domain=${domain}`);
    fs.writeFileSync(credFile, `${credLines.join('\n')}\n`, { mode: 0o600 });
  }

  const attempts = buildMountAttempts(requiresCredentials, username, password, credFile);

  try {
    tryMountCifs(source, mountPoint, attempts);
    fs.writeFileSync(path.join(mountPoint, '.teslacam-mounted'), '', 'utf8');
  } catch (err) {
    throw mountExecError(err, requiresCredentials);
  } finally {
    if (credFile) {
      try {
        fs.unlinkSync(credFile);
      } catch {
        /* ignore */
      }
    }
  }
}

export function resolveLocationRoot(
  loc: MountableLocation,
  passwordOverride?: string | null,
): string {
  const normalized = normalizeLocationPath(loc.path, loc.type);

  if (loc.type === 'local') {
    if (!fs.existsSync(normalized)) {
      throw new Error(
        `Path not found: ${loc.path}. Bind-mount the folder into the container or use an SMB path.`,
      );
    }
    const stat = fs.statSync(normalized);
    if (!stat.isDirectory()) throw new Error('Library path is not a directory.');
    return normalized;
  }

  const mountPoint = mountPointForId(libraryMountRoot(), loc.id);
  const pass =
    passwordOverride !== undefined
      ? passwordOverride
      : loc.requiresCredentials
        ? decryptSecret(loc.smbPasswordEnc)
        : null;

  if (!isMounted(mountPoint)) {
    mountSmb(
      normalized,
      mountPoint,
      loc.smbUsername ?? null,
      pass,
      loc.requiresCredentials,
    );
  }
  return mountPoint;
}

export function unmountLocation(id: string): void {
  const mountPoint = mountPointForId(libraryMountRoot(), id);
  if (!fs.existsSync(mountPoint)) return;
  if (!isMounted(mountPoint)) return;
  try {
    execSync(`umount ${shellQuote(mountPoint)}`, { stdio: 'ignore' });
  } catch {
    /* ignore */
  }
}
