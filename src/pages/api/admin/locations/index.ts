import type { APIRoute } from 'astro';
import { requireAdmin, json } from '../../../../lib/auth/admin';
import { clearTeslacamCache } from '../../../../lib/teslacam';
import {
  createLibraryLocation,
  listLibraryLocations,
  LibraryStoreError,
  getLibraryLocation,
} from '../../../../lib/libraries/store';
import { resolveLocationRoot } from '../../../../lib/libraries/mount';
import { refreshLibraries } from '../../../../lib/libraries/resolve';
import { validateTeslacamDir } from '../../../../lib/site-config';

export const prerender = false;

export const GET: APIRoute = async (context) => {
  const auth = await requireAdmin(context);
  if (auth instanceof Response) return auth;
  const locations = await listLibraryLocations();
  return json({ locations });
};

export const POST: APIRoute = async (context) => {
  const auth = await requireAdmin(context);
  if (auth instanceof Response) return auth;

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const input = body as Record<string, unknown>;
  try {
    const created = await createLibraryLocation({
      name: String(input.name ?? ''),
      path: String(input.path ?? ''),
      requiresCredentials: Boolean(input.requiresCredentials),
      username: input.username ? String(input.username) : undefined,
      password: input.password ? String(input.password) : undefined,
      enabled: input.enabled !== false,
    });

    const full = await getLibraryLocation(created.id);
    if (!full) return json({ error: 'Location not found after create' }, 500);

    const rootPath = resolveLocationRoot(
      { ...full, smbUsername: full.smbUsername, smbPasswordEnc: full.smbPasswordEnc },
      input.password ? String(input.password) : null,
    );
    const check = validateTeslacamDir(rootPath);
    if (!check.valid) {
      return json(
        {
          error:
            check.error ??
            'Path is reachable but no TeslaCam clips were found. Check the folder layout.',
        },
        400,
      );
    }

    await refreshLibraries();
    clearTeslacamCache();

    return json({ location: created }, 201);
  } catch (err) {
    if (err instanceof LibraryStoreError) return json({ error: err.message }, 400);
    const msg = err instanceof Error ? err.message : 'Failed to add location';
    return json({ error: msg }, 400);
  }
};
