import pg from 'pg';
import { ensureSftpHostDetected } from '../sftp-credentials';
import { migrate } from './migrate';
import { seedAdminUser } from './seed';

const { Pool } = pg;

let pool: pg.Pool | null = null;
let ready: Promise<void> | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error(
        'DATABASE_URL is not set. Start PostgreSQL (e.g. docker compose up) and configure DATABASE_URL.',
      );
    }
    pool = new Pool({ connectionString: url });
  }
  return pool;
}

/** Run migrations and default admin seed once per process. */
export function ensureDb(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await ensureSftpHostDetected();
      await migrate(getPool());
      await seedAdminUser(getPool());
    })();
  }
  return ready;
}
