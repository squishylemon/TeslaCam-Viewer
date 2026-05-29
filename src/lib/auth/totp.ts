import { generateSecret, generateURI, verify } from 'otplib';

export function createTotpSecret(): string {
  return generateSecret();
}

export function buildTotpUri(username: string, secret: string): string {
  return generateURI({
    issuer: 'TeslaCam Viewer',
    label: username,
    secret,
  });
}

export async function verifyTotpCode(
  secret: string,
  token: string,
): Promise<boolean> {
  const result = await verify({
    secret,
    token,
    strategy: 'totp',
    epochTolerance: 1,
  });
  return result.valid;
}
