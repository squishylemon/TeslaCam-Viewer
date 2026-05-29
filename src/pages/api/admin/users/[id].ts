import type { APIRoute } from 'astro';
import { requireAdmin, json } from '../../../../lib/auth/admin';
import {
  deleteUserByAdmin,
  listUsersForAdmin,
  updateUserByAdmin,
  AdminUserError,
} from '../../../../lib/auth/user-admin';

export const prerender = false;

export const PATCH: APIRoute = async (context) => {
  const auth = await requireAdmin(context);
  if (auth instanceof Response) return auth;

  const id = Number.parseInt(context.params.id ?? '', 10);
  if (!Number.isFinite(id) || id < 1) {
    return json({ error: 'Invalid user id.' }, 400);
  }

  let body: {
    username?: string;
    password?: string;
    forceMfa?: boolean;
    isAdmin?: boolean;
    resetMfa?: boolean;
  };
  try {
    body = await context.request.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  try {
    await updateUserByAdmin(id, auth.user.id, {
      username: body.username,
      password: body.password,
      forceMfa: body.forceMfa,
      isAdmin: body.isAdmin,
      resetMfa: body.resetMfa === true,
    });
    const users = await listUsersForAdmin();
    return json({ ok: true, users });
  } catch (e) {
    if (e instanceof AdminUserError) return json({ error: e.message }, 400);
    console.error('[admin/users] update failed:', e);
    return json({ error: 'Could not update user.' }, 500);
  }
};

export const DELETE: APIRoute = async (context) => {
  const auth = await requireAdmin(context);
  if (auth instanceof Response) return auth;

  const id = Number.parseInt(context.params.id ?? '', 10);
  if (!Number.isFinite(id) || id < 1) {
    return json({ error: 'Invalid user id.' }, 400);
  }

  try {
    await deleteUserByAdmin(id, auth.user.id);
    const users = await listUsersForAdmin();
    return json({ ok: true, users });
  } catch (e) {
    if (e instanceof AdminUserError) return json({ error: e.message }, 400);
    console.error('[admin/users] delete failed:', e);
    return json({ error: 'Could not delete user.' }, 500);
  }
};
