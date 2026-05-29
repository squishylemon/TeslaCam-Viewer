import type pg from 'pg';
import { hashPassword } from '../auth/password';
import { ROOT_ADMIN_ID, ROOT_ADMIN_USERNAME } from '../auth/root-admin';

const DEFAULT_ADMIN_PASS = 'admin';

export async function seedAdminUser(pool: pg.Pool): Promise<void> {
  const { rows } = await pool.query<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM users',
  );
  if (Number.parseInt(rows[0]?.count ?? '0', 10) > 0) return;

  const passwordHash = await hashPassword(DEFAULT_ADMIN_PASS);
  await pool.query(
    `INSERT INTO users (id, username, password_hash, must_change_password, is_admin, force_mfa)
     VALUES ($1, $2, $3, TRUE, TRUE, TRUE)`,
    [ROOT_ADMIN_ID, ROOT_ADMIN_USERNAME, passwordHash],
  );

  await pool.query(
    `SELECT setval(
       pg_get_serial_sequence('users', 'id'),
       GREATEST((SELECT COALESCE(MAX(id), 1) FROM users), 1)
     )`,
  );

  console.info(
    `[teslacam] Created default admin (id: ${ROOT_ADMIN_ID}, username: ${ROOT_ADMIN_USERNAME}, password: ${DEFAULT_ADMIN_PASS}). Change on first login.`,
  );
}
