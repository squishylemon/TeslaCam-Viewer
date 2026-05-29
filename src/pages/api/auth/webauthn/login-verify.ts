import type { APIRoute } from 'astro';
import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import {
  consumeChallenge,
  consumeDiscoverableLoginChallenge,
} from '../../../../lib/auth/challenges';
import {
  clearLoginPending,
  readLoginPending,
} from '../../../../lib/auth/login-pending';
import {
  createSession,
  loadUserById,
  securitySetupComplete,
  setSessionCookie,
} from '../../../../lib/auth/session';
import { getWebAuthnConfig } from '../../../../lib/auth/webauthn-config';
import { getPool } from '../../../../lib/db/pool';

export const prerender = false;

export const POST: APIRoute = async (context) => {
  let body: { response?: { id?: string } };
  try {
    body = await context.request.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  const response = body.response;
  const credentialId = response?.id;
  if (!response || !credentialId) {
    return json({ error: 'Missing authentication response.' }, 400);
  }

  const pool = getPool();
  const { rows } = await pool.query<{
    user_id: number;
    credential_id: string;
    public_key: Buffer;
    counter: number | string;
    transports: string | null;
    rp_id: string | null;
  }>(
    `SELECT user_id, credential_id, public_key, counter, transports, rp_id
     FROM webauthn_credentials WHERE credential_id = $1`,
    [credentialId],
  );
  const stored = rows[0];
  if (!stored) {
    return json({ error: 'Passkey not recognized.' }, 401);
  }

  const pendingUserId = readLoginPending(context);
  if (pendingUserId && stored.user_id !== pendingUserId) {
    return json({ error: 'Use the passkey for this account.' }, 403);
  }

  const { rpID, origin } = getWebAuthnConfig(context.request);
  const userId = stored.user_id;
  const expectedRPIDs = [...new Set([rpID, stored.rp_id].filter(Boolean))] as string[];

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: response as never,
      expectedChallenge: async (challenge) => {
        if (pendingUserId) {
          return consumeChallenge(pendingUserId, challenge, 'webauthn_login');
        }
        return consumeDiscoverableLoginChallenge(challenge);
      },
      expectedOrigin: origin,
      expectedRPID: expectedRPIDs.length === 1 ? expectedRPIDs[0]! : expectedRPIDs,
      credential: {
        id: stored.credential_id,
        publicKey: new Uint8Array(stored.public_key),
        counter: Number(stored.counter) || 0,
        transports: stored.transports?.split(',') ?? [],
      },
      requireUserVerification: false,
    });
  } catch (err) {
    console.error('[webauthn] login verify failed:', err);
    return json(
      {
        error:
          'Passkey sign-in failed. Open the site using the same address as when you registered your passkey (e.g. the same IP in the browser bar), or register the passkey again in Settings.',
      },
      400,
    );
  }

  if (!verification.verified || !verification.authenticationInfo) {
    return json(
      {
        error:
          'Passkey could not be verified. If you changed hostname or IP, register your passkey again in Settings while signed in.',
      },
      400,
    );
  }

  const { newCounter } = verification.authenticationInfo;
  await pool.query('UPDATE webauthn_credentials SET counter = $1 WHERE credential_id = $2', [
    newCounter,
    stored.credential_id,
  ]);

  clearLoginPending(context);
  const token = await createSession(userId);
  setSessionCookie(context, token);

  const profile = await loadUserById(userId);
  const redirect =
    profile && securitySetupComplete(profile) ? '/' : '/setup-security';

  return json({ ok: true, redirect });
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
