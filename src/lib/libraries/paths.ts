import path from 'node:path';
import type { LocationType } from './types';

const SMB_HOST_SHARE =
  /^(?:smb:\/\/)?(?:\/\/)?(?<host>\d{1,3}(?:\.\d{1,3}){3}|[a-zA-Z0-9.-]+)\/(?<share>[^/\\]+)(?<subpath>\/.*)?$/;

export function detectLocationType(rawPath: string): LocationType {
  const t = rawPath.trim();
  if (t.startsWith('//') || t.startsWith('smb://') || SMB_HOST_SHARE.test(t.replace(/\\/g, '/'))) {
    return 'smb';
  }
  return 'local';
}

/** Normalize user path to a CIFS source or local absolute path. */
export function normalizeLocationPath(rawPath: string, type: LocationType): string {
  const trimmed = rawPath.trim().replace(/\\/g, '/').replace(/\/+$/, '');
  if (type === 'local') {
    if (trimmed.startsWith('//')) return trimmed;
    return path.resolve(trimmed);
  }
  if (trimmed.startsWith('//')) return trimmed;
  if (trimmed.startsWith('smb://')) {
    return `//${trimmed.slice('smb://'.length)}`;
  }
  const m = SMB_HOST_SHARE.exec(trimmed);
  if (m?.groups?.host && m.groups.share) {
    const sub = m.groups.subpath ?? '';
    return `//${m.groups.host}/${m.groups.share}${sub}`;
  }
  throw new Error('SMB path must look like 192.168.1.10/TeslaCam or //192.168.1.10/TeslaCam');
}

export function mountPointForId(mountRoot: string, locationId: string): string {
  return path.join(mountRoot, locationId);
}
