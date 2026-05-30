import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getPool } from '../db/pool';
import { encryptSecret } from './crypto';
import { detectLocationType, normalizeLocationPath } from './paths';
import type { LibraryLocation, LibraryLocationInput, LibrarySettings } from './types';

interface LocationRow {
  id: string;
  name: string;
  path: string;
  location_type: string;
  smb_username: string | null;
  smb_password_enc: string | null;
  requires_credentials: boolean;
  enabled: boolean;
  sort_order: number;
  created_at: Date;
  updated_at: Date;
}

function rowToLocation(row: LocationRow): LibraryLocation {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    type: row.location_type === 'smb' ? 'smb' : 'local',
    requiresCredentials: row.requires_credentials,
    enabled: row.enabled,
    sortOrder: row.sort_order,
    hasPassword: Boolean(row.smb_password_enc),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export class LibraryStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LibraryStoreError';
  }
}

async function getSetting(pool: pg.Pool, key: string, fallback: string): Promise<string> {
  const { rows } = await pool.query<{ value: string }>(
    'SELECT value FROM site_settings WHERE key = $1',
    [key],
  );
  return rows[0]?.value ?? fallback;
}

async function setSetting(pool: pg.Pool, key: string, value: string): Promise<void> {
  await pool.query(
    `INSERT INTO site_settings (key, value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, value],
  );
}

export async function getLibrarySettings(pool?: pg.Pool): Promise<LibrarySettings> {
  const p = pool ?? getPool();
  const raw = await getSetting(p, 'builtin_sftp_enabled', 'true');
  return { builtinSftpEnabled: raw === 'true' || raw === '1' };
}

export async function setBuiltinSftpEnabled(
  enabled: boolean,
  pool?: pg.Pool,
): Promise<LibrarySettings> {
  const p = pool ?? getPool();
  await setSetting(p, 'builtin_sftp_enabled', enabled ? 'true' : 'false');
  return getLibrarySettings(p);
}

export async function listLibraryLocations(pool?: pg.Pool): Promise<LibraryLocation[]> {
  const p = pool ?? getPool();
  const { rows } = await p.query<LocationRow>(
    `SELECT id, name, path, location_type, smb_username, smb_password_enc,
            requires_credentials, enabled, sort_order, created_at, updated_at
     FROM library_locations
     ORDER BY sort_order ASC, created_at ASC`,
  );
  return rows.map(rowToLocation);
}

export async function getLibraryLocation(
  id: string,
  pool?: pg.Pool,
): Promise<(LibraryLocation & { smbUsername: string | null; smbPasswordEnc: string | null }) | null> {
  const p = pool ?? getPool();
  const { rows } = await p.query<LocationRow>(
    `SELECT id, name, path, location_type, smb_username, smb_password_enc,
            requires_credentials, enabled, sort_order, created_at, updated_at
     FROM library_locations WHERE id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    ...rowToLocation(row),
    smbUsername: row.smb_username,
    smbPasswordEnc: row.smb_password_enc,
  };
}

export async function createLibraryLocation(
  input: LibraryLocationInput,
  pool?: pg.Pool,
): Promise<LibraryLocation> {
  const p = pool ?? getPool();
  const name = input.name?.trim();
  const rawPath = input.path?.trim();
  if (!name) throw new LibraryStoreError('Location name is required.');
  if (!rawPath) throw new LibraryStoreError('Folder path is required.');

  const type = detectLocationType(rawPath);
  const path = normalizeLocationPath(rawPath, type);
  const requiresCredentials = Boolean(input.requiresCredentials);
  if (requiresCredentials && !input.username?.trim()) {
    throw new LibraryStoreError('Username is required when credentials are enabled.');
  }
  if (requiresCredentials && type === 'smb' && !input.password?.trim()) {
    throw new LibraryStoreError('Password is required for a new SMB location with credentials.');
  }

  const id = randomUUID();
  const passwordEnc =
    requiresCredentials && input.password?.trim()
      ? encryptSecret(input.password.trim())
      : null;

  const { rows: orderRows } = await p.query<{ n: string }>(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM library_locations',
  );
  const sortOrder = Number.parseInt(orderRows[0]?.n ?? '0', 10);

  const { rows } = await p.query<LocationRow>(
    `INSERT INTO library_locations
       (id, name, path, location_type, smb_username, smb_password_enc, requires_credentials, enabled, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, name, path, location_type, smb_username, smb_password_enc,
               requires_credentials, enabled, sort_order, created_at, updated_at`,
    [
      id,
      name,
      path,
      type,
      requiresCredentials ? input.username?.trim() ?? null : null,
      passwordEnc,
      requiresCredentials,
      input.enabled !== false,
      sortOrder,
    ],
  );
  return rowToLocation(rows[0]);
}

export async function updateLibraryLocation(
  id: string,
  input: Partial<LibraryLocationInput>,
  pool?: pg.Pool,
): Promise<LibraryLocation> {
  const p = pool ?? getPool();
  const existing = await getLibraryLocation(id, p);
  if (!existing) throw new LibraryStoreError('Location not found.');

  const name = input.name !== undefined ? input.name.trim() : existing.name;
  const rawPath = input.path !== undefined ? input.path.trim() : existing.path;
  if (!name) throw new LibraryStoreError('Location name is required.');
  if (!rawPath) throw new LibraryStoreError('Folder path is required.');

  const type = detectLocationType(rawPath);
  const path = normalizeLocationPath(rawPath, type);
  const requiresCredentials =
    input.requiresCredentials !== undefined
      ? input.requiresCredentials
      : existing.requiresCredentials;

  let smbUsername = existing.smbUsername;
  let smbPasswordEnc = existing.smbPasswordEnc;

  if (requiresCredentials) {
    if (input.username !== undefined) smbUsername = input.username.trim() || null;
    if (!smbUsername) throw new LibraryStoreError('Username is required when credentials are enabled.');
    if (input.password?.trim()) {
      smbPasswordEnc = encryptSecret(input.password.trim());
    } else if (!smbPasswordEnc && type === 'smb') {
      throw new LibraryStoreError('Password is required for SMB credentials.');
    }
  } else {
    smbUsername = null;
    smbPasswordEnc = null;
  }

  const enabled = input.enabled !== undefined ? input.enabled : existing.enabled;

  const { rows } = await p.query<LocationRow>(
    `UPDATE library_locations
     SET name = $2, path = $3, location_type = $4, smb_username = $5, smb_password_enc = $6,
         requires_credentials = $7, enabled = $8, updated_at = NOW()
     WHERE id = $1
     RETURNING id, name, path, location_type, smb_username, smb_password_enc,
               requires_credentials, enabled, sort_order, created_at, updated_at`,
    [id, name, path, type, smbUsername, smbPasswordEnc, requiresCredentials, enabled],
  );
  return rowToLocation(rows[0]);
}

export async function deleteLibraryLocation(id: string, pool?: pg.Pool): Promise<void> {
  const p = pool ?? getPool();
  await p.query('DELETE FROM library_locations WHERE id = $1', [id]);
}
