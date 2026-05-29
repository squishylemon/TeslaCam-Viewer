import type { APIRoute } from 'astro';
import { requireAdmin, json } from '../../../../lib/auth/admin';
import {
  createUserByAdmin,
  listUsersForAdmin,
  AdminUserError,
} from '../../../../lib/auth/user-admin';

export const prerender = false;

export const GET: APIRoute = async (context) => {
  const auth = await requireAdmin(context);
  if (auth instanceof Response) return auth;
  const users = await listUsersForAdmin();
  return json({ users });
};

export const POST: APIRoute = async (context) => {
  const auth = await requireAdmin(context);
  if (auth instanceof Response) return auth;

  let body: { username?: string; password?: string; forceMfa?: boolean; isAdmin?: boolean };
  try {
    body = await context.request.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  try {
    const created = await createUserByAdmin({
      username: body.username ?? '',
      password: body.password,
      forceMfa: Boolean(body.forceMfa),
      isAdmin: Boolean(body.isAdmin),
    });
    const users = await listUsersForAdmin();
    return json({ ok: true, user: created, users });
  } catch (e) {
    if (e instanceof AdminUserError) return json({ error: e.message }, 400);
    console.error('[admin/users] create failed:', e);
    return json({ error: 'Could not create user.' }, 500);
  }
};
