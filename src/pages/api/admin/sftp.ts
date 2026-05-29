import type { APIRoute } from 'astro';
import { requireAdmin, json } from '../../../lib/auth/admin';
import { getSftpConnectionInfo } from '../../../lib/sftp-info';
import { effectiveTeslacamDir, validateTeslacamDir } from '../../../lib/site-config';

export const prerender = false;

export const GET: APIRoute = async (context) => {
  const auth = await requireAdmin(context);
  if (auth instanceof Response) return auth;

  const sftp = getSftpConnectionInfo();
  const check = validateTeslacamDir(effectiveTeslacamDir());

  return json({
    sftp,
    library: check,
  });
};
