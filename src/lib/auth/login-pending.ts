import { createHmac } from 'node:crypto';
import type { APIContext } from 'astro';

export const LOGIN_PENDING_COOKIE = 'tc_login_pending';
const TTL_SEC = 5 * 60;

function pendingSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error('SESSION_SECRET must be set to a long random string (16+ chars).');
  }
  return secret;
}

function sign(userId: number, exp: number): string {
  return createHmac('sha256', pendingSecret())
    .update(`login-pending:${userId}:${exp}`)
    .digest('hex');
}

/** After password is verified, allow passkey or TOTP as the second step. */
export function setLoginPending(context: APIContext, userId: number): void {
  const exp = Math.floor(Date.now() / 1000) + TTL_SEC;
  const value = `${userId}.${exp}.${sign(userId, exp)}`;
  context.cookies.set(LOGIN_PENDING_COOKIE, value, {
    httpOnly: true,
    sameSite: 'lax',
    secure: context.url.protocol === 'https:',
    path: '/',
    maxAge: TTL_SEC,
  });
}

export function readLoginPending(context: APIContext): number | null {
  const raw = context.cookies.get(LOGIN_PENDING_COOKIE)?.value;
  if (!raw) return null;
  const parts = raw.split('.');
  if (parts.length !== 3) return null;
  const userId = Number(parts[0]);
  const exp = Number(parts[1]);
  const sig = parts[2];
  if (!Number.isInteger(userId) || userId < 1 || !Number.isInteger(exp)) return null;
  if (exp < Math.floor(Date.now() / 1000)) return null;
  if (sign(userId, exp) !== sig) return null;
  return userId;
}

export function clearLoginPending(context: APIContext): void {
  context.cookies.delete(LOGIN_PENDING_COOKIE, { path: '/' });
}
