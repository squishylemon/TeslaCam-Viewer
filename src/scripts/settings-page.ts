import { startRegistration } from '@simplewebauthn/browser';
import {
  assertWebAuthnAvailable,
  initWebAuthnAvailabilityUi,
} from './webauthn-client';
import { wireThemePicker } from './theme';
import { initAdminUsers } from './settings-admin';

let panelInitialized = false;

async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return {} as T;
  }
}

const LOGO_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/svg+xml',
]);

function initLogoUpload(): void {
  const dropzone = document.getElementById('logo-dropzone');
  const input = document.getElementById('logo-file') as HTMLInputElement | null;
  const selectBtn = document.getElementById('logo-select');
  const preview = document.getElementById('logo-preview') as HTMLElement | null;
  const status = document.getElementById('logo-status');
  const removeBtn = document.getElementById('btn-remove-logo') as HTMLButtonElement | null;
  if (!input) return;

  async function uploadFile(file: File): Promise<void> {
    if (!LOGO_TYPES.has(file.type)) {
      if (status) status.textContent = 'Use PNG, JPEG, WebP, or SVG.';
      input.value = '';
      return;
    }
    if (file.size <= 0) {
      if (status) status.textContent = 'File is empty.';
      input.value = '';
      return;
    }

    if (status) status.textContent = 'Uploading…';
    if (selectBtn) (selectBtn as HTMLButtonElement).disabled = true;

    const body = new FormData();
    body.append('logo', file);

    try {
      const res = await fetch('/api/site/logo', {
        method: 'POST',
        credentials: 'same-origin',
        body,
      });
      const data = await readJson<{ error?: string; url?: string }>(res);
      if (!res.ok) {
        if (status) status.textContent = data.error ?? 'Upload failed.';
        return;
      }
      if (preview && data.url && preview instanceof HTMLImageElement) {
        preview.src = data.url;
        preview.hidden = false;
      }
      if (status) status.textContent = 'Logo updated.';
      if (removeBtn) removeBtn.hidden = false;
      dropzone?.classList.add('has-file');
      window.setTimeout(() => window.location.reload(), 600);
    } catch {
      if (status) status.textContent = 'Network error.';
    } finally {
      if (selectBtn) (selectBtn as HTMLButtonElement).disabled = false;
      input.value = '';
    }
  }

  selectBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    input.click();
  });

  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) void uploadFile(file);
  });

  if (dropzone) {
    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('is-dragover');
    });
    dropzone.addEventListener('dragleave', () => {
      dropzone.classList.remove('is-dragover');
    });
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('is-dragover');
      const file = e.dataTransfer?.files?.[0];
      if (file) void uploadFile(file);
    });
  }

  removeBtn?.addEventListener('click', async () => {
    if (status) status.textContent = 'Removing…';
    const res = await fetch('/api/site/logo', {
      method: 'DELETE',
      credentials: 'same-origin',
    });
    const data = await readJson<{ error?: string }>(res);
    if (!res.ok) {
      if (status) status.textContent = data.error ?? 'Could not remove logo.';
      return;
    }
    window.location.reload();
  });
}

function initSftpConnect(): void {
  const btn = document.getElementById('btn-sftp-connect') as HTMLButtonElement | null;
  const status = document.getElementById('sftp-copy-status');
  if (!btn) return;

  btn.addEventListener('click', () => {
    const connectUrl = btn.dataset.connectUrl?.trim();
    const winScpUrl = btn.dataset.winscpUrl?.trim();
    const isWindows = /Win/i.test(navigator.userAgent);
    const primary = (isWindows && winScpUrl) || connectUrl;
    if (!primary) return;

    if (status) {
      status.textContent = 'Opening SFTP client…';
      status.classList.remove('is-error');
    }

    const fallback = window.setTimeout(() => {
      if (status) {
        status.textContent =
          'No SFTP app responded. Copy host, port, username, and password into FileZilla or WinSCP.';
        status.classList.add('is-error');
      }
    }, 2500);

    const clearFallback = () => window.clearTimeout(fallback);
    window.addEventListener('blur', clearFallback, { once: true });

    if (isWindows && winScpUrl) {
      window.location.href = winScpUrl;
      if (connectUrl && connectUrl !== winScpUrl) {
        window.setTimeout(() => {
          window.location.href = connectUrl;
        }, 400);
      }
    } else if (connectUrl) {
      window.location.href = connectUrl;
    }
  });
}

function initSftpCopyButtons(): void {
  const status = document.getElementById('sftp-copy-status');
  document.querySelectorAll<HTMLButtonElement>('.sftp-copy').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const value = btn.dataset.copyTarget?.trim();
      if (!value) return;
      try {
        await navigator.clipboard.writeText(value);
        if (status) {
          status.textContent = 'Copied to clipboard.';
          status.classList.remove('is-error');
          status.classList.add('is-ok');
        }
      } catch {
        if (status) {
          status.textContent = 'Could not copy — select the value and copy manually.';
          status.classList.add('is-error');
        }
      }
    });
  });
}

function initPasskeyUpgrade(): void {
  const btn = document.getElementById('btn-add-passkey');
  const status = document.getElementById('passkey-upgrade-status');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    if (status) status.textContent = 'Waiting for your device…';
    btn.disabled = true;
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
      window.location.reload();
    } catch (err) {
      if (status) {
        status.textContent = err instanceof Error ? err.message : 'Passkey setup failed.';
      }
      btn.disabled = false;
    }
  });
}

/** Run once when the settings overlay is first opened. */
export function initSettingsPanel(): void {
  if (panelInitialized) return;
  panelInitialized = true;

  document.getElementById('btn-logout')?.addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    window.location.href = '/login';
  });

  const picker = document.getElementById('theme-picker');
  if (picker && !picker.dataset.wired) {
    picker.dataset.wired = '1';
    wireThemePicker(picker);
  }

  const adminSection = document.getElementById('users-admin-section');
  if (adminSection) {
    const selfId = Number.parseInt(adminSection.dataset.selfId ?? '', 10);
    if (Number.isFinite(selfId)) initAdminUsers(selfId);
  }

  initLogoUpload();
  initPasskeyUpgrade();
  initSftpCopyButtons();
  initSftpConnect();
  initWebAuthnAvailabilityUi();
}
