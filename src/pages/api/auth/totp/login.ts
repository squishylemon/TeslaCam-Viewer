import type { APIRoute } from 'astro';
import { verifyTotpCode } from '../../../../lib/auth/totp';
import {
  clearLoginPending,
  readLoginPending,
} from '../../../../lib/auth/login-pending';
import { getUserAuthMethodsByUsername } from '../../../../lib/auth/user-auth-methods';
import {
  createSession,
  loadUserById,
  setSessionCookie,
  securitySetupComplete,
} from '../../../../lib/auth/session';
import { getPool } from '../../../../lib/db/pool';

export const prerender = false;

export const POST: APIRoute = async (context) => {
  let body: { username?: string; code?: string };
  try {
    body = await context.request.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  const pendingUserId = readLoginPending(context);
  if (!pendingUserId) {
    return json(
      {
        error: 'Sign in with your username and password first.',
        code: 'CREDENTIALS_REQUIRED',
      },
      403,
    );
  }

  const username = body.username?.trim();
  const code = body.code?.trim().replace(/\s/g, '') ?? '';
  if (!username || !code) {
    return json({ error: 'Username and authenticator code are required.' }, 400);
  }

  const methods = await getUserAuthMethodsByUsername(username);
  if (!methods || methods.userId !== pendingUserId) {
    return json({ error: 'Invalid username or code.' }, 401);
  }
  if (methods.hasPasskey) {
    return json(
      {
        error: 'Confirm sign-in with your passkey.',
        code: 'PASSKEY_STEP',
      },
      403,
    );
  }
  if (!methods.hasTotp) {
    return json({ error: 'This account does not use an authenticator app.' }, 403);
  }

  const pool = getPool();
  const { rows } = await pool.query<{ secret: string }>(
    'SELECT secret FROM totp_secrets WHERE user_id = $1 AND enabled_at IS NOT NULL',
    [methods.userId],
  );
  const secret = rows[0]?.secret;
  if (!secret || !(await verifyTotpCode(secret, code))) {
    return json({ error: 'Invalid authenticator code.' }, 401);
  }

  clearLoginPending(context);
  const token = await createSession(methods.userId);
  setSessionCookie(context, token);

  const profile = await loadUserById(methods.userId);
  const redirect =
    profile && securitySetupComplete(profile) ? '/' : '/setup-security';

  return json({ ok: true, redirect });
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
