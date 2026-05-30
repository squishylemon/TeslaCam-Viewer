type LibraryLocation = {
  id: string;
  name: string;
  path: string;
  type: string;
  requiresCredentials: boolean;
  enabled: boolean;
  hasPassword: boolean;
};

async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return {} as T;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function modal(): HTMLElement | null {
  return document.getElementById('location-modal');
}

function openModal(title: string, loc?: LibraryLocation): void {
  const m = modal();
  if (!m) return;
  const titleEl = document.getElementById('location-modal-title');
  if (titleEl) titleEl.textContent = title;

  const idInput = document.getElementById('location-edit-id') as HTMLInputElement | null;
  const nameInput = document.getElementById('location-name') as HTMLInputElement | null;
  const pathInput = document.getElementById('location-path') as HTMLInputElement | null;
  const credsCheck = document.getElementById(
    'location-requires-credentials',
  ) as HTMLInputElement | null;
  const userInput = document.getElementById('location-username') as HTMLInputElement | null;
  const passInput = document.getElementById('location-password') as HTMLInputElement | null;
  const enabledCheck = document.getElementById('location-enabled') as HTMLInputElement | null;
  const status = document.getElementById('location-form-status');

  if (idInput) idInput.value = loc?.id ?? '';
  if (nameInput) nameInput.value = loc?.name ?? '';
  if (pathInput) pathInput.value = loc?.path ?? '';
  if (credsCheck) credsCheck.checked = loc?.requiresCredentials ?? false;
  if (userInput) userInput.value = '';
  if (passInput) {
    passInput.value = '';
    passInput.placeholder = loc?.hasPassword ? 'Leave blank to keep current' : '';
  }
  if (enabledCheck) enabledCheck.checked = loc?.enabled !== false;
  if (status) status.textContent = '';

  toggleCredentialsFields();
  m.hidden = false;
  m.setAttribute('aria-hidden', 'false');
  nameInput?.focus();
}

function closeModal(): void {
  const m = modal();
  if (!m) return;
  m.hidden = true;
  m.setAttribute('aria-hidden', 'true');
}

function toggleCredentialsFields(): void {
  const credsCheck = document.getElementById(
    'location-requires-credentials',
  ) as HTMLInputElement | null;
  const wrap = document.getElementById('location-credentials');
  const userInput = document.getElementById('location-username') as HTMLInputElement | null;
  const passInput = document.getElementById('location-password') as HTMLInputElement | null;
  if (!wrap || !credsCheck) return;
  const show = credsCheck.checked;
  wrap.hidden = !show;
  wrap.setAttribute('aria-hidden', show ? 'false' : 'true');
  if (userInput) {
    userInput.disabled = !show;
    userInput.tabIndex = show ? 0 : -1;
  }
  if (passInput) {
    passInput.disabled = !show;
    passInput.tabIndex = show ? 0 : -1;
  }
}

function renderLocations(locations: LibraryLocation[]): void {
  const list = document.getElementById('locations-list');
  if (!list) return;
  if (locations.length === 0) {
    list.innerHTML = '<li class="field-hint">No external locations yet.</li>';
    return;
  }
  list.innerHTML = locations
    .map(
      (loc) => `
    <li class="location-item" data-id="${escapeHtml(loc.id)}">
      <div class="location-item-head">
        <div>
          <p class="location-item-name">${escapeHtml(loc.name)}</p>
          <p class="location-item-path">${escapeHtml(loc.path)} · ${escapeHtml(loc.type)}${loc.enabled ? '' : ' · disabled'}</p>
        </div>
      </div>
      <div class="location-item-actions">
        <button type="button" class="btn-ghost" data-action="edit">Edit</button>
        <button type="button" class="btn-ghost" data-action="toggle">${loc.enabled ? 'Disable' : 'Enable'}</button>
        <button type="button" class="btn-text-danger" data-action="delete">Remove</button>
      </div>
    </li>`,
    )
    .join('');
}

async function loadLocations(): Promise<LibraryLocation[]> {
  const res = await fetch('/api/admin/locations', { credentials: 'same-origin' });
  const data = await readJson<{ locations?: LibraryLocation[]; error?: string }>(res);
  if (!res.ok) throw new Error(data.error ?? 'Failed to load locations');
  return data.locations ?? [];
}

