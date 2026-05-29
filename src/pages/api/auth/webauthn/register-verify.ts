import type { APIRoute } from 'astro';
import { verifyRegistrationResponse } from '@simplewebauthn/server';
import { getSession } from '../../../../lib/auth/session';
import { getWebAuthnConfig } from '../../../../lib/auth/webauthn-config';
import { consumeChallenge } from '../../../../lib/auth/challenges';
import { getPool } from '../../../../lib/db/pool';

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const session = await getSession(context);
  if (!session) return unauthorized();

  let body: { response?: unknown };
  try {
    body = await context.request.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  if (!body.response) return json({ error: 'Missing registration response.' }, 400);

  const { rpID, origin } = getWebAuthnConfig(context.request);

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: body.response as never,
      expectedChallenge: async (challenge) =>
        consumeChallenge(session.user.id, challenge, 'webauthn_register'),
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
    });
  } catch (err) {
    console.error('[webauthn] register verify failed:', err);
    return json({ error: 'Passkey registration failed.' }, 400);
  }

  if (!verification.verified || !verification.registrationInfo) {
    return json({ error: 'Passkey registration could not be verified.' }, 400);
  }

  const { credential, credentialDeviceType } = verification.registrationInfo;
  const pool = getPool();
  await pool.query(
    `INSERT INTO webauthn_credentials (user_id, credential_id, public_key, counter, transports, rp_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      session.user.id,
      credential.id,
      Buffer.from(credential.publicKey),
      credential.counter,
      credentialDeviceType,
      rpID,
    ],
  );

  return json({ ok: true, verified: true });
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
