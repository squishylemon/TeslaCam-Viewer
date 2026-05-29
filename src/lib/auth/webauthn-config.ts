import { canonicalOrigin, getSiteHostname } from '../site-hostname';

/** Passkeys use SITE_HOSTNAME from config.env (default teslacam.local). */
export function getWebAuthnConfig(_request: Request): {
  rpName: string;
  rpID: string;
  origin: string;
} {
  return {
    rpName: 'TeslaCam Viewer',
    rpID: getSiteHostname(),
    origin: canonicalOrigin(),
  };
}
