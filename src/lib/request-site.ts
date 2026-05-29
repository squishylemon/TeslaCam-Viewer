/** Hostname the browser used to reach this app (Host / X-Forwarded-Host), not the container URL. */
export function siteHostnameFromRequest(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  if (forwarded) {
    const host = forwarded.split(':')[0]?.trim().toLowerCase();
    if (host) return host;
  }

  const hostHeader = request.headers.get('host')?.trim();
  if (hostHeader) {
    const host = hostHeader.split(':')[0]?.trim().toLowerCase();
    if (host && !isLoopback(host)) return host;
  }

  return new URL(request.url).hostname.toLowerCase();
}

/** Full origin as seen by the browser (includes non-default ports). */
export function siteOriginFromRequest(request: Request): string {
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const hostHeader = request.headers.get('host')?.trim();
  const host = forwardedHost || hostHeader;

  if (host) {
    const hostname = host.split(':')[0]?.trim().toLowerCase();
    if (hostname && !isLoopback(hostname)) {
      const proto =
        request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() ||
        new URL(request.url).protocol.replace(':', '');
      return `${proto}://${host}`;
    }
  }

  return new URL(request.url).origin;
}

function isLoopback(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}
