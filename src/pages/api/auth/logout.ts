import type { APIRoute } from 'astro';
import { destroySession } from '../../../lib/auth/session';

export const prerender = false;

export const POST: APIRoute = async (context) => {
  await destroySession(context);
  return new Response(JSON.stringify({ ok: true, redirect: '/login' }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
