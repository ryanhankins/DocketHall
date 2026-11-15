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

import { ROLE_LABELS, state, api, showAgendaList, refreshBackupBanner, downloadBackupArchive, applyBrandTitle } from './state.js';
import { loadUsers } from './users.js';
import { loadAgendas } from './agendas-list.js';
import { openAgenda } from './agenda-detail.js';
import { loadPreferences } from './preferences.js';
import { loadBacklog, updateBacklogNavBadge } from './backlog.js';
import { loadCouncilAgendas } from './council.js';

document.getElementById('logout').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' });
  location.replace('/');
});

// --------------------------------------------------------- change password
const pwDialog = document.getElementById('pw-dialog');
const pwForm = document.getElementById('change-pw-form');
const pwMsg = document.getElementById('pw-msg');

document.getElementById('open-pw-modal').addEventListener('click', () => {
  pwForm.reset();
  pwMsg.className = 'error-msg';
  pwMsg.textContent = '';
  pwDialog.showModal();
});
document.getElementById('cancel-pw').addEventListener('click', () => pwDialog.close());

pwForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  pwMsg.className = 'error-msg';
  pwMsg.textContent = '';
  const cur = document.getElementById('cur-pw').value;
  const next = document.getElementById('new-pw').value;
  const confirmPw = document.getElementById('confirm-pw').value;
  if (next !== confirmPw) { pwMsg.textContent = 'New passwords do not match.'; return; }
  try {
    await api('/api/change-password', {
      method: 'POST',
      body: JSON.stringify({ current_password: cur, new_password: next }),
    });
    pwForm.reset();
    pwMsg.className = 'ok-msg';
    pwMsg.textContent = 'Password updated.';
  } catch (err) {
    pwMsg.textContent = err.message;
  }
});

// ------------------------------------------------------------- navigation
function setSubmenuOpen(submenuId, open) {
  const submenu = document.getElementById(submenuId);
  const toggle = document.querySelector(`.nav-parent[data-submenu="${submenuId}"]`);
  const arrow = toggle?.querySelector('.nav-arrow');
  if (!submenu || !toggle) return;
  submenu.hidden = !open;
  toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (arrow) arrow.innerHTML = open ? '&#9662;' : '&#9656;';
}

document.querySelectorAll('.nav-parent[data-submenu]').forEach(btn => {
  btn.addEventListener('click', () => {
    const submenu = document.getElementById(btn.dataset.submenu);
    if (submenu) setSubmenuOpen(btn.dataset.submenu, submenu.hidden);
  });
});

function showSection(name, pushHash = true) {
  document.querySelectorAll('#menu button[data-section]').forEach(b => {
    b.classList.toggle('active', b.dataset.section === name);
  });
  const isAgendaGroup = name === 'agendas' || name === 'backlog';
  const isPref = name === 'preferences-general' || name === 'preferences-agenda';
  if (isAgendaGroup) setSubmenuOpen('menu-agendas-submenu', true);
  if (isPref) setSubmenuOpen('menu-preferences-submenu', true);
  document.getElementById('section-users').hidden = name !== 'users';
  document.getElementById('section-agendas').hidden = name !== 'agendas';
  document.getElementById('section-backlog').hidden = name !== 'backlog';
  document.getElementById('section-preferences-general').hidden = name !== 'preferences-general';
  document.getElementById('section-preferences-agenda').hidden = name !== 'preferences-agenda';
  document.getElementById('section-council').hidden = name !== 'council';
  const targetHash = `#${name}`;
  if (pushHash && location.hash !== targetHash) history.pushState(null, '', targetHash);
  if (name === 'users') loadUsers();
  if (name === 'agendas') { showAgendaList(); loadAgendas(); }
  if (name === 'backlog') loadBacklog();
  if (isPref) loadPreferences();
  if (name === 'council') loadCouncilAgendas();
}

document.querySelectorAll('#menu button[data-section]').forEach(btn => {
  btn.addEventListener('click', () => showSection(btn.dataset.section));
});

async function routeFromHash(isAdmin, isStaff, isCouncil) {
  const hash = location.hash.replace(/^#/, '');
  const agMatch = hash.match(/^agendas\/(\d+)(\/(contents|minutes))?$/);
  if (agMatch && isStaff) {
    setSubmenuOpen('menu-agendas-submenu', true);
    document.querySelectorAll('#menu button[data-section]').forEach(b => {
      b.classList.toggle('active', b.dataset.section === 'agendas');
    });
    document.getElementById('section-users').hidden = true;
    document.getElementById('section-agendas').hidden = false;
    document.getElementById('section-backlog').hidden = true;
    document.getElementById('section-preferences-general').hidden = true;
    document.getElementById('section-preferences-agenda').hidden = true;
    document.getElementById('section-council').hidden = true;
    try {
      await openAgenda(Number(agMatch[1]), agMatch[3] || 'edit', false);
      return;
    } catch {
      showSection('agendas');
      return;
    }
  }
  if (hash === 'users' && isAdmin) { showSection('users', false); return; }
  if (hash === 'agendas' && isStaff) { showSection('agendas', false); return; }
  if (hash === 'backlog' && isStaff) { showSection('backlog', false); return; }
  if (hash === 'preferences-general' && isStaff) { showSection('preferences-general', false); return; }
  if ((hash === 'preferences-agenda' || hash === 'preferences') && isStaff) { showSection('preferences-agenda', false); return; }
  if (hash === 'council' && isCouncil) { showSection('council', false); return; }
  const fallback = isAdmin ? 'users' : (isStaff ? 'agendas' : 'council');
  if (location.hash !== `#${fallback}`) history.replaceState(null, '', `#${fallback}`);
  showSection(fallback, false);
}

(async () => {
  fetch('/api/agendas/preferences/branding')
    .then(r => r.ok ? r.json() : null)
    .then(b => { if (b) applyBrandTitle(b.city_title || ''); })
    .catch(() => {});
  state.me = await api('/api/me');
  document.getElementById('whoami').textContent =
    `${state.me.username} (${ROLE_LABELS[state.me.role] || state.me.role})`;

  const isAdmin = state.me.role === 'admin';
  const isStaff = state.me.role === 'admin_staff' || isAdmin;
  const isCouncil = state.me.role === 'council_member' || state.me.role === 'non_admin_staff';
  if (isAdmin || isStaff || isCouncil) {
    document.getElementById('menu').hidden = false;
    if (isAdmin) document.getElementById('menu-admin').hidden = false;
    if (isStaff) {
      document.getElementById('menu-staff').hidden = false;
      api('/api/agendas/backlog').then(updateBacklogNavBadge).catch(() => {});
      refreshBackupBanner();
      document.getElementById('backup-banner-download-btn')?.addEventListener('click', downloadBackupArchive);
    }
    if (isCouncil) {
      document.getElementById('menu-council').hidden = false;
      const label = ROLE_LABELS[state.me.role] || 'Council Member';
      const menuH = document.getElementById('menu-council-heading');
      const secH = document.getElementById('section-council-heading');
      if (menuH) menuH.textContent = label;
      if (secH) secH.textContent = label;
    }
    await routeFromHash(isAdmin, isStaff, isCouncil);
    window.addEventListener('popstate', () => routeFromHash(isAdmin, isStaff, isCouncil));
  } else {
    document.getElementById('section-nonstaff').hidden = false;
  }
})();
