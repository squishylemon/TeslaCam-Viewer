import {
  DEFAULT_THEME,
  isThemePreference,
  resolveTheme,
  THEME_STORAGE_KEY,
  type ThemePreference,
} from '../lib/theme';

export function getStoredTheme(): ThemePreference {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (raw && isThemePreference(raw)) return raw;
  } catch {
    /* private browsing */
  }
  return DEFAULT_THEME;
}

export function applyTheme(preference?: ThemePreference): void {
  const pref = preference ?? getStoredTheme();
  const resolved = resolveTheme(pref);
  const root = document.documentElement;
  root.dataset.themePreference = pref;
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
}

export function setTheme(preference: ThemePreference): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    /* ignore */
  }
  applyTheme(preference);
}

export function initTheme(): void {
  applyTheme();
  window
    .matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', () => {
      if (getStoredTheme() === 'system') applyTheme();
    });
}

export function wireThemePicker(container: HTMLElement): void {
  const buttons = [
    ...container.querySelectorAll<HTMLButtonElement>('[data-theme-value]'),
  ];

  const sync = () => {
    const pref = getStoredTheme();
    for (const btn of buttons) {
      const active = btn.dataset.themeValue === pref;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-checked', String(active));
    }
  };

  for (const btn of buttons) {
    btn.addEventListener('click', () => {
      const value = btn.dataset.themeValue;
      if (!value || !isThemePreference(value)) return;
      setTheme(value);
      sync();
    });
  }

  sync();
}

initTheme();
