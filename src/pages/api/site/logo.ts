import type { APIRoute } from 'astro';
import fs from 'node:fs';
import { getSession } from '../../../lib/auth/session';
import {
  readLogoFile,
  removeLogo,
  saveLogo,
  validateLogoUpload,
} from '../../../lib/branding';

export const prerender = false;

export const GET: APIRoute = async () => {
  const logo = readLogoFile();
  if (!logo) {
    return new Response('Not found', { status: 404 });
  }

  const stat = fs.statSync(logo.filePath);
  const stream = fs.createReadStream(logo.filePath);
  return new Response(stream as unknown as BodyInit, {
    headers: {
      'Content-Type': logo.mime,
      'Cache-Control': 'public, max-age=3600',
      'Content-Length': String(stat.size),
    },
  });
};

export const POST: APIRoute = async (context) => {
  const session = await getSession(context);
  if (!session) {
    return json({ error: 'Unauthorized' }, 401);
  }

  try {
    const form = await context.request.formData();
    const file = form.get('logo');
    if (!(file instanceof File)) {
      return json({ error: 'Choose an image file to upload.' }, 400);
    }

    const err = validateLogoUpload(file.type, file.size);
    if (err) return json({ error: err }, 400);

    const buffer = Buffer.from(await file.arrayBuffer());
    const meta = saveLogo(buffer, file.type);
    return json({
      ok: true,
      url: `/api/site/logo?v=${encodeURIComponent(meta.updatedAt)}`,
    });
  } catch (e) {
    console.error('[site/logo] upload failed:', e);
    return json({ error: 'Could not save logo.' }, 500);
  }
};

export const DELETE: APIRoute = async (context) => {
  const session = await getSession(context);
  if (!session) {
    return json({ error: 'Unauthorized' }, 401);
  }
  removeLogo();
  return json({ ok: true });
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
