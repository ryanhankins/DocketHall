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

import { state, api, toTimeInputValue, syncSectionsDatalist, showToast, refreshBackupBanner, downloadBackupArchive, wireRestoreForm, applyBrandTitle } from './state.js';

let prefBodies = [];
let prefSections = [];
let prefCategories = [];

function renderChipList(elId, items, minLen, onRemove) {
  const list = document.getElementById(elId);
  list.textContent = '';
  for (const item of items) {
    const chip = document.createElement('span');
    chip.className = 'actions';
    chip.style.cssText = 'padding:.25rem .55rem; background:#f1f5f9; border:1px solid #cbd2d9; border-radius:999px; font-size:.86rem;';
    const txt = document.createElement('span');
    txt.textContent = item;
    chip.appendChild(txt);
    if (items.length > minLen) {
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.textContent = '×';
      rm.title = `Remove ${item}`;
      rm.style.cssText = 'border:0; background:none; cursor:pointer; font-size:1rem; line-height:1; color:#64748b; padding:0 .15rem;';
      rm.addEventListener('click', () => onRemove(item));
      chip.appendChild(rm);
    }
    list.appendChild(chip);
  }
}

function renderPrefBodies() {
  renderChipList('pref-bodies-list', prefBodies, 1, (b) => {
    prefBodies = prefBodies.filter(x => x !== b);
    renderPrefBodies();
  });
}

function renderPrefSections() {
  renderChipList('pref-sections-list', prefSections, 0, (s) => {
    prefSections = prefSections.filter(x => x !== s);
    renderPrefSections();
  });
}

function renderPrefCategories() {
  const list = document.getElementById('pref-categories-list');
  list.textContent = '';
  for (const cat of prefCategories) {
    const row = document.createElement('div');
    row.className = 'between';
    row.style.cssText = 'padding:.35rem .65rem; background:#f1f5f9; border:1px solid #cbd2d9; border-radius:6px; font-size:.88rem;';
    const left = document.createElement('span');
    left.textContent = cat.name;
    const right = document.createElement('div');
    right.className = 'actions';
    const warnLbl = document.createElement('label');
    warnLbl.style.cssText = 'display:inline-flex; align-items:center; gap:.35rem; font-size:.84rem; cursor:pointer; font-weight:400;';
    const warnCb = document.createElement('input');
    warnCb.type = 'checkbox';
    warnCb.style.width = 'auto';
    warnCb.checked = !!cat.warn_on_leave;
    warnCb.addEventListener('change', () => { cat.warn_on_leave = warnCb.checked; });
    const warnTxt = document.createElement('span');
    warnTxt.textContent = 'Warn when removing';
    warnLbl.append(warnCb, warnTxt);
    right.appendChild(warnLbl);
    if (prefCategories.length > 1) {
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.textContent = '×';
      rm.title = `Remove ${cat.name}`;
      rm.style.cssText = 'border:0; background:none; cursor:pointer; font-size:1rem; line-height:1; color:#64748b; padding:0 .15rem;';
      rm.addEventListener('click', () => {
        prefCategories = prefCategories.filter(x => x.name !== cat.name);
        renderPrefCategories();
      });
      right.appendChild(rm);
    }
    row.append(left, right);
    list.appendChild(row);
  }
}

document.getElementById('pref-add-body').addEventListener('click', () => {
  const inp = document.getElementById('pref-new-body');
  const val = inp.value.trim();
  if (!val || prefBodies.includes(val)) return;
  prefBodies.push(val);
  inp.value = '';
  renderPrefBodies();
});

document.getElementById('pref-add-section').addEventListener('click', () => {
  const inp = document.getElementById('pref-new-section');
  const val = inp.value.trim();
  if (!val || prefSections.includes(val)) return;
  prefSections.push(val);
  inp.value = '';
  renderPrefSections();
});

