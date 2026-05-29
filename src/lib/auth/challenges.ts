import type pg from 'pg';
import { getPool } from '../db/pool';

export type ChallengeKind = 'webauthn_register' | 'webauthn_login';

export async function saveChallenge(
  userId: number,
  challenge: string,
  kind: ChallengeKind,
  ttlMs = 5 * 60 * 1000,
): Promise<string> {
  const pool = getPool();
  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + ttlMs);
  await pool.query(
    `INSERT INTO auth_challenges (id, user_id, challenge, kind, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, userId, challenge, kind, expiresAt.toISOString()],
  );
  return id;
}

export async function consumeChallenge(
  userId: number,
  challenge: string,
  kind: ChallengeKind,
): Promise<boolean> {
  const pool = getPool();
  const { rowCount } = await pool.query(
    `DELETE FROM auth_challenges
     WHERE user_id = $1 AND challenge = $2 AND kind = $3 AND expires_at > NOW()`,
    [userId, challenge, kind],
  );
  return (rowCount ?? 0) > 0;
}

/** Discoverable passkey sign-in (no username yet — user picked in browser). */
export async function saveDiscoverableLoginChallenge(challenge: string): Promise<void> {
  const pool = getPool();
  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
  await pool.query(
    `INSERT INTO auth_challenges (id, user_id, challenge, kind, expires_at)
     VALUES ($1, NULL, $2, 'webauthn_login', $3)`,
    [id, challenge, expiresAt.toISOString()],
  );
}

export async function consumeDiscoverableLoginChallenge(
  challenge: string,
): Promise<boolean> {
  const pool = getPool();
  const { rowCount } = await pool.query(
    `DELETE FROM auth_challenges
     WHERE user_id IS NULL AND challenge = $1 AND kind = 'webauthn_login' AND expires_at > NOW()`,
    [challenge],
  );
  return (rowCount ?? 0) > 0;
}

export async function purgeExpiredChallenges(pool: pg.Pool): Promise<void> {
  await pool.query('DELETE FROM auth_challenges WHERE expires_at <= NOW()');
}
