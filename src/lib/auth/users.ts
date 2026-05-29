import type pg from 'pg';
import { getPool } from '../db/pool';
import { hashPassword, verifyPassword } from './password';

export interface DbUser {
  id: number;
  username: string;
  password_hash: string;
  must_change_password: boolean;
}

export async function findUserByUsername(
  username: string,
): Promise<DbUser | null> {
  const pool = getPool();
  const { rows } = await pool.query<DbUser>(
    'SELECT id, username, password_hash, must_change_password FROM users WHERE username = $1',
    [username.trim().toLowerCase()],
  );
  return rows[0] ?? null;
}

export async function verifyUserLogin(
  username: string,
  password: string,
): Promise<DbUser | null> {
  const user = await findUserByUsername(username);
  if (!user) return null;
  const ok = await verifyPassword(password, user.password_hash);
  return ok ? user : null;
}

export async function updateUserPassword(
  userId: number,
  newPassword: string,
): Promise<void> {
  const pool = getPool();
  const passwordHash = await hashPassword(newPassword);
  await pool.query(
    `UPDATE users SET password_hash = $1, must_change_password = FALSE, updated_at = NOW()
     WHERE id = $2`,
    [passwordHash, userId],
  );
}

export async function usernameExists(username: string): Promise<boolean> {
  const pool = getPool();
  const { rows } = await pool.query<{ exists: boolean }>(
    'SELECT EXISTS(SELECT 1 FROM users WHERE username = $1) AS exists',
    [username.trim().toLowerCase()],
  );
  return rows[0]?.exists ?? false;
}