document.getElementById('pref-add-category').addEventListener('click', () => {
  const inp = document.getElementById('pref-new-category');
  const warnEl = document.getElementById('pref-new-category-warn');
  const val = inp.value.trim();
  if (!val || prefCategories.some(c => c.name === val)) return;
  prefCategories.push({ name: val, warn_on_leave: !!warnEl.checked });
  inp.value = '';
  warnEl.checked = false;
  renderPrefCategories();
});

function renderPrefLogo(hasLogo) {
  const img = document.getElementById('pref-logo-preview');
  const rm = document.getElementById('pref-logo-remove');
  const brandLogo = document.getElementById('brand-logo');
  const favicon = document.getElementById('app-favicon');
  img.hidden = !hasLogo;
  rm.hidden = !hasLogo;
  if (hasLogo) {
    const url = `/api/agendas/preferences/logo?t=${Date.now()}`;
    img.src = url;
    if (brandLogo) { brandLogo.src = url; brandLogo.hidden = false; }
    if (favicon) { favicon.href = url; }
  } else {
    img.removeAttribute('src');
    if (brandLogo) { brandLogo.hidden = true; brandLogo.removeAttribute('src'); }
    if (favicon) { favicon.removeAttribute('href'); }
  }
}

async function uploadLogoFile(file) {
  if (!file) return;
  const msg = document.getElementById('general-prefs-msg');
  msg.className = 'ok-msg';
  msg.textContent = 'Uploading logo...';
  try {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/agendas/preferences/logo', {
      method: 'POST',
      body: fd,
      credentials: 'same-origin',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
    renderPrefLogo(!!data.has_city_logo);
    msg.textContent = 'City logo uploaded.';
  } catch (err) {
    msg.className = 'error-msg';
    msg.textContent = err.message;
  }
}

document.getElementById('pref-logo-file').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  await uploadLogoFile(file);
  e.target.value = '';
});

const logoDrop = document.getElementById('pref-logo-drop');
logoDrop.addEventListener('dragover', (e) => {
  e.preventDefault();
  logoDrop.classList.add('drag-over');
});
logoDrop.addEventListener('dragleave', () => logoDrop.classList.remove('drag-over'));
logoDrop.addEventListener('drop', async (e) => {
  e.preventDefault();
  logoDrop.classList.remove('drag-over');
  const files = e.dataTransfer && e.dataTransfer.files;
  if (files && files.length) await uploadLogoFile(files[0]);
});

document.getElementById('pref-logo-remove').addEventListener('click', async () => {
  const msg = document.getElementById('general-prefs-msg');
  msg.className = 'ok-msg';
  msg.textContent = '';
  try {
    const saved = await api('/api/agendas/preferences/logo', { method: 'DELETE' });
    renderPrefLogo(!!saved.has_city_logo);
    msg.textContent = 'City logo removed.';
  } catch (err) {
    msg.className = 'error-msg';
    msg.textContent = err.message;
  }
});

async function loadPrefTemplates() {
  const box = document.getElementById('pref-templates-list');
  const list = await api('/api/agendas/templates');
  box.textContent = '';
  if (!list.length) {
    box.textContent = 'No saved meeting templates.';
    return;
  }
  for (const t of list) {
    const row = document.createElement('div');
    row.className = 'between';
    row.style.cssText = 'padding:.4rem 0; border-bottom:1px solid #e2e8f0;';
    const info = document.createElement('span');
    info.textContent = `${t.name} — ${(t.items || []).length} items`;
    const del = document.createElement('button');
    del.type = 'button'; del.className = 'btn sm danger'; del.textContent = 'Delete';
    del.addEventListener('click', async () => {
      await api(`/api/agendas/templates/${t.id}`, { method: 'DELETE' });
      loadPrefTemplates();
    });
    row.append(info, del);
    box.appendChild(row);
  }
}

