import type { APIRoute } from 'astro';
import { requireAdmin, json } from '../../../../lib/auth/admin';
import { clearTeslacamCache } from '../../../../lib/teslacam';
import {
  deleteLibraryLocation,
  getLibraryLocation,
  LibraryStoreError,
  updateLibraryLocation,
} from '../../../../lib/libraries/store';
import { resolveLocationRoot, unmountLocation } from '../../../../lib/libraries/mount';
import { refreshLibraries } from '../../../../lib/libraries/resolve';
import { validateTeslacamDir } from '../../../../lib/site-config';

export const prerender = false;

export const PATCH: APIRoute = async (context) => {
  const auth = await requireAdmin(context);
  if (auth instanceof Response) return auth;

  const id = context.params.id?.trim();
  if (!id) return json({ error: 'Missing id' }, 400);

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const input = body as Record<string, unknown>;
  try {
    const updated = await updateLibraryLocation(id, {
      name: input.name !== undefined ? String(input.name) : undefined,
      path: input.path !== undefined ? String(input.path) : undefined,
      requiresCredentials:
        input.requiresCredentials !== undefined
          ? Boolean(input.requiresCredentials)
          : undefined,
      username: input.username !== undefined ? String(input.username) : undefined,
      password: input.password ? String(input.password) : undefined,
      enabled: input.enabled !== undefined ? Boolean(input.enabled) : undefined,
    });

    if (updated.enabled) {
      const full = await getLibraryLocation(id);
      if (full) {
        const rootPath = resolveLocationRoot(
          { ...full, smbUsername: full.smbUsername, smbPasswordEnc: full.smbPasswordEnc },
          input.password ? String(input.password) : null,
        );
        const check = validateTeslacamDir(rootPath);
        if (!check.valid) {
          return json({ error: check.error ?? 'No TeslaCam clips found at path' }, 400);
        }
      }
    } else {
      unmountLocation(id);
    }

    await refreshLibraries();
    clearTeslacamCache();
    return json({ location: updated });
  } catch (err) {
    if (err instanceof LibraryStoreError) return json({ error: err.message }, 400);
    const msg = err instanceof Error ? err.message : 'Failed to update location';
    return json({ error: msg }, 400);
  }
};

export const DELETE: APIRoute = async (context) => {
  const auth = await requireAdmin(context);
  if (auth instanceof Response) return auth;

  const id = context.params.id?.trim();
  if (!id) return json({ error: 'Missing id' }, 400);

  try {
    unmountLocation(id);
    await deleteLibraryLocation(id);
    await refreshLibraries();
    clearTeslacamCache();
    return json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to delete location';
    return json({ error: msg }, 400);
  }
};
