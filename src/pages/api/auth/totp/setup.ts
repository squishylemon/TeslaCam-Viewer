import type { APIRoute } from 'astro';
import QRCode from 'qrcode';
import { buildTotpUri, createTotpSecret } from '../../../../lib/auth/totp';
import { getSession } from '../../../../lib/auth/session';
import { getPool } from '../../../../lib/db/pool';

export const prerender = false;

async function handleSetup(context: Parameters<APIRoute>[0]) {
  try {
    const session = await getSession(context);
    if (!session) return unauthorized();

    const pool = getPool();
    const { rows } = await pool.query(
      'SELECT user_id FROM totp_secrets WHERE user_id = $1 AND enabled_at IS NOT NULL',
      [session.user.id],
    );
    if (rows.length > 0) {
      return json(
        { error: 'Authenticator already enabled. Remove it first to re-register.' },
        400,
      );
    }

    const secret = createTotpSecret();
    const otpauth = buildTotpUri(session.user.username, secret);
    const qrDataUrl = await QRCode.toDataURL(otpauth, {
      margin: 1,
      width: 220,
      errorCorrectionLevel: 'M',
    });

    await pool.query('DELETE FROM totp_secrets WHERE user_id = $1', [session.user.id]);
    await pool.query(
      `INSERT INTO totp_secrets (user_id, secret, enabled_at) VALUES ($1, $2, NULL)`,
      [session.user.id, secret],
    );

    return json({ secret, otpauth, qrDataUrl });
  } catch (err) {
    console.error('[totp/setup]', err);
    return json({ error: 'Could not generate authenticator QR code.' }, 500);
  }
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

/** GET avoids Astro origin-check 403 on some localhost fetch POSTs. */
export const GET: APIRoute = (context) => handleSetup(context);

export const POST: APIRoute = (context) => handleSetup(context);
