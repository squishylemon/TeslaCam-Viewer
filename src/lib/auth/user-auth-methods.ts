import { getPool } from '../db/pool';

export interface UserAuthMethods {
  userId: number;
  hasPasskey: boolean;
  hasTotp: boolean;
}

export async function getUserAuthMethodsByUsername(
  username: string,
): Promise<UserAuthMethods | null> {
  const pool = getPool();
  const { rows } = await pool.query<{
    id: number;
    passkey_count: string;
    totp_count: string;
  }>(
    `SELECT u.id,
            (SELECT COUNT(*) FROM webauthn_credentials w WHERE w.user_id = u.id) AS passkey_count,
            (SELECT COUNT(*) FROM totp_secrets t WHERE t.user_id = u.id AND t.enabled_at IS NOT NULL) AS totp_count
     FROM users u
     WHERE u.username = $1`,
    [username.trim().toLowerCase()],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    userId: row.id,
    hasPasskey: Number.parseInt(row.passkey_count, 10) > 0,
    hasTotp: Number.parseInt(row.totp_count, 10) > 0,
  };
}

export async function getUserAuthMethodsById(
  userId: number,
): Promise<UserAuthMethods | null> {
  const pool = getPool();
  const { rows } = await pool.query<{
    id: number;
    passkey_count: string;
    totp_count: string;
  }>(
    `SELECT u.id,
            (SELECT COUNT(*) FROM webauthn_credentials w WHERE w.user_id = u.id) AS passkey_count,
            (SELECT COUNT(*) FROM totp_secrets t WHERE t.user_id = u.id AND t.enabled_at IS NOT NULL) AS totp_count
     FROM users u
     WHERE u.id = $1`,
    [userId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    userId: row.id,
    hasPasskey: Number.parseInt(row.passkey_count, 10) > 0,
    hasTotp: Number.parseInt(row.totp_count, 10) > 0,
  };
}
