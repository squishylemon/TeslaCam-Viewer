import { getPool } from '../db/pool';
import {
  generateSecurePassword,
  hashPassword,
  validateNewPassword,
} from './password';
import { isRootAdminUser } from './root-admin';

export interface AdminUserRow {
  id: number;
  username: string;
  isAdmin: boolean;
  forceMfa: boolean;
  mustChangePassword: boolean;
  hasPasskey: boolean;
  hasTotp: boolean;
  createdAt: string;
}

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export function validateUsername(username: string): string | null {
  const n = normalizeUsername(username);
  if (n.length < 2 || n.length > 32) {
    return 'Username must be 2–32 characters.';
  }
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(n)) {
    return 'Use lowercase letters, numbers, dots, hyphens, or underscores.';
  }
  return null;
}

export async function listUsersForAdmin(): Promise<AdminUserRow[]> {
  const pool = getPool();
  const { rows } = await pool.query<{
    id: number;
    username: string;
    is_admin: boolean;
    force_mfa: boolean;
    must_change_password: boolean;
    passkey_count: string;
    totp_count: string;
    created_at: Date;
  }>(
    `SELECT u.id, u.username, u.is_admin, u.force_mfa, u.must_change_password, u.created_at,
            (SELECT COUNT(*) FROM webauthn_credentials w WHERE w.user_id = u.id) AS passkey_count,
            (SELECT COUNT(*) FROM totp_secrets t WHERE t.user_id = u.id AND t.enabled_at IS NOT NULL) AS totp_count
     FROM users u
     ORDER BY u.username ASC`,
  );

  return rows.map((row) => ({
    id: row.id,
    username: row.username,
    isAdmin: row.is_admin,
    forceMfa: row.force_mfa,
    mustChangePassword: row.must_change_password,
    hasPasskey: Number.parseInt(row.passkey_count, 10) > 0,
    hasTotp: Number.parseInt(row.totp_count, 10) > 0,
    createdAt: row.created_at.toISOString(),
  }));
}

export async function createUserByAdmin(opts: {
  username: string;
  password?: string;
  forceMfa: boolean;
  isAdmin?: boolean;
}): Promise<{ id: number; username: string; password: string }> {
  const usernameErr = validateUsername(opts.username);
  if (usernameErr) throw new AdminUserError(usernameErr);

  const username = normalizeUsername(opts.username);
  const pool = getPool();

  const { rows: exists } = await pool.query<{ exists: boolean }>(
    'SELECT EXISTS(SELECT 1 FROM users WHERE username = $1) AS exists',
    [username],
  );
  if (exists[0]?.exists) throw new AdminUserError('Username already exists.');

  const password = opts.password?.trim() || generateSecurePassword();
  const pwErr = validateNewPassword(password);
  if (pwErr) throw new AdminUserError(pwErr);

  const passwordHash = await hashPassword(password);
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO users (username, password_hash, must_change_password, is_admin, force_mfa)
     VALUES ($1, $2, FALSE, $3, $4)
     RETURNING id`,
    [username, passwordHash, Boolean(opts.isAdmin), opts.forceMfa],
  );
  const id = rows[0]!.id;
  return { id, username, password };
}

export async function updateUserByAdmin(
  targetId: number,
  _actorId: number,
  patch: {
    username?: string;
    password?: string;
    forceMfa?: boolean;
    isAdmin?: boolean;
    resetMfa?: boolean;
  },
): Promise<void> {
  const pool = getPool();
  const { rows } = await pool.query<{
    id: number;
    username: string;
    is_admin: boolean;
  }>('SELECT id, username, is_admin FROM users WHERE id = $1', [targetId]);
  const target = rows[0];
  if (!target) throw new AdminUserError('User not found.');

  if (patch.username !== undefined) {
    const usernameErr = validateUsername(patch.username);
    if (usernameErr) throw new AdminUserError(usernameErr);
    const username = normalizeUsername(patch.username);
    if (username !== target.username) {
      const { rows: clash } = await pool.query<{ exists: boolean }>(
        'SELECT EXISTS(SELECT 1 FROM users WHERE username = $1 AND id <> $2) AS exists',
        [username, targetId],
      );
      if (clash[0]?.exists) throw new AdminUserError('Username already exists.');
      await pool.query(
        'UPDATE users SET username = $1, updated_at = NOW() WHERE id = $2',
        [username, targetId],
      );
    }
  }

  if (patch.password !== undefined && patch.password.trim()) {
    const pwErr = validateNewPassword(patch.password);
    if (pwErr) throw new AdminUserError(pwErr);
    const passwordHash = await hashPassword(patch.password);
    await pool.query(
      `UPDATE users SET password_hash = $1, must_change_password = FALSE, updated_at = NOW() WHERE id = $2`,
      [passwordHash, targetId],
    );
  }

  if (patch.forceMfa !== undefined) {
    if (isRootAdminUser(targetId) && patch.forceMfa === false) {
      throw new AdminUserError('The default admin account must keep 2FA required.');
    }
    await pool.query(
      'UPDATE users SET force_mfa = $1, updated_at = NOW() WHERE id = $2',
      [patch.forceMfa, targetId],
    );
  }

  if (patch.isAdmin !== undefined) {
    if (isRootAdminUser(targetId) && patch.isAdmin === false) {
      throw new AdminUserError('The default admin account must remain an administrator.');
    }
    if (patch.isAdmin === false && target.is_admin) {
      const { rows: adminCount } = await pool.query<{ count: string }>(
        'SELECT COUNT(*)::text AS count FROM users WHERE is_admin = TRUE',
      );
      if (Number.parseInt(adminCount[0]?.count ?? '0', 10) <= 1) {
        throw new AdminUserError('Cannot remove the only admin account.');
      }
    }
    await pool.query(
      'UPDATE users SET is_admin = $1, updated_at = NOW() WHERE id = $2',
      [patch.isAdmin, targetId],
    );
  }

  if (patch.resetMfa) {
    if (isRootAdminUser(targetId)) {
      throw new AdminUserError('Cannot reset 2FA on the default admin account.');
    }
    await pool.query('DELETE FROM webauthn_credentials WHERE user_id = $1', [targetId]);
    await pool.query('DELETE FROM totp_secrets WHERE user_id = $1', [targetId]);
    await pool.query(
      'UPDATE users SET force_mfa = TRUE, updated_at = NOW() WHERE id = $1',
      [targetId],
    );
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [targetId]);
  }
}

export async function deleteUserByAdmin(
  targetId: number,
  actorId: number,
): Promise<void> {
  if (isRootAdminUser(targetId)) {
    throw new AdminUserError('The default admin account cannot be deleted.');
  }
  if (targetId === actorId) {
    throw new AdminUserError('You cannot delete your own account.');
  }

  const pool = getPool();
  const { rows } = await pool.query<{ is_admin: boolean }>(
    'SELECT is_admin FROM users WHERE id = $1',
    [targetId],
  );
  const target = rows[0];
  if (!target) throw new AdminUserError('User not found.');

  if (target.is_admin) {
    const { rows: adminCount } = await pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM users WHERE is_admin = TRUE',
    );
    if (Number.parseInt(adminCount[0]?.count ?? '0', 10) <= 1) {
      throw new AdminUserError('Cannot delete the only admin account.');
    }
  }

  await pool.query('DELETE FROM users WHERE id = $1', [targetId]);
}

export class AdminUserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdminUserError';
  }
}
