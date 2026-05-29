import { startAuthentication } from '@simplewebauthn/browser';
import {
  assertWebAuthnAvailable,
  initWebAuthnAvailabilityUi,
} from './webauthn-client';



type LoginPanel = 'credentials' | 'totp' | 'passkey';



async function readJson<T>(res: Response): Promise<T> {

  const text = await res.text();

  if (!text) return {} as T;

  try {

    return JSON.parse(text) as T;

  } catch {

    return {} as T;

  }

}



function showError(msg: string): void {

  const errorEl = document.getElementById('login-error') as HTMLParagraphElement | null;

  if (!errorEl) return;

  errorEl.textContent = msg;

  errorEl.hidden = false;

}



function clearError(): void {

  const errorEl = document.getElementById('login-error') as HTMLParagraphElement | null;

  if (errorEl) errorEl.hidden = true;

}



function setBusy(busy: boolean): void {

  const ids = [

    'login-submit',

    'totp-submit',

    'btn-passkey-login',

    'btn-passkey-step-retry',

  ];

  for (const id of ids) {

    const el = document.getElementById(id) as HTMLButtonElement | null;

    if (el) el.disabled = busy;

  }

}



let pendingUsername = '';

let currentPanel: LoginPanel = 'credentials';



function showPanel(panel: LoginPanel): void {

  currentPanel = panel;

  const credentials = document.getElementById('login-credentials-panel');

  const totp = document.getElementById('login-totp-panel');

  const passkey = document.getElementById('login-passkey-panel');

  credentials?.toggleAttribute('hidden', panel !== 'credentials');

  totp?.toggleAttribute('hidden', panel !== 'totp');

  passkey?.toggleAttribute('hidden', panel !== 'passkey');

}



function resetToCredentials(): void {

  pendingUsername = '';

  showPanel('credentials');

  const totpInput = document.getElementById('totp-code') as HTMLInputElement | null;

  if (totpInput) totpInput.value = '';

  const status = document.getElementById('passkey-login-status');

  if (status) status.textContent = '';

  const stepStatus = document.getElementById('passkey-step-status');

  if (stepStatus) stepStatus.textContent = 'Use the passkey for this account…';

}



async function signInWithPasskey(statusElId = 'passkey-login-status'): Promise<void> {

  clearError();

  try {
    assertWebAuthnAvailable();
  } catch (err) {
    showError(err instanceof Error ? err.message : 'Passkeys are not available.');
    return;
  }

  setBusy(true);

  const status = document.getElementById(statusElId);

  if (status) status.textContent = 'Choose a passkey on your device…';



  try {

    const optRes = await fetch('/api/auth/webauthn/login-options', {

      method: 'POST',

      credentials: 'same-origin',

    });

    const options = await readJson<{ error?: string }>(optRes);

    if (!optRes.ok) {

      throw new Error(options.error ?? 'Passkey sign-in is not available.');

    }



    const attResp = await startAuthentication({ optionsJSON: options as never });

    const verifyRes = await fetch('/api/auth/webauthn/login-verify', {

      method: 'POST',

      credentials: 'same-origin',

      headers: { 'Content-Type': 'application/json' },

      body: JSON.stringify({ response: attResp }),

    });

    const verifyData = await readJson<{ error?: string; redirect?: string }>(verifyRes);

    if (!verifyRes.ok) {

      throw new Error(verifyData.error ?? 'Passkey sign-in failed.');

    }

    window.location.href = verifyData.redirect ?? '/';

  } catch (err) {

    if (status) status.textContent = '';

    const msg = err instanceof Error ? err.message : 'Passkey sign-in failed.';

    if (msg.includes('cancel') || msg.includes('abort') || msg.includes('timed out')) {

      showError('Passkey sign-in was cancelled.');

    } else {

      showError(msg);

    }

    setBusy(false);

  }

}



document.getElementById('btn-passkey-login')?.addEventListener('click', () => {

  void signInWithPasskey('passkey-login-status');

});



document.getElementById('btn-passkey-step-retry')?.addEventListener('click', () => {

  void signInWithPasskey('passkey-step-status');

});



document.getElementById('btn-back-credentials')?.addEventListener('click', () => {

  clearError();

  resetToCredentials();

});



document.getElementById('btn-back-credentials-passkey')?.addEventListener('click', () => {

  clearError();

  resetToCredentials();

});



const loginForm = document.getElementById('login-form') as HTMLFormElement | null;

loginForm?.addEventListener('submit', async (e) => {

  e.preventDefault();

  clearError();

  setBusy(true);



  const username = (document.getElementById('username') as HTMLInputElement).value.trim();

  const password = (document.getElementById('password') as HTMLInputElement).value;



  if (!username || !password) {

    showError('Username and password are required.');

    setBusy(false);

    return;

  }



  try {

    const res = await fetch('/api/auth/login', {

      method: 'POST',

      headers: { 'Content-Type': 'application/json' },

      credentials: 'same-origin',

      body: JSON.stringify({ username, password }),

    });

    const data = await readJson<{

      error?: string;

      code?: string;

      redirect?: string;

      message?: string;

    }>(res);



    if (!res.ok) {

      showError(data.error ?? 'Sign in failed.');

      setBusy(false);

      return;

    }



    if (data.code === 'PASSKEY_STEP') {

      pendingUsername = username;

      showPanel('passkey');

      setBusy(false);

      void signInWithPasskey('passkey-step-status');

      return;

    }



    if (data.code === 'TOTP_STEP') {

      pendingUsername = username;

      showPanel('totp');

      setBusy(false);

      (document.getElementById('totp-code') as HTMLInputElement | null)?.focus();

      return;

    }



    window.location.href = data.redirect ?? '/';

  } catch {

    showError('Network error. Try again.');

    setBusy(false);

  }

});



initWebAuthnAvailabilityUi();

const totpForm = document.getElementById('totp-form') as HTMLFormElement | null;

totpForm?.addEventListener('submit', async (e) => {

  e.preventDefault();

  if (currentPanel !== 'totp' || !pendingUsername) {

    showError('Sign in with your username and password first.');

    return;

  }



  clearError();

  setBusy(true);



  const totpCode = (document.getElementById('totp-code') as HTMLInputElement).value.trim();

  if (!totpCode) {

    showError('Enter your authenticator code.');

    setBusy(false);

    return;

  }



  try {

    const res = await fetch('/api/auth/totp/login', {

      method: 'POST',

      headers: { 'Content-Type': 'application/json' },

      credentials: 'same-origin',

      body: JSON.stringify({ username: pendingUsername, code: totpCode }),

    });

    const data = await readJson<{ error?: string; code?: string; redirect?: string }>(res);



    if (!res.ok) {

      if (data.code === 'PASSKEY_STEP') {

        showPanel('passkey');

        setBusy(false);

        void signInWithPasskey('passkey-step-status');

        return;

      }

      showError(data.error ?? 'Sign in failed.');

      setBusy(false);

      return;

    }



    window.location.href = data.redirect ?? '/';

  } catch {

    showError('Network error. Try again.');

    setBusy(false);

  }

});


