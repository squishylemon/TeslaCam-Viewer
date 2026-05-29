import type { APIRoute } from 'astro';
import { getSession, securitySetupComplete } from '../../../lib/auth/session';

export const prerender = false;

export const GET: APIRoute = async (context) => {
  const session = await getSession(context);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return new Response(
    JSON.stringify({
      user: session.user,
      setupComplete: securitySetupComplete(session.user),
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
};
