/** True when DEBUG=true in config.env (testing only — bypasses MFA requirements). */
export function isDebugMode(): boolean {
  const raw =
    process.env.DEBUG?.trim().toLowerCase() ??
    process.env.TESLACAM_DEBUG?.trim().toLowerCase() ??
    '';
  return raw === 'true' || raw === '1' || raw === 'yes';
}

export const DEBUG_FOOTER_MESSAGE =
  'DEBUG MODE — passkey and authenticator checks are bypassed. Do not enable in production.';
