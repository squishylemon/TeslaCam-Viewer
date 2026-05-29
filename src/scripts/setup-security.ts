import { startRegistration } from '@simplewebauthn/browser';
import {
  assertWebAuthnAvailable,
  initWebAuthnAvailabilityUi,
} from './webauthn-client';

async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return {} as T;
  }
}

function readConfig(root: HTMLElement) {
  return {
    mustChangePassword: root.dataset.mustChangePassword === 'true',
    forceMfa: root.dataset.forceMfa === 'true',
    hasPasskey: root.dataset.hasPasskey === 'true',
    hasTotp: root.dataset.hasTotp === 'true',
  };
}

function wireMfaTabs(): void {
  const tabPasskey = document.getElementById('tab-passkey');
  const tabTotp = document.getElementById('tab-totp');
  const panelPasskey = document.getElementById('panel-passkey');
  const panelTotp = document.getElementById('panel-totp');
  if (!tabPasskey || !tabTotp || !panelPasskey || !panelTotp) return;

  const showPasskey = () => {
    tabPasskey.classList.add('active');
    tabTotp.classList.remove('active');
    tabPasskey.setAttribute('aria-selected', 'true');
    tabTotp.setAttribute('aria-selected', 'false');
    panelPasskey.hidden = false;
    panelTotp.hidden = true;
  };

  const showTotp = () => {
    tabTotp.classList.add('active');
    tabPasskey.classList.remove('active');
    tabTotp.setAttribute('aria-selected', 'true');
    tabPasskey.setAttribute('aria-selected', 'false');
    panelTotp.hidden = false;
    panelPasskey.hidden = true;
  };

  tabPasskey.addEventListener('click', showPasskey);
  tabTotp.addEventListener('click', () => {
    showTotp();
    void loadTotpSetup();
  });
}

let totpLoadStarted = false;

async function loadTotpSetup(): Promise<void> {
  if (totpLoadStarted) return;
  totpLoadStarted = true;

  const panel = document.getElementById('totp-panel');
  const loading = document.getElementById('totp-loading') as HTMLElement | null;
  const status = document.getElementById('totp-status') as HTMLParagraphElement | null;
  const qr = document.getElementById('totp-qr') as HTMLImageElement | null;
  const secretEl = document.getElementById('totp-secret');

  if (loading) loading.hidden = false;
  if (status) status.textContent = '';

  try {
    const res = await fetch('/api/auth/totp/setup', {
      method: 'GET',
      credentials: 'same-origin',
    });
    const data = await readJson<{
      error?: string;
      qrDataUrl?: string;
      secret?: string;
    }>(res);
    if (!res.ok) {
      totpLoadStarted = false;
      if (loading) loading.textContent = data.error ?? 'Could not generate QR code.';
      if (status) status.textContent = data.error ?? 'Could not start authenticator setup.';
      return;
    }
    if (qr && data.qrDataUrl) {
      qr.src = data.qrDataUrl;
      qr.hidden = false;
    }
    if (secretEl) secretEl.textContent = data.secret ?? '';
    if (loading) loading.hidden = true;
    if (status) status.textContent = 'Scan the QR code with your authenticator app.';
  } catch {
    totpLoadStarted = false;
    if (loading) loading.textContent = 'Network error. Try again.';
    if (status) status.textContent = 'Network error. Try again.';
  }
}

