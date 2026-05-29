import type { APIContext } from 'astro';
import { getPool } from '../db/pool';
import { getSession, type SessionUser } from './session';

export async function requireAdmin(
  context: APIContext,
): Promise<{ user: SessionUser } | Response> {
  const session = await getSession(context);
  if (!session) {
    return json({ error: 'Unauthorized' }, 401);
  }
  if (!session.user.isAdmin) {
    return json({ error: 'Forbidden' }, 403);
  }
  return { user: session.user };
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function countAdmins(): Promise<number> {
  const pool = getPool();
  const { rows } = await pool.query<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM users WHERE is_admin = TRUE',
  );
  return Number.parseInt(rows[0]?.count ?? '0', 10);
}
