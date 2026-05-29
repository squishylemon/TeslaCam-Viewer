import { createHash, randomBytes } from 'node:crypto';
import type { APIContext } from 'astro';
import type pg from 'pg';
import { getPool } from '../db/pool';

export const SESSION_COOKIE = 'tc_session';
const SESSION_DAYS = 14;

export interface SessionUser {
  id: number;
  username: string;
  mustChangePassword: boolean;
  forceMfa: boolean;
  isAdmin: boolean;
  hasPasskey: boolean;
  hasTotp: boolean;
}

export interface SessionRecord {
  id: string;
  user: SessionUser;
}

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error('SESSION_SECRET must be set to a long random string (16+ chars).');
  }
  return secret;
}

function hashToken(token: string): string {
  return createHash('sha256').update(`${token}:${sessionSecret()}`).digest('hex');
}

export function securitySetupComplete(user: SessionUser): boolean {
  if (user.mustChangePassword) return false;
  if (user.forceMfa && !user.hasPasskey && !user.hasTotp) return false;
  return true;
}

export async function loadUserById(userId: number): Promise<SessionUser | null> {
  return loadUser(getPool(), userId);
}

async function loadUser(pool: pg.Pool, userId: number): Promise<SessionUser | null> {
  const { rows } = await pool.query<{
    id: number;
    username: string;
    must_change_password: boolean;
    force_mfa: boolean;
    is_admin: boolean;
    passkey_count: string;
    totp_count: string;
  }>(
    `SELECT u.id, u.username, u.must_change_password, u.force_mfa, u.is_admin,
            (SELECT COUNT(*) FROM webauthn_credentials w WHERE w.user_id = u.id) AS passkey_count,
            (SELECT COUNT(*) FROM totp_secrets t WHERE t.user_id = u.id AND t.enabled_at IS NOT NULL) AS totp_count
     FROM users u WHERE u.id = $1`,
    [userId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    mustChangePassword: row.must_change_password,
    forceMfa: row.force_mfa,
    isAdmin: row.is_admin,
    hasPasskey: Number.parseInt(row.passkey_count, 10) > 0,
    hasTotp: Number.parseInt(row.totp_count, 10) > 0,
  };
}

export async function createSession(userId: number): Promise<string> {
  const pool = getPool();
  const token = randomBytes(32).toString('base64url');
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  const sessionId = crypto.randomUUID();

  await pool.query(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)`,
    [sessionId, userId, tokenHash, expiresAt.toISOString()],
  );

  return token;
}

export function setSessionCookie(context: APIContext, token: string): void {
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  context.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: context.url.protocol === 'https:',
    path: '/',
    maxAge,
  });
}

export function clearSessionCookie(context: APIContext): void {
  context.cookies.delete(SESSION_COOKIE, { path: '/' });
}

export async function getSession(context: APIContext): Promise<SessionRecord | null> {
  const token = context.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const pool = getPool();
  const tokenHash = hashToken(token);
  const { rows } = await pool.query<{ id: string; user_id: number; expires_at: Date }>(
    `SELECT id, user_id, expires_at FROM sessions
     WHERE token_hash = $1 AND expires_at > NOW()`,
    [tokenHash],
  );
  const row = rows[0];
  if (!row) return null;

  const user = await loadUser(pool, row.user_id);
  if (!user) return null;

  return { id: row.id, user };
}

export async function destroySession(context: APIContext): Promise<void> {
  const token = context.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return;
  const pool = getPool();
  await pool.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
  clearSessionCookie(context);
}