function init(): void {
  const root = document.getElementById('setup-security');
  if (!root) return;

  const { mustChangePassword, forceMfa, hasPasskey, hasTotp } = readConfig(root);
  let passwordOk = !mustChangePassword;
  let passkeyOk = hasPasskey;
  let totpOk = hasTotp;

  const passwordForm = document.getElementById('password-form') as HTMLFormElement | null;
  const passwordError = document.getElementById('password-error') as HTMLParagraphElement | null;
  const passwordDone = document.getElementById('password-done') as HTMLParagraphElement | null;
  const stepPassword = document.getElementById('step-password') as HTMLElement | null;
  const stepMfa = document.getElementById('step-mfa') as HTMLElement | null;
  const btnContinue = document.getElementById('btn-continue') as HTMLButtonElement | null;
  if (!btnContinue) return;

  wireMfaTabs();

  function mfaRequired(): boolean {
    return forceMfa;
  }

  function refreshContinue(): void {
    const mfaOk = !mfaRequired() || passkeyOk || totpOk;
    btnContinue.disabled = !(passwordOk && mfaOk);
  }

  function showMfaStep(): void {
    if (stepPassword) stepPassword.hidden = true;
    if (stepMfa) stepMfa.hidden = false;
    refreshContinue();
  }

  refreshContinue();

  passwordForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (passwordError) passwordError.hidden = true;

    const newPassword = (document.getElementById('new-password') as HTMLInputElement).value;
    const confirm = (document.getElementById('confirm-password') as HTMLInputElement).value;
    if (newPassword !== confirm) {
      if (passwordError) {
        passwordError.textContent = 'Passwords do not match.';
        passwordError.hidden = false;
      }
      return;
    }

    const currentEl = document.getElementById('current-password') as HTMLInputElement | null;
    const res = await fetch('/api/auth/change-password', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currentPassword: currentEl?.value ?? '',
        newPassword,
      }),
    });
    const data = await readJson<{ error?: string }>(res);
    if (!res.ok) {
      if (passwordError) {
        passwordError.textContent = data.error ?? 'Could not update password.';
        passwordError.hidden = false;
      }
      return;
    }

    passwordOk = true;
    passwordForm.hidden = true;
    if (passwordDone) passwordDone.hidden = false;
    if (mfaRequired()) {
      showMfaStep();
    } else {
      window.location.href = '/';
    }
  });

  if (!mustChangePassword) {
    if (stepPassword) stepPassword.hidden = true;
    if (mfaRequired()) {
      if (stepMfa) stepMfa.hidden = false;
    } else if (passkeyOk || totpOk) {
      window.location.href = '/';
    }
  }

  initWebAuthnAvailabilityUi();

  document.getElementById('btn-passkey')?.addEventListener('click', async () => {
    const status = document.getElementById('passkey-status') as HTMLParagraphElement | null;
    if (status) status.textContent = 'Waiting for your device…';
    try {
      assertWebAuthnAvailable();
      const optRes = await fetch('/api/auth/webauthn/register-options', {
        method: 'POST',
        credentials: 'same-origin',
      });
      const options = await readJson<{ error?: string }>(optRes);
      if (!optRes.ok) throw new Error(options.error ?? 'Failed to start passkey setup.');
      const attResp = await startRegistration({ optionsJSON: options as never });
      const verifyRes = await fetch('/api/auth/webauthn/register-verify', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response: attResp }),
      });
      const verifyData = await readJson<{ error?: string }>(verifyRes);
      if (!verifyRes.ok) throw new Error(verifyData.error ?? 'Passkey registration failed.');
      passkeyOk = true;
      if (status) status.textContent = 'Passkey registered.';
      refreshContinue();
    } catch (err) {
      if (status) {
        status.textContent = err instanceof Error ? err.message : 'Passkey setup failed.';
      }
    }
  });

  document.getElementById('btn-totp-enable')?.addEventListener('click', async () => {
    const status = document.getElementById('totp-status') as HTMLParagraphElement | null;
    const code = (document.getElementById('totp-code') as HTMLInputElement).value;
    const res = await fetch('/api/auth/totp/enable', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const data = await readJson<{ error?: string }>(res);
    if (!res.ok) {
      if (status) status.textContent = data.error ?? 'Invalid code.';
      return;
    }
    totpOk = true;
    if (status) status.textContent = 'Authenticator enabled.';
    refreshContinue();
  });

  btnContinue.addEventListener('click', () => {
    const mfaOk = !mfaRequired() || passkeyOk || totpOk;
    if (passwordOk && mfaOk) window.location.href = '/';
  });
}

init();
