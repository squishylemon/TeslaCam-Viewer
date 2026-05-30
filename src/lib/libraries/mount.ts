import { execSync } from 'node:child_process';
import fs from 'node:fs';
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

function mountSmb(
  source: string,
  mountPoint: string,
  username: string | null,
  password: string | null,
): void {
  fs.mkdirSync(mountPoint, { recursive: true });
  if (isMounted(mountPoint)) {
    try {
      execSync(`umount "${mountPoint}"`, { stdio: 'ignore' });
    } catch {
      /* ignore */
    }
  }

  const user = username?.trim() || 'guest';
  const pass = password ?? '';
  const opts = [
    `username=${user}`,
    `password=${pass}`,
    'uid=1000',
    'gid=1000',
    'iocharset=utf8',
    'file_mode=0775',
    'dir_mode=0775',
    'noperm',
    'vers=3.0',
  ].join(',');

  execSync(`mount -t cifs "${source}" "${mountPoint}" -o "${opts}"`, {
    stdio: 'pipe',
    timeout: 30_000,
  });
  fs.writeFileSync(path.join(mountPoint, '.teslacam-mounted'), '', 'utf8');
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
    mountSmb(normalized, mountPoint, loc.smbUsername ?? null, pass);
  }
  return mountPoint;
}

export function unmountLocation(id: string): void {
  const mountPoint = mountPointForId(libraryMountRoot(), id);
  if (!fs.existsSync(mountPoint)) return;
  if (!isMounted(mountPoint)) return;
  try {
    execSync(`umount "${mountPoint}"`, { stdio: 'ignore' });
  } catch {
    /* ignore */
  }
}
