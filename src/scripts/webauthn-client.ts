function siteHostnameFromDom(): string {
  return (
    document.documentElement.dataset.siteHostname?.trim().toLowerCase() ||
    'teslacam.local'
  );
}

function isIpv4Host(host: string): boolean {
  return /^\d+\.\d+\.\d+\.\d+$/.test(host.trim());
}

/** Passkeys need HTTPS (or http://localhost). Plain HTTP on a LAN IP is not a secure context. */
export function isWebAuthnAvailable(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    typeof window.PublicKeyCredential === 'function' &&
    !isIpv4Host(window.location.hostname)
  );
}

export function webAuthnUnavailableReason(): string | null {
  if (typeof window === 'undefined') return null;
  if (isWebAuthnAvailable()) return null;

  const siteHost = siteHostnameFromDom();
  const { protocol, host, hostname, port } = window.location;

  if (isIpv4Host(hostname)) {
    return `Passkeys cannot use IP addresses. Add a hosts file line mapping your LAN IP to ${siteHost}, then open https://${siteHost}${port ? `:${port}` : ''}.`;
  }

  if (hostname !== siteHost && !hostname.endsWith('.local')) {
    return `Open this site at https://${siteHost}${port ? `:${port}` : ''} (not ${hostname}) so passkeys work.`;
  }

  if (!window.isSecureContext) {
    if (protocol === 'https:') {
      return 'Passkeys are blocked in this browser context. Try Chrome or Edge.';
    }
    return `Passkeys require HTTPS. Open https://${siteHost}${port ? `:${port}` : ''} (accept the certificate warning once). You are on ${protocol}//${host}.`;
  }

  return 'WebAuthn is not available in this browser. Try Chrome, Edge, or Firefox.';
}

export function assertWebAuthnAvailable(): void {
  const reason = webAuthnUnavailableReason();
  if (reason) throw new Error(reason);
}

/** Show a hint and disable passkey controls when WebAuthn cannot run. */
export function initWebAuthnAvailabilityUi(): void {
  const reason = webAuthnUnavailableReason();
  if (!reason) return;

  const banner = document.getElementById('webauthn-unavailable-hint');
  if (banner) {
    banner.textContent = reason;
    banner.hidden = false;
  }

  for (const id of [
    'btn-passkey-login',
    'btn-passkey-step-retry',
    'btn-add-passkey',
    'btn-passkey',
  ]) {
    const el = document.getElementById(id) as HTMLButtonElement | null;
    if (el) {
      el.disabled = true;
      el.title = reason;
    }
  }
}