async function refreshList(): Promise<void> {
  const status = document.getElementById('locations-status');
  try {
    const locations = await loadLocations();
    renderLocations(locations);
    if (status) status.textContent = '';
  } catch (err) {
    if (status) {
      status.textContent = err instanceof Error ? err.message : 'Failed to load locations';
    }
  }
}

async function saveBuiltinSftp(enabled: boolean): Promise<void> {
  const res = await fetch('/api/admin/library-settings', {
    method: 'PATCH',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ builtinSftpEnabled: enabled }),
  });
  const data = await readJson<{ error?: string }>(res);
  if (!res.ok) throw new Error(data.error ?? 'Failed to update SFTP setting');
  window.setTimeout(() => window.location.reload(), 400);
}

export function initLibraryLocations(): void {
  const section = document.getElementById('libraries-admin-section');
  if (!section) return;

  toggleCredentialsFields();
  void refreshList();

  document.getElementById('btn-new-location')?.addEventListener('click', () => {
    openModal('New location');
  });

  document.getElementById('location-cancel')?.addEventListener('click', closeModal);
  document.getElementById('location-modal-backdrop')?.addEventListener('click', closeModal);

  document
    .getElementById('location-requires-credentials')
    ?.addEventListener('change', toggleCredentialsFields);

  document.getElementById('builtin-sftp-enabled')?.addEventListener('change', async (e) => {
    const el = e.target as HTMLInputElement;
    const status = document.getElementById('locations-status');
    try {
      if (status) status.textContent = 'Saving…';
      await saveBuiltinSftp(el.checked);
    } catch (err) {
      el.checked = !el.checked;
      if (status) {
        status.textContent = err instanceof Error ? err.message : 'Save failed';
      }
    }
  });

  document.getElementById('locations-list')?.addEventListener('click', async (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
    if (!btn) return;
    const item = btn.closest<HTMLElement>('.location-item');
    const id = item?.dataset.id;
    if (!id) return;
    const action = btn.dataset.action;
    const status = document.getElementById('locations-status');

    if (action === 'edit') {
      const locations = await loadLocations();
      const loc = locations.find((l) => l.id === id);
      if (loc) openModal('Edit location', loc);
      return;
    }

    if (action === 'delete') {
      if (!confirm('Remove this library location?')) return;
      const res = await fetch(`/api/admin/locations/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      const data = await readJson<{ error?: string }>(res);
      if (!res.ok) {
        if (status) status.textContent = data.error ?? 'Delete failed';
        return;
      }
      window.location.reload();
      return;
    }

    if (action === 'toggle') {
      const locations = await loadLocations();
      const loc = locations.find((l) => l.id === id);
      if (!loc) return;
      const res = await fetch(`/api/admin/locations/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !loc.enabled }),
      });
      const data = await readJson<{ error?: string }>(res);
      if (!res.ok) {
        if (status) status.textContent = data.error ?? 'Update failed';
        return;
      }
      window.location.reload();
    }
  });

  document.getElementById('location-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const status = document.getElementById('location-form-status');
    const id = (document.getElementById('location-edit-id') as HTMLInputElement | null)?.value;
    const name = (document.getElementById('location-name') as HTMLInputElement).value.trim();
    const path = (document.getElementById('location-path') as HTMLInputElement).value.trim();
    const requiresCredentials = (
      document.getElementById('location-requires-credentials') as HTMLInputElement
    ).checked;
    const username = (document.getElementById('location-username') as HTMLInputElement).value;
    const password = (document.getElementById('location-password') as HTMLInputElement).value;
    const enabled = (document.getElementById('location-enabled') as HTMLInputElement).checked;

    const body: Record<string, unknown> = {
      name,
      path,
      requiresCredentials,
      enabled,
    };
    if (requiresCredentials) {
      body.username = username;
      if (password) body.password = password;
    }

    const isEdit = Boolean(id);
    const url = isEdit ? `/api/admin/locations/${encodeURIComponent(id!)}` : '/api/admin/locations';
    const method = isEdit ? 'PATCH' : 'POST';

    if (status) status.textContent = 'Saving…';
    const res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await readJson<{ error?: string }>(res);
    if (!res.ok) {
      if (status) status.textContent = data.error ?? 'Save failed';
      return;
    }
    closeModal();
    window.location.reload();
  });
}
