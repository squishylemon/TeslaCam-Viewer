import type { APIRoute } from 'astro';
import { clearLoginPending, setLoginPending } from '../../../lib/auth/login-pending';
import { getUserAuthMethodsById } from '../../../lib/auth/user-auth-methods';
import {
  createSession,
  loadUserById,
  setSessionCookie,
  securitySetupComplete,
} from '../../../lib/auth/session';
import { verifyUserLogin } from '../../../lib/auth/users';

export const prerender = false;

export const POST: APIRoute = async (context) => {
  let body: { username?: string; password?: string };
  try {
    body = await context.request.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  const username = body.username?.trim();
  const password = body.password ?? '';
  if (!username || !password) {
    return json({ error: 'Username and password are required.' }, 400);
  }

  const user = await verifyUserLogin(username, password);
  if (!user) {
    clearLoginPending(context);
    return json({ error: 'Invalid username or password.' }, 401);
  }

  const methods = await getUserAuthMethodsById(user.id);
  if (methods?.hasPasskey) {
    setLoginPending(context, user.id);
    return json({
      ok: true,
      code: 'PASSKEY_STEP',
      message: 'Password accepted. Confirm with your passkey.',
    });
  }

  if (methods?.hasTotp) {
    setLoginPending(context, user.id);
    return json({
      ok: true,
      code: 'TOTP_STEP',
      message: 'Password accepted. Enter your authenticator code.',
    });
  }

  clearLoginPending(context);
  const token = await createSession(user.id);
  setSessionCookie(context, token);

  const profile = await loadUserById(user.id);
  const redirect =
    profile && securitySetupComplete(profile) ? '/' : '/setup-security';

  return json({
    ok: true,
    redirect,
    mustChangePassword: user.must_change_password,
  });
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
