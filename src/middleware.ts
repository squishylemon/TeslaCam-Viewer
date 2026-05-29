import { defineMiddleware } from 'astro:middleware';
import { ensureDb } from './lib/db/pool';
import { tryUpdateSftpHostFromRequest } from './lib/sftp-credentials';
import { getConfiguredLanIp } from './lib/site-hostname';
import {
  getSession,
  securitySetupComplete,
} from './lib/auth/session';

function isAssetPath(pathname: string): boolean {
  return (
    pathname.startsWith('/_astro/') ||
    pathname === '/favicon.svg' ||
    pathname.endsWith('.css') ||
    pathname.endsWith('.js')
  );
}

function isPublicPath(pathname: string): boolean {
  if (pathname === '/login') return true;
  if (pathname === '/api/auth/login') return true;
  if (pathname === '/api/auth/totp/login') return true;
  if (pathname === '/api/auth/webauthn/login-options') return true;
  if (pathname === '/api/auth/webauthn/login-verify') return true;
  if (pathname === '/api/site/logo') return true;
  return false;
}

function pathOnly(url: URL): string {
  const p = url.pathname.replace(/\\/g, '/');
  return p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p;
}

function canAccessDuringSetup(pathname: string): boolean {
  if (pathname === '/setup-security') return true;
  if (pathname === '/api/auth/change-password') return true;
  if (pathname.startsWith('/api/auth/webauthn/')) return true;
  if (pathname.startsWith('/api/auth/totp/')) return true;
  if (pathname === '/api/auth/logout' || pathname === '/api/auth/me') return true;
  return false;
}

function configEnvMissingResponse(): Response {
  return new Response(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Setup required</title></head>
<body style="font-family:system-ui;max-width:32rem;margin:3rem auto;padding:0 1rem">
<h1>config.env required</h1>
<p>Run <code>.\setup.ps1</code> (Windows) or <code>./setup.sh</code> (Linux) to create <code>config.env</code> and detect your LAN IP.</p>
<pre style="background:#f4f4f4;padding:1rem;border-radius:8px">.\setup.ps1</pre>
<p>Run <code>.\setup.ps1</code> or <code>./setup.sh</code>, then open the URL it prints (http or https depending on <code>USE_HTTPS</code> in config.env).</p>
</body></html>`,
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}

export const onRequest = defineMiddleware(async (context, next) => {
  const pathname = pathOnly(context.url);

  if (!getConfiguredLanIp()) {
    if (!isAssetPath(pathname)) return configEnvMissingResponse();
    return next();
  }

  tryUpdateSftpHostFromRequest();

  if (isAssetPath(pathname)) return next();

  try {
    await ensureDb();
  } catch (err) {
    console.error('[teslacam] Database unavailable:', err);
    if (pathname.startsWith('/api/')) {
      return new Response(
        JSON.stringify({ error: 'Database unavailable. Start PostgreSQL with docker compose.' }),
        { status: 503, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return new Response(
      '<h1>Database unavailable</h1><p>Start PostgreSQL: <code>docker compose up</code></p>',
      { status: 503, headers: { 'Content-Type': 'text/html' } },
    );
  }

  if (isPublicPath(pathname)) return next();

  const session = await getSession(context);
  if (!session) {
    if (pathname.startsWith('/api/')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return context.redirect('/login');
  }

  context.locals.user = session.user;
  context.locals.sessionId = session.id;

  if (pathname.startsWith('/api/auth/')) {
    return next();
  }

  if (pathname.startsWith('/api/admin/')) {
    if (!session.user.isAdmin) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return next();
  }

  if (!securitySetupComplete(session.user)) {
    if (!canAccessDuringSetup(pathname)) {
      if (pathname.startsWith('/api/')) {
        return new Response(JSON.stringify({ error: 'Security setup required' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return context.redirect('/setup-security');
    }
    return next();
  }

  if (pathname === '/login' || pathname === '/setup-security') {
    return context.redirect('/');
  }

  return next();
});
