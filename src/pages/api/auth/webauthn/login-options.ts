import type { APIRoute } from 'astro';
import { generateAuthenticationOptions } from '@simplewebauthn/server';
import {
  saveChallenge,
  saveDiscoverableLoginChallenge,
} from '../../../../lib/auth/challenges';
import { readLoginPending } from '../../../../lib/auth/login-pending';
import { getWebAuthnConfig } from '../../../../lib/auth/webauthn-config';
import { getPool } from '../../../../lib/db/pool';

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const pool = getPool();
  const pendingUserId = readLoginPending(context);

  const { rpID } = getWebAuthnConfig(context.request);

  if (pendingUserId) {
    const { rows } = await pool.query<{
      credential_id: string;
      transports: string | null;
    }>(
      `SELECT credential_id, transports FROM webauthn_credentials WHERE user_id = $1`,
      [pendingUserId],
    );
    if (rows.length === 0) {
      return json({ error: 'No passkey found for this account.' }, 401);
    }

    const options = await generateAuthenticationOptions({
      rpID,
      allowCredentials: rows.map((row) => ({
        id: row.credential_id,
        transports: row.transports?.split(',') ?? [],
      })),
      userVerification: 'preferred',
    });

    await saveChallenge(pendingUserId, options.challenge, 'webauthn_login');
    return json(options);
  }

  const { rows } = await pool.query<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM webauthn_credentials',
  );
  if (Number.parseInt(rows[0]?.count ?? '0', 10) === 0) {
    return json({ error: 'No passkeys are registered yet.' }, 401);
  }

  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: 'preferred',
  });

  await saveDiscoverableLoginChallenge(options.challenge);

  return json(options);
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
