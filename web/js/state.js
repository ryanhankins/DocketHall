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

export const ROLE_LABELS = {
  admin: 'Admin',
  council_member: 'Council Member',
  staff_member: 'Staff Member',
  read_only: 'Read-Only',
};

export const state = {
  me: null,
  currentAgenda: null,
  agendasList: [],
  configuredBodies: [],
  configuredCategories: [
    { name: 'In-Progress Agendas', warn_on_leave: false },
    { name: 'Finalized Agendas', warn_on_leave: true },
  ],
  defaultMeetingTime: '',
};

export async function api(path, opts = {}) {
  const isForm = opts.body instanceof FormData;
  const headers = isForm ? (opts.headers || {}) : { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  const r = await fetch(path, { credentials: 'same-origin', headers, ...opts });
  if (r.status === 401) { location.replace('/'); throw new Error('Session expired'); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.detail || 'Request failed');
  return data;
}

export function showAgendaList() {
  document.getElementById('agendas-list-view').hidden = false;
  document.getElementById('agenda-detail-view').hidden = true;
}

export function showAgendaDetail() {
  document.getElementById('agendas-list-view').hidden = true;
  document.getElementById('agenda-detail-view').hidden = false;
}

export function showToast(message, type = 'info', action = null) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const span = document.createElement('span');
  span.textContent = message;
  el.appendChild(span);
  if (action && action.label && typeof action.onClick === 'function') {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = action.label;
    btn.addEventListener('click', () => {
      el.remove();
      action.onClick();
    });
    el.appendChild(btn);
  }
  container.appendChild(el);
  setTimeout(() => el.remove(), action ? 6500 : 4500);
}

export function formatDate(iso) { return iso ? new Date(iso).toLocaleString() : 'Never'; }
export function toTimeInputValue(str) {
  const s = (str || '').trim();
  if (/^\d{2}:\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return '';
  let h = parseInt(m[1], 10);
  const ap = m[3].toUpperCase();
  if (ap === 'PM' && h < 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}
export function formatTime12h(str) {
  const s = (str || '').trim();
  const m = s.match(/^(\d{2}):(\d{2})$/);
  if (!m) return s;
  const h24 = parseInt(m[1], 10);
  const h12 = h24 % 12 || 12;
  return `${h12}:${m[2]} ${h24 < 12 ? 'AM' : 'PM'}`;
}
export function formatSize(bytes) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export async function setAgendaStatus(agendaId, fromCategory, targetCategory, title) {
  if (targetCategory === undefined || targetCategory === null || targetCategory === fromCategory) return null;
  const fromCfg = state.configuredCategories.find(c => c.name === fromCategory);
  if (fromCfg && fromCfg.warn_on_leave) {
    const destLabel = targetCategory ? ` and moving it to "${targetCategory}"` : '';
    const ok = confirm(
      `Warning: "${title}" is in "${fromCategory}". Removing it from "${fromCategory}"${destLabel} may affect published/distributed materials. Continue?`
    );
    if (!ok) return null;
  }
  return api(`/api/agendas/${agendaId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: targetCategory }),
  });
}

export function categoryBadgeClass(catName) {
  const cfg = state.configuredCategories.find(c => c.name === catName);
  return (cfg?.warn_on_leave || String(catName || '').toLowerCase().startsWith('finalized'))
    ? 'badge active'
    : 'badge draft';
}

export function syncSectionsDatalist(sections) {
  const dl = document.getElementById('agenda-sections-datalist');
  if (!dl) return;
  dl.textContent = '';
  for (const s of (Array.isArray(sections) ? sections : [])) {
    const opt = document.createElement('option');
    opt.value = s;
    dl.appendChild(opt);
  }
}

export function makeInlineInput(el, currentVal, { required = false, multiline = false, listId = '', onSave }) {
  if (el.dataset.editing === '1') return;
  el.dataset.editing = '1';
  const origText = el.textContent;
  const origClass = el.className;
  const inp = document.createElement(multiline ? 'textarea' : 'input');
  inp.value = currentVal || '';
  if (!multiline && listId) inp.setAttribute('list', listId);
  if (multiline) inp.rows = 2;
  inp.style.cssText = 'font:inherit; width:100%; min-width:220px; padding:.25rem .45rem;';
  el.textContent = '';
  el.className = '';
  el.appendChild(inp);
  inp.focus();
  if (!multiline) inp.select();

  let done = false;
  const cancel = () => {
    if (done) return;
    done = true;
    delete el.dataset.editing;
    el.className = origClass;
    el.textContent = origText;
  };
  const commit = async () => {
    if (done) return;
    const next = inp.value.trim();
    if (required && !next) { cancel(); return; }
    if (next === (currentVal || '').trim()) { cancel(); return; }
    done = true;
    delete el.dataset.editing;
    try {
      await onSave(next);
    } catch (err) {
      showToast(err.message, 'error');
      el.className = origClass;
      el.textContent = origText;
    }
  };
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    if (!multiline && e.key === 'Enter') { e.preventDefault(); commit(); }
    if (multiline && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); }
  });
  inp.addEventListener('blur', commit);
}
