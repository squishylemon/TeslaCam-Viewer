import type { APIRoute } from 'astro';
import {
  generateRegistrationOptions,
  type AuthenticatorTransportFuture,
} from '@simplewebauthn/server';
import { getSession } from '../../../../lib/auth/session';
import { getWebAuthnConfig } from '../../../../lib/auth/webauthn-config';
import { saveChallenge } from '../../../../lib/auth/challenges';
import { getPool } from '../../../../lib/db/pool';

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const session = await getSession(context);
  if (!session) return unauthorized();

  const pool = getPool();
  const { rows: creds } = await pool.query<{
    credential_id: string;
    transports: string | null;
  }>(
    'SELECT credential_id, transports FROM webauthn_credentials WHERE user_id = $1',
    [session.user.id],
  );

  const { rpName, rpID, origin } = getWebAuthnConfig(context.request);
  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: session.user.username,
    userDisplayName: session.user.username,
    userID: new TextEncoder().encode(String(session.user.id)),
    attestationType: 'none',
    excludeCredentials: creds.map((c) => ({
      id: c.credential_id,
      transports: (c.transports?.split(',') ?? []) as AuthenticatorTransportFuture[],
    })),
    authenticatorSelection: {
      residentKey: 'required',
      userVerification: 'preferred',
    },
  });

  await saveChallenge(session.user.id, options.challenge, 'webauthn_register');

  return json(options);
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
