import type { APIRoute } from 'astro';
import { verifyTotpCode } from '../../../../lib/auth/totp';
import { getSession } from '../../../../lib/auth/session';
import { getPool } from '../../../../lib/db/pool';

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const session = await getSession(context);
  if (!session) return unauthorized();

  let body: { code?: string };
  try {
    body = await context.request.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  const code = body.code?.replace(/\s/g, '') ?? '';
  if (!/^\d{6}$/.test(code)) {
    return json({ error: 'Enter a 6-digit code from your authenticator app.' }, 400);
  }

  const pool = getPool();
  const { rows } = await pool.query<{ secret: string; enabled_at: Date | null }>(
    'SELECT secret, enabled_at FROM totp_secrets WHERE user_id = $1',
    [session.user.id],
  );
  const row = rows[0];
  if (!row) return json({ error: 'Set up authenticator first.' }, 400);
  if (row.enabled_at) return json({ ok: true, alreadyEnabled: true });

  const valid = await verifyTotpCode(row.secret, code);
  if (!valid) return json({ error: 'Invalid code. Try again.' }, 400);

  await pool.query(
    'UPDATE totp_secrets SET enabled_at = NOW() WHERE user_id = $1',
    [session.user.id],
  );

  return json({ ok: true });
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function unauthorized(): Response {
  return json({ error: 'Unauthorized' }, 401);
}
