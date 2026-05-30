import type { APIRoute } from 'astro';
import { requireAdmin, json } from '../../../lib/auth/admin';
import { clearTeslacamCache } from '../../../lib/teslacam';
import {
  getLibrarySettings,
  setBuiltinSftpEnabled,
} from '../../../lib/libraries/store';
import { refreshLibraries } from '../../../lib/libraries/resolve';

export const prerender = false;

export const GET: APIRoute = async (context) => {
  const auth = await requireAdmin(context);
  if (auth instanceof Response) return auth;
  const settings = await getLibrarySettings();
  return json({ settings });
};

export const PATCH: APIRoute = async (context) => {
  const auth = await requireAdmin(context);
  if (auth instanceof Response) return auth;

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const input = body as { builtinSftpEnabled?: boolean };
  if (input.builtinSftpEnabled === undefined) {
    return json({ error: 'builtinSftpEnabled is required' }, 400);
  }

  const settings = await setBuiltinSftpEnabled(Boolean(input.builtinSftpEnabled));
  await refreshLibraries();
  clearTeslacamCache();
  return json({ settings });
};