export async function loadPreferences() {
  document.getElementById('prefs-msg').textContent = '';
  const prefs = await api('/api/agendas/preferences');
  document.getElementById('pref-cover-sheets').checked = !!prefs.include_item_cover_sheets;
  document.getElementById('pref-page-numbers').checked = !!prefs.include_page_numbers;
  document.getElementById('pref-city-title').value = prefs.city_title || '';
  applyBrandTitle(prefs.city_title || '');
  document.getElementById('pref-city-name').value = prefs.city_name || '';
  document.getElementById('pref-meeting-location').value = prefs.meeting_location || '';
  document.getElementById('pref-meeting-time').value = toTimeInputValue(prefs.meeting_time);
  document.getElementById('pref-other-notes').value = prefs.other_notes || '';
  document.getElementById('pref-footer-disclosures').value = prefs.footer_disclosures || '';
  prefBodies = Array.isArray(prefs.bodies) ? [...prefs.bodies] : [];
  prefSections = Array.isArray(prefs.sections) ? [...prefs.sections] : [];
  prefCategories = Array.isArray(prefs.categories) && prefs.categories.length
    ? prefs.categories.map(c => ({ name: c.name, warn_on_leave: !!c.warn_on_leave }))
    : [
        { name: 'In-Progress Agendas', warn_on_leave: false },
        { name: 'Finalized Agendas', warn_on_leave: true },
      ];
  renderPrefBodies();
  renderPrefSections();
  renderPrefCategories();
  syncSectionsDatalist(prefSections);
  renderPrefLogo(!!prefs.has_city_logo);
  refreshBackupBanner();
  loadPrefTemplates();
}

document.getElementById('general-prefs-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('general-prefs-msg');
  msg.className = 'ok-msg';
  msg.textContent = '';
  try {
    const saved = await api('/api/agendas/preferences/general', {
      method: 'PUT',
      body: JSON.stringify({
        city_title: document.getElementById('pref-city-title').value.trim(),
      }),
    });
    applyBrandTitle(saved.city_title || '');
    msg.textContent = 'General preferences saved.';
  } catch (err) {
    msg.className = 'error-msg';
    msg.textContent = err.message;
  }
});

document.getElementById('prefs-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('prefs-msg');
  msg.className = 'ok-msg';
  msg.textContent = '';
  try {
    const saved = await api('/api/agendas/preferences', {
      method: 'PUT',
      body: JSON.stringify({
        include_item_cover_sheets: document.getElementById('pref-cover-sheets').checked,
        include_page_numbers: document.getElementById('pref-page-numbers').checked,
        city_name: document.getElementById('pref-city-name').value.trim(),
        meeting_location: document.getElementById('pref-meeting-location').value.trim(),
        meeting_time: document.getElementById('pref-meeting-time').value.trim(),
        other_notes: document.getElementById('pref-other-notes').value.trim(),
        footer_disclosures: document.getElementById('pref-footer-disclosures').value.trim(),
        bodies: prefBodies,
        sections: prefSections,
        categories: prefCategories,
      }),
    });
    prefBodies = [...saved.bodies];
    prefSections = [...(saved.sections || [])];
    prefCategories = Array.isArray(saved.categories)
      ? saved.categories.map(c => ({ name: c.name, warn_on_leave: !!c.warn_on_leave }))
      : prefCategories;
    state.configuredCategories = prefCategories.map(c => ({ ...c }));
    renderPrefBodies();
    renderPrefSections();
    renderPrefCategories();
    syncSectionsDatalist(prefSections);
    msg.textContent = 'Preferences saved.';
  } catch (err) {
    msg.className = 'error-msg';
    msg.textContent = err.message;
  }
});

document.getElementById('staff-export-btn')?.addEventListener('click', downloadBackupArchive);
wireRestoreForm('staff-restore-form', 'staff-import-file', 'staff-backup-msg', loadPreferences);

document.getElementById('staff-backup-reminder-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const days = Number(document.getElementById('staff-backup-days').value || 0);
  try {
    await api('/api/backup/settings', {
      method: 'PUT',
      body: JSON.stringify({ reminder_days: days }),
    });
    await refreshBackupBanner();
    showToast(days > 0 ? `Backup reminder set to every ${days} day(s)` : 'Backup reminder disabled', 'ok');
  } catch (err) {
    showToast(err.message, 'error');
  }
});
