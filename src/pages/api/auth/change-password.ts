import type { APIRoute } from 'astro';
import { getSession } from '../../../lib/auth/session';
import { validateNewPassword, verifyPassword } from '../../../lib/auth/password';
import { findUserByUsername, updateUserPassword } from '../../../lib/auth/users';

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const session = await getSession(context);
  if (!session) return unauthorized();

  let body: { currentPassword?: string; newPassword?: string };
  try {
    body = await context.request.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  const currentPassword = body.currentPassword ?? '';
  const newPassword = body.newPassword ?? '';
  const validation = validateNewPassword(newPassword);
  if (validation) return json({ error: validation }, 400);

  const user = await findUserByUsername(session.user.username);
  if (!user) return unauthorized();

  const mustVerifyCurrent = !session.user.mustChangePassword;
  if (mustVerifyCurrent) {
    const ok = await verifyPassword(currentPassword, user.password_hash);
    if (!ok) return json({ error: 'Current password is incorrect.' }, 401);
  } else if (currentPassword) {
    const ok = await verifyPassword(currentPassword, user.password_hash);
    if (!ok) return json({ error: 'Current password is incorrect.' }, 401);
  }

  await updateUserPassword(user.id, newPassword);

  return json({ ok: true, mustChangePassword: false });
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
