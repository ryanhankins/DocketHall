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
  admin_staff: 'Administrative Staff',
  non_admin_staff: 'Non-Administrative Staff',
  read_only: 'Read-Only',
};

export async function api(path, opts = {}) {
  const isForm = opts.body instanceof FormData;
  const headers = isForm
    ? (opts.headers || {})
    : { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  const r = await fetch(path, { credentials: 'same-origin', headers, ...opts });
  if (r.status === 401) {
    location.replace('/');
    throw new Error('Session expired');
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.detail || 'Request failed');
  return data;
}

export function hasPermission(user, perm) {
  if (!user) return false;
  const perms = user.permissions || [];
  return perms.includes('*') || perms.includes(perm);
}

export function formatDate(iso) {
  return iso ? new Date(iso).toLocaleString() : 'Never';
}

export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

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
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function categoryBadgeClass(catName, configuredCategories = []) {
  const cfg = configuredCategories.find(c => c.name === catName);
  return (cfg?.warn_on_leave || String(catName || '').toLowerCase().startsWith('finalized'))
    ? 'badge active'
    : 'badge draft';
}

export async function downloadBackupArchive(onAfter, showToast) {
  const res = await fetch('/api/backup/export', { credentials: 'same-origin' });
  if (res.status === 401) {
    location.replace('/');
    return;
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Backup export failed (${res.status})`);
  }
  const cd = res.headers.get('Content-Disposition') || '';
  const m = cd.match(/filename="?([^"]+)"?/i);
  const filename = m ? m[1] : 'civicdesk_backup.zip';
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  if (onAfter) await onAfter();
  if (showToast) showToast('Backup archive downloaded', 'ok');
}
