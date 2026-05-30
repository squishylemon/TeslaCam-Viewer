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

/** CIFS mounts //host/share only; deeper paths are resolved after mount. */
export function splitSmbUnc(unc: string): { mountTarget: string; subfolder: string } {
  const trimmed = unc.trim().replace(/\\/g, '/');
  const withoutScheme = trimmed.replace(/^\/\//, '').replace(/^smb:\/\//i, '');
  const segments = withoutScheme.split('/').filter(Boolean);
  if (segments.length < 2) {
    throw new Error(
      'SMB path must include a host and share name (e.g. 192.168.50.189/TeslaCam or //nas/Videos/TeslaCam).',
    );
  }
  const [host, share, ...rest] = segments;
  return {
    mountTarget: `//${host}/${share}`,
    subfolder: rest.join('/'),
  };
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

function mountExecError(err: unknown, requiresCredentials: boolean, mountTarget: string): Error {
  const detail = mountExecDetail(err);

  if (/Unable to apply new capability set/i.test(detail)) {
    return new Error(
      'SMB mount blocked by Docker security (Unable to apply new capability set). ' +
        'Recreate the web container after updating docker-compose.yml (SYS_ADMIN, DAC_READ_SEARCH, seccomp unconfined). ' +
        'On Docker Desktop you can also mount the share on the host and add the folder as a local library path.',
    );
  }

  if (/mount error\(22\)|return code = -22/i.test(detail)) {
    return new Error(
      `SMB mount failed (invalid argument) for ${mountTarget}. ` +
        'Use the exact share name from Windows (e.g. if the share is Videos with a TeslaCam folder inside, use 192.168.50.189/Videos/TeslaCam). ' +
        (requiresCredentials
          ? 'Check username and password (try COMPUTERNAME\\user).'
          : 'Enable "Requires credentials" — Windows usually blocks guest access.'),
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
      'Windows rejected guest access to this share (error 128). Enable "Requires credentials" and sign in with a Windows user that can open the folder.',
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

type MountAttempt = { opts: string[] };

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

function writeCredFile(
  username: string,
  password: string,
  domain?: string,
): string {
  const credFile = path.join(os.tmpdir(), `teslacam-cifs-${randomBytes(8).toString('hex')}.cred`);
  const credLines = [`username=${username}`, `password=${password}`];
  if (domain) credLines.push(`domain=${domain}`);
  fs.writeFileSync(credFile, `${credLines.join('\n')}\n`, { mode: 0o600 });
  return credFile;
}

function buildMountAttempts(credFile: string): MountAttempt[] {
  const auth = `credentials=${credFile}`;
  // Minimal opts: Alpine/Docker kernels often reject guest,file_mode,noperm combos (EINVAL 22).
  return [
    { opts: [auth, 'uid=0', 'gid=0', 'vers=3.0'] },
    { opts: [auth, 'uid=0', 'gid=0', 'vers=3.0', 'sec=ntlmssp'] },
    { opts: [auth, 'uid=0', 'gid=0', 'vers=3.0', 'sec=ntlmv2'] },
    { opts: [auth, 'uid=0', 'gid=0', 'vers=3.0', 'sec=none'] },
    { opts: [auth, 'uid=0', 'gid=0', 'vers=2.1', 'sec=ntlmssp'] },
  ];
}

function tryMountCifs(mountTarget: string, mountPoint: string, attempts: MountAttempt[]): void {
  let lastErr: unknown;
  for (const attempt of attempts) {
    const opts = attempt.opts.join(',');
    try {
      execSync(
        `mount.cifs ${shellQuote(mountTarget)} ${shellQuote(mountPoint)} -o ${shellQuote(opts)}`,
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
  mountTarget: string,
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

  const credFiles: string[] = [];
  const attempts: MountAttempt[] = [];

  if (requiresCredentials) {
    const { user, domain } = parseSmbUser(username);
    if (!user) throw new Error('Username is required when credentials are enabled.');
    const credFile = writeCredFile(user, password ?? '', domain);
    credFiles.push(credFile);
    attempts.push(...buildMountAttempts(credFile));
  } else {
    // Do not use the `guest` mount flag — it often returns EINVAL on Alpine; use sec=none + guest creds.
    const guestCred = writeCredFile('guest', '');
    credFiles.push(guestCred);
    attempts.push(...buildMountAttempts(guestCred));
  }

  try {
    tryMountCifs(mountTarget, mountPoint, attempts);
    fs.writeFileSync(path.join(mountPoint, '.teslacam-mounted'), '', 'utf8');
  } catch (err) {
    throw mountExecError(err, requiresCredentials, mountTarget);
  } finally {
    for (const file of credFiles) {
      try {
        fs.unlinkSync(file);
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

  const { mountTarget, subfolder } = splitSmbUnc(normalized);
  const mountPoint = mountPointForId(libraryMountRoot(), loc.id);
  const pass =
    passwordOverride !== undefined
      ? passwordOverride
      : loc.requiresCredentials
        ? decryptSecret(loc.smbPasswordEnc)
        : null;

  if (!isMounted(mountPoint)) {
    mountSmb(mountTarget, mountPoint, loc.smbUsername ?? null, pass, loc.requiresCredentials);
  }

  const rootPath = subfolder ? path.join(mountPoint, subfolder) : mountPoint;
  if (!fs.existsSync(rootPath)) {
    throw new Error(
      subfolder
        ? `Folder "${subfolder}" was not found on share ${mountTarget}. Check the path — use host/share/subfolder if TeslaCam is inside the share.`
        : `Share ${mountTarget} mounted but is not accessible.`,
    );
  }
  const stat = fs.statSync(rootPath);
  if (!stat.isDirectory()) throw new Error('Library path is not a directory.');
  return rootPath;
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
