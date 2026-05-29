const PASSWORD_CHARS =
  'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%&*-_+';

export function generateClientPassword(length = 20): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => PASSWORD_CHARS[b % PASSWORD_CHARS.length]).join('');
}

export interface AdminUser {
  id: number;
  username: string;
  isAdmin: boolean;
  forceMfa: boolean;
  mustChangePassword: boolean;
  hasPasskey: boolean;
  hasTotp: boolean;
  createdAt: string;
}

async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return {} as T;
  }
}

function setStatus(el: HTMLElement | null, msg: string, kind: 'ok' | 'error' | '' = '') {
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('is-error', 'is-ok');
  if (kind) el.classList.add(kind === 'error' ? 'is-error' : 'is-ok');
}

function mfaLabel(u: AdminUser): string {
  if (u.hasPasskey && u.hasTotp) return 'Passkey + Authenticator';
  if (u.hasPasskey) return 'Passkey';
  if (u.hasTotp) return 'Authenticator';
  if (u.forceMfa) return '2FA required (not set up)';
  return '2FA optional';
}

const ROOT_ADMIN_ID = 1;

function renderUserRow(u: AdminUser, selfId: number): string {
  const isRootAdmin = u.id === ROOT_ADMIN_ID;
  const pills = [
    u.isAdmin ? '<span class="user-pill user-pill--admin">Admin</span>' : '',
    u.forceMfa ? '<span class="user-pill user-pill--on">Force 2FA</span>' : '',
    u.hasPasskey || u.hasTotp
      ? '<span class="user-pill user-pill--on">2FA active</span>'
      : '',
  ]
    .filter(Boolean)
    .join('');

  const canDelete = u.id !== selfId && !isRootAdmin;

  return `
    <article class="user-row" data-user-id="${u.id}">
      <div class="user-row-summary">
        <div class="user-row-top">
          <div class="user-row-identity">
            <span class="user-row-initial" aria-hidden="true">${escapeHtml(u.username.slice(0, 1).toUpperCase())}</span>
            <div class="user-row-id-text">
              <span class="user-row-name">${escapeHtml(u.username)}</span>
              <p class="user-row-meta">${escapeHtml(mfaLabel(u))}</p>
            </div>
          </div>
          <div class="user-row-badges">${pills || '<span class="user-pill">Standard</span>'}</div>
        </div>
        <div class="user-row-toolbar">
          <button type="button" class="btn-ghost" data-action="edit">Edit</button>
          ${
            canDelete
              ? `<button type="button" class="btn-ghost btn-ghost--danger" data-action="delete">Delete</button>`
              : ''
          }
        </div>
      </div>
      <div class="user-edit-panel" id="edit-panel-${u.id}" hidden>
        <p class="user-edit-heading">Edit user</p>
        <div class="user-edit-fields">
          <label class="admin-field">
            <span>Username</span>
            <input type="text" data-field="username" value="${escapeHtml(u.username)}" autocomplete="off" />
          </label>
          <label class="admin-field">
            <span>New password</span>
            <p class="field-hint">Leave blank to keep the current password.</p>
            <div class="password-row">
              <input type="text" data-field="password" placeholder="Optional" autocomplete="new-password" />
              <button type="button" class="btn-secondary" data-action="gen-password">Generate</button>
            </div>
          </label>
          <label class="admin-check${isRootAdmin ? ' admin-check--locked' : ''}">
            <input type="checkbox" data-field="forceMfa" ${u.forceMfa ? 'checked' : ''} ${isRootAdmin ? 'disabled checked' : ''} />
            <span>Require 2FA on login${isRootAdmin ? ' (required for default admin)' : ''}</span>
          </label>
          <label class="admin-check${isRootAdmin ? ' admin-check--locked' : ''}">
            <input type="checkbox" data-field="isAdmin" ${u.isAdmin ? 'checked' : ''} ${isRootAdmin ? 'disabled checked' : ''} />
            <span>Administrator (full settings access)${isRootAdmin ? ' (always on for default admin)' : ''}</span>
          </label>
        </div>
        <div class="user-edit-actions">
          <button type="button" class="step-btn step-btn--sm" data-action="save">Save changes</button>
          ${
            isRootAdmin
              ? ''
              : '<button type="button" class="btn-ghost" data-action="reset-mfa">Reset 2FA</button>'
          }
          <button type="button" class="btn-ghost" data-action="cancel-edit">Cancel</button>
        </div>
        <p class="admin-status user-edit-status" data-edit-status></p>
      </div>
    </article>
  `;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function wireUsersTabs(): void {
  const tabs = document.querySelectorAll<HTMLButtonElement>('[data-users-tab]');
  const panelCreate = document.getElementById('users-panel-create');
  const panelList = document.getElementById('users-panel-list');
  if (!tabs.length || !panelCreate || !panelList) return;

  const show = (which: 'create' | 'list') => {
    for (const tab of tabs) {
      const active = tab.dataset.usersTab === which;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    }
    panelCreate.hidden = which !== 'create';
    panelList.hidden = which !== 'list';
  };

  for (const tab of tabs) {
    tab.addEventListener('click', () => {
      const which = tab.dataset.usersTab as 'create' | 'list';
      if (which) show(which);
    });
  }
}

export function initAdminUsers(selfId: number): void {
  const listEl = document.getElementById('users-list');
  const loadStatus = document.getElementById('users-load-status');
  const createForm = document.getElementById('create-user-form') as HTMLFormElement | null;
  const createPassword = document.getElementById('create-password') as HTMLInputElement | null;
  const createStatus = document.getElementById('create-user-status');

  if (!listEl) return;

  wireUsersTabs();

  const fillCreatePassword = () => {
    if (createPassword) createPassword.value = generateClientPassword();
  };
  fillCreatePassword();

  document.getElementById('btn-gen-create-password')?.addEventListener('click', fillCreatePassword);

  async function loadUsers(): Promise<AdminUser[]> {
    const res = await fetch('/api/admin/users', { credentials: 'same-origin' });
    const data = await readJson<{ error?: string; users?: AdminUser[] }>(res);
    if (!res.ok) throw new Error(data.error ?? 'Failed to load users.');
    return data.users ?? [];
  }

  function paint(users: AdminUser[]): void {
    if (loadStatus) loadStatus.hidden = true;
    listEl.hidden = false;
    listEl.classList.toggle('users-list--empty', users.length === 0);

    const countEl = document.getElementById('users-count');
    if (countEl) {
      countEl.hidden = false;
      countEl.textContent = String(users.length);
    }

    if (users.length === 0) {
      listEl.innerHTML =
        '<p class="users-empty">No other users yet. Create one above.</p>';
      return;
    }

    listEl.innerHTML = users.map((u) => renderUserRow(u, selfId)).join('');
    wireListActions(users);
  }

  async function refresh(): Promise<void> {
    try {
      const users = await loadUsers();
      paint(users);
    } catch (e) {
      if (loadStatus) {
        loadStatus.hidden = false;
        loadStatus.classList.add('is-error');
      }
      setStatus(
        loadStatus,
        e instanceof Error ? e.message : 'Could not load users.',
        'error',
      );
    }
  }

  function wireListActions(users: AdminUser[]): void {
    for (const u of users) {
      const row = listEl.querySelector(`[data-user-id="${u.id}"]`);
      if (!row) continue;

      const editBtn = row.querySelector('[data-action="edit"]') as HTMLButtonElement | null;
      const panel = document.getElementById(`edit-panel-${u.id}`);

      const setEditing = (open: boolean) => {
        row.classList.toggle('is-editing', open);
        editBtn?.classList.toggle('is-active', open);
        if (panel) panel.hidden = !open;
      };

      editBtn?.addEventListener('click', () => {
        const willOpen = panel?.hidden !== false;
        listEl.querySelectorAll('.user-row.is-editing').forEach((other) => {
          if (other !== row) {
            other.classList.remove('is-editing');
            other.querySelector('.user-edit-panel')?.setAttribute('hidden', '');
            other
              .querySelector('[data-action="edit"]')
              ?.classList.remove('is-active');
          }
        });
        setEditing(willOpen);
      });

      row.querySelector('[data-action="cancel-edit"]')?.addEventListener('click', () => {
        setEditing(false);
      });

      row.querySelector('[data-action="gen-password"]')?.addEventListener('click', () => {
        const input = panelInput(u.id, 'password');
        if (input) input.value = generateClientPassword();
      });

      row.querySelector('[data-action="save"]')?.addEventListener('click', () => {
        void saveUser(u.id);
      });

      row.querySelector('[data-action="reset-mfa"]')?.addEventListener('click', () => {
        if (
          !confirm(
            `Reset 2FA for "${u.username}"? They will need to set up passkey or authenticator again.`,
          )
        ) {
          return;
        }
        void patchUser(u.id, { resetMfa: true });
      });

      row.querySelector('[data-action="delete"]')?.addEventListener('click', () => {
        if (!confirm(`Delete user "${u.username}"? This cannot be undone.`)) return;
        void deleteUser(u.id);
      });
    }
  }

  function panelInput(userId: number, field: string): HTMLInputElement | null {
    const panel = document.getElementById(`edit-panel-${userId}`);
    return panel?.querySelector(`[data-field="${field}"]`) as HTMLInputElement | null;
  }

  function editStatus(userId: number): HTMLElement | null {
    return document.querySelector(`#edit-panel-${userId} [data-edit-status]`);
  }

  async function patchUser(
    userId: number,
    body: Record<string, unknown>,
  ): Promise<void> {
    const status = editStatus(userId);
    setStatus(status, 'Saving…');
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await readJson<{ error?: string; users?: AdminUser[] }>(res);
    if (!res.ok) {
      setStatus(status, data.error ?? 'Update failed.', 'error');
      return;
    }
    setStatus(status, 'Saved.', 'ok');
    if (data.users) paint(data.users);
  }

  async function saveUser(userId: number): Promise<void> {
    const username = panelInput(userId, 'username')?.value.trim();
    const password = panelInput(userId, 'password')?.value.trim();
    const forceMfa = (
      document.querySelector(
        `#edit-panel-${userId} [data-field="forceMfa"]`,
      ) as HTMLInputElement | null
    )?.checked;
    const isAdminEl = document.querySelector(
      `#edit-panel-${userId} [data-field="isAdmin"]`,
    ) as HTMLInputElement | null;

    const body: Record<string, unknown> = {};
    if (username) body.username = username;
    if (password) body.password = password;
    if (userId !== ROOT_ADMIN_ID) {
      if (forceMfa !== undefined) body.forceMfa = forceMfa;
      if (isAdminEl) body.isAdmin = isAdminEl.checked;
    }
    await patchUser(userId, body);
  }

  async function deleteUser(userId: number): Promise<void> {
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    });
    const data = await readJson<{ error?: string; users?: AdminUser[] }>(res);
    if (!res.ok) {
      alert(data.error ?? 'Delete failed.');
      return;
    }
    if (data.users) paint(data.users);
  }

  createForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    setStatus(createStatus, 'Creating…');
    const username = (document.getElementById('create-username') as HTMLInputElement).value;
    const password = createPassword?.value ?? '';
    const forceMfa = (document.getElementById('create-force-mfa') as HTMLInputElement)
      .checked;
    const isAdmin = (document.getElementById('create-is-admin') as HTMLInputElement)
      .checked;

    const res = await fetch('/api/admin/users', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, forceMfa, isAdmin }),
    });
    const data = await readJson<{ error?: string; users?: AdminUser[] }>(res);
    if (!res.ok) {
      setStatus(createStatus, data.error ?? 'Could not create user.', 'error');
      return;
    }
    setStatus(createStatus, `Created user "${username.trim().toLowerCase()}".`, 'ok');
    (document.getElementById('create-username') as HTMLInputElement).value = '';
    fillCreatePassword();
    if (data.users) {
      paint(data.users);
      document.querySelector<HTMLButtonElement>('[data-users-tab="list"]')?.click();
    }
  });

  void refresh();
}
