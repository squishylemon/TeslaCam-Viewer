import { initSettingsPanel } from './settings-page';
import { wireThemePicker } from './theme';

const SETTINGS_PARAM = 'settings';

function overlayEl(): HTMLElement | null {
  return document.getElementById('settings-overlay');
}

function settingsBtn(): HTMLButtonElement | null {
  return document.getElementById('btn-open-settings') as HTMLButtonElement | null;
}

function urlHasSettings(): boolean {
  const p = new URLSearchParams(window.location.search);
  return p.get(SETTINGS_PARAM) === '1' || p.get(SETTINGS_PARAM) === 'open';
}

function syncSettingsChrome(open: boolean): void {
  const el = overlayEl();
  const btn = settingsBtn();
  if (el) {
    el.hidden = !open;
    el.setAttribute('aria-hidden', open ? 'false' : 'true');
  }
  document.body.classList.toggle('settings-open', open);
  if (btn) {
    btn.classList.toggle('is-active', open);
    btn.setAttribute('aria-expanded', String(open));
  }
}

function pushSettingsUrl(open: boolean): void {
  const url = new URL(window.location.href);
  if (open) {
    url.searchParams.set(SETTINGS_PARAM, '1');
  } else {
    url.searchParams.delete(SETTINGS_PARAM);
  }
  const next = `${url.pathname}${url.search}${url.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next === current) return;
  if (open) {
    history.pushState({ settings: true }, '', next);
  } else {
    history.replaceState({ settings: false }, '', next);
  }
}

export function openSettings(): void {
  const el = overlayEl();
  if (!el) return;

  initSettingsPanel();

  const wasOpen = !el.hidden;
  syncSettingsChrome(true);

  if (!wasOpen) {
    pushSettingsUrl(true);
    document.getElementById('settings-close')?.focus();
  }
}

export function closeSettings(): void {
  const el = overlayEl();
  if (!el || el.hidden) return;

  syncSettingsChrome(false);
  pushSettingsUrl(false);
  settingsBtn()?.focus();
}

export function toggleSettings(): void {
  const el = overlayEl();
  if (!el) return;
  if (el.hidden) openSettings();
  else closeSettings();
}

function wireThemePickerEarly(): void {
  const picker = document.getElementById('theme-picker');
  if (picker && !picker.dataset.wired) {
    picker.dataset.wired = '1';
    wireThemePicker(picker);
  }
}

export function initSettingsOverlay(): void {
  const el = overlayEl();
  if (!el) return;

  wireThemePickerEarly();

  settingsBtn()?.addEventListener('click', (e) => {
    e.preventDefault();
    toggleSettings();
  });

  document.getElementById('settings-close')?.addEventListener('click', closeSettings);
  document.getElementById('settings-backdrop')?.addEventListener('click', closeSettings);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && el && !el.hidden) closeSettings();
  });

  window.addEventListener('popstate', () => {
    if (urlHasSettings()) openSettings();
    else closeSettings();
  });

  if (urlHasSettings()) {
    openSettings();
  } else {
    syncSettingsChrome(false);
  }
}
