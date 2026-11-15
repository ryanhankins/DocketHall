/*
 * Copyright 2026 Ryan Hankins
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { ROLE_LABELS, state, api, formatDate, showToast } from './state.js';

function showPasswordBanner(username, password) {
  document.getElementById('pw-user').textContent = username;
  document.getElementById('pw-value').textContent = password;
  document.getElementById('pw-copy').textContent = 'Copy';
  document.getElementById('pw-banner').classList.add('show');
}

document.getElementById('pw-copy').addEventListener('click', async (e) => {
  const val = document.getElementById('pw-value').textContent;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(val);
    } else {
      const ta = document.createElement('textarea');
      ta.value = val;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    e.target.textContent = 'Copied';
  } catch {
    showToast('Copy failed — please select and copy manually', 'error');
  }
});
document.getElementById('pw-dismiss').addEventListener('click', () => {
  document.getElementById('pw-banner').classList.remove('show');
});

function renderUsers(users) {
  const tbody = document.getElementById('users-body');
  tbody.textContent = '';
  for (const u of users) {
    const tr = document.createElement('tr');
    const isSelf = u.id === state.me.id;

    const tdName = document.createElement('td');
    tdName.textContent = u.username;

    const tdRole = document.createElement('td');
    if (u.role === 'admin') {
      tdRole.textContent = ROLE_LABELS.admin;
    } else {
      const sel = document.createElement('select');
      for (const key of ['council_member', 'admin_staff', 'non_admin_staff', 'read_only']) {
        const opt = document.createElement('option');
        opt.value = key; opt.textContent = ROLE_LABELS[key]; opt.selected = u.role === key;
        sel.appendChild(opt);
      }
      sel.addEventListener('change', async () => {
        try {
          await api(`/api/users/${u.id}`, { method: 'PATCH', body: JSON.stringify({ role: sel.value }) });
          showToast(`Updated role for "${u.username}"`, 'ok');
        } catch (err) {
          showToast(err.message, 'error');
          loadUsers();
        }
      });
      tdRole.appendChild(sel);
    }

    const tdStatus = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = `badge ${u.is_active ? 'active' : 'disabled'}`;
    badge.textContent = u.is_active ? 'Active' : 'Disabled';
    tdStatus.appendChild(badge);

    const tdLogin = document.createElement('td');
    tdLogin.className = 'muted';
    tdLogin.textContent = formatDate(u.last_login_at);

    const tdActions = document.createElement('td');
    const wrap = document.createElement('div');
    wrap.className = 'actions';

    const resetBtn = document.createElement('button');
    resetBtn.type = 'button'; resetBtn.className = 'btn sm'; resetBtn.textContent = 'Reset Password';
    resetBtn.addEventListener('click', async () => {
      if (!confirm(`Reset password for "${u.username}"?`)) return;
      resetBtn.disabled = true;
      try {
        const res = await api(`/api/users/${u.id}/reset-password`, { method: 'POST' });
        showPasswordBanner(res.username, res.generated_password);
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        resetBtn.disabled = false;
      }
    });
    wrap.appendChild(resetBtn);

    if (!isSelf) {
      const toggleBtn = document.createElement('button');
      toggleBtn.type = 'button'; toggleBtn.className = 'btn sm';
      toggleBtn.textContent = u.is_active ? 'Disable' : 'Enable';
      toggleBtn.addEventListener('click', async () => {
        toggleBtn.disabled = true;
        try {
          await api(`/api/users/${u.id}`, { method: 'PATCH', body: JSON.stringify({ is_active: !u.is_active }) });
          loadUsers();
        } catch (err) {
          showToast(err.message, 'error');
          toggleBtn.disabled = false;
        }
      });
      wrap.appendChild(toggleBtn);

      const delBtn = document.createElement('button');
      delBtn.type = 'button'; delBtn.className = 'btn sm danger'; delBtn.textContent = 'Remove';
      delBtn.addEventListener('click', async () => {
        if (!confirm(`Remove user "${u.username}"? This cannot be undone.`)) return;
        delBtn.disabled = true;
        try {
          await api(`/api/users/${u.id}`, { method: 'DELETE' });
          showToast(`Removed user "${u.username}"`, 'ok');
          loadUsers();
        } catch (err) {
          showToast(err.message, 'error');
          delBtn.disabled = false;
        }
      });
      wrap.appendChild(delBtn);
    }

    tdActions.appendChild(wrap);
    tr.append(tdName, tdRole, tdStatus, tdLogin, tdActions);
    tbody.appendChild(tr);
  }
}

export async function loadUsers() { renderUsers(await api('/api/users')); }

document.getElementById('create-user-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('form-error');
  errEl.textContent = '';
  const usernameEl = document.getElementById('new-username');
  const roleEl = document.getElementById('new-role');
  try {
    const created = await api('/api/users', {
      method: 'POST',
      body: JSON.stringify({ username: usernameEl.value.trim(), role: roleEl.value }),
    });
    usernameEl.value = '';
    showPasswordBanner(created.username, created.generated_password);
    await loadUsers();
  } catch (err) { errEl.textContent = err.message; }
});
