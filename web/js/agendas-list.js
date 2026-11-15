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

import { state, api, showAgendaDetail, toTimeInputValue, categoryBadgeClass, syncSectionsDatalist, setAgendaStatus, showToast } from './state.js';
import { openAgenda, renderAgendaDetail, setAgendaTab } from './agenda-detail.js';
import { todayIso, updateBacklogNavBadge } from './backlog.js';

document.addEventListener('click', (e) => {
  document.querySelectorAll('.multi-filter[open]').forEach((det) => {
    if (!det.contains(e.target)) det.open = false;
  });
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.multi-filter[open]').forEach((det) => { det.open = false; });
  }
});


function renderAgendaTable(agendas, tbody, emptyMsg, categoryName) {
  tbody.textContent = '';
  if (!agendas.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 6; td.className = 'muted';
    td.textContent = emptyMsg;
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }
  for (const a of agendas) {
    const tr = document.createElement('tr');

    const tdTitle = document.createElement('td');
    const titleBtn = document.createElement('button');
    titleBtn.type = 'button';
    titleBtn.className = 'link-btn';
    titleBtn.textContent = a.title;
    titleBtn.addEventListener('click', () => openAgenda(a.id));
    tdTitle.appendChild(titleBtn);

    const tdBody = document.createElement('td');
    tdBody.className = 'muted';
    tdBody.textContent = a.body || '—';

    const tdDate = document.createElement('td');
    tdDate.className = 'muted';
    tdDate.textContent = a.meeting_date || '—';

    const tdStatus = document.createElement('td');
    const catLabel = a.status || categoryName || '';
    if (catLabel) {
      const badge = document.createElement('span');
      badge.className = categoryBadgeClass(catLabel);
      badge.textContent = catLabel;
      tdStatus.appendChild(badge);
    } else {
      tdStatus.className = 'muted';
      tdStatus.textContent = '—';
    }

    const tdCounts = document.createElement('td');
    tdCounts.className = 'muted';
    tdCounts.textContent = `${a.item_count} items, ${a.doc_count} docs`;

    const tdActions = document.createElement('td');
    const wrap = document.createElement('div');
    wrap.className = 'actions';

    const openBtn = document.createElement('button');
    openBtn.type = 'button'; openBtn.className = 'btn sm primary'; openBtn.textContent = 'Open';
    openBtn.addEventListener('click', () => openAgenda(a.id));

    const pdfLink = document.createElement('a');
    pdfLink.className = 'btn sm';
    pdfLink.textContent = 'Agenda PDF';
    pdfLink.href = `/api/agendas/${a.id}/packet.pdf`;
    pdfLink.target = '_blank';
    pdfLink.rel = 'noopener';

    const sumLink = document.createElement('a');
    sumLink.className = 'btn sm';
    sumLink.textContent = 'Agenda-Only PDF';
    sumLink.href = `/api/agendas/${a.id}/packet.pdf?summary=1`;
    sumLink.target = '_blank';
    sumLink.rel = 'noopener';

    const cloneBtn = document.createElement('button');
    cloneBtn.type = 'button'; cloneBtn.className = 'btn sm';
    cloneBtn.textContent = 'Clone';
    cloneBtn.addEventListener('click', async () => {
      cloneBtn.disabled = true;
      try {
        const cloned = await api(`/api/agendas/${a.id}/clone`, { method: 'POST' });
        openAgenda(cloned.id);
      } catch (err) {
        showToast(err.message, 'error');
        cloneBtn.disabled = false;
      }
    });

    const moveSel = document.createElement('select');
    moveSel.className = 'btn sm';
    moveSel.style.width = 'auto';
    moveSel.setAttribute('aria-label', `Category for ${a.title}`);
    const noneOpt = document.createElement('option');
    noneOpt.value = '';
    noneOpt.textContent = '(No Category)';
    noneOpt.selected = !a.status;
    moveSel.appendChild(noneOpt);
    const catNames = state.configuredCategories.map(c => c.name);
    if (a.status && !catNames.includes(a.status)) catNames.unshift(a.status);
    for (const cname of catNames) {
      const opt = document.createElement('option');
      opt.value = cname;
      opt.textContent = cname;
      opt.selected = cname === a.status;
      moveSel.appendChild(opt);
    }
    moveSel.addEventListener('change', async () => {
      try {
        const updated = await setAgendaStatus(a.id, a.status, moveSel.value, a.title);
        if (updated) loadAgendas();
        else moveSel.value = a.status;
      } catch (err) {
        showToast(err.message, 'error');
        moveSel.value = a.status;
      }
    });

    const delBtn = document.createElement('button');
    delBtn.type = 'button'; delBtn.className = 'btn sm danger'; delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', async () => {
      if (!confirm(`Delete agenda "${a.title}"?`)) return;
      delBtn.disabled = true;
      try {
        await api(`/api/agendas/${a.id}`, { method: 'DELETE' });
        showToast(`Deleted "${a.title}"`, 'ok');
        loadAgendas();
      } catch (err) {
        showToast(err.message, 'error');
        delBtn.disabled = false;
      }
    });

    wrap.append(openBtn, pdfLink, sumLink, cloneBtn, moveSel, delBtn);
    tdActions.appendChild(wrap);
    tr.append(tdTitle, tdBody, tdDate, tdStatus, tdCounts, tdActions);
    tbody.appendChild(tr);
  }
}

let agendaTemplates = [];
let lastLoadedAgendas = [];

function getMultiFilterValues(id) {
  const el = document.getElementById(id);
  if (!el) return [];
  return [...el.querySelectorAll('input[type="checkbox"]:checked')].map(cb => cb.value);
}

function updateMultiFilterSummary(id, allLabel, pluralNoun) {
  const el = document.getElementById(id);
  if (!el) return;
  const checked = [...el.querySelectorAll('input[type="checkbox"]:checked')];
  const sum = el.querySelector('summary');
  if (checked.length === 0) sum.textContent = allLabel;
  else if (checked.length === 1) sum.textContent = checked[0].dataset.label || checked[0].value;
  else sum.textContent = `${checked.length} ${pluralNoun}`;
}

function populateMultiFilter(id, items, allLabel, pluralNoun, initialValues = null) {
  const el = document.getElementById(id);
  const prev = initialValues ? new Set(initialValues) : new Set(getMultiFilterValues(id));
  const menu = el.querySelector('.multi-filter-menu');
  menu.textContent = '';
  for (const item of items) {
    const val = typeof item === 'string' ? item : item.value;
    const lbl = typeof item === 'string' ? item : item.label;
    const labelEl = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = val;
    cb.dataset.label = lbl;
    cb.checked = prev.has(val);
    cb.addEventListener('change', () => {
      updateMultiFilterSummary(id, allLabel, pluralNoun);
      saveAgendaFilters();
      renderAgendaCategories();
    });
    const span = document.createElement('span');
    span.textContent = lbl;
    labelEl.append(cb, span);
    menu.appendChild(labelEl);
  }
  updateMultiFilterSummary(id, allLabel, pluralNoun);
}

let agendaFiltersRestored = false;
function agendaFiltersKey() {
  return `civicdesk_agenda_filters_${state.me?.id || state.me?.username || 'anon'}`;
}

function saveAgendaFilters() {
  try {
    localStorage.setItem(agendaFiltersKey(), JSON.stringify({
      search: document.getElementById('filter-agenda-search')?.value || '',
      bodies: getMultiFilterValues('filter-agenda-body'),
      categories: getMultiFilterValues('filter-agenda-category'),
      dateFrom: document.getElementById('filter-agenda-date-from')?.value || '',
      dateTo: document.getElementById('filter-agenda-date-to')?.value || '',
    }));
  } catch {}
}

function loadSavedAgendaFilters() {
  try {
    const raw = localStorage.getItem(agendaFiltersKey());
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

document.addEventListener('click', (e) => {
  for (const id of ['filter-agenda-body', 'filter-agenda-category']) {
    const det = document.getElementById(id);
    if (det && det.open && !det.contains(e.target)) det.open = false;
  }
});

function renderAgendaCategories() {
  const searchQ = (document.getElementById('filter-agenda-search')?.value || '').trim().toLowerCase();
  const bodyVals = new Set(getMultiFilterValues('filter-agenda-body'));
  const catVals = new Set(getMultiFilterValues('filter-agenda-category'));
  const dateFrom = document.getElementById('filter-agenda-date-from')?.value || '';
  const dateTo = document.getElementById('filter-agenda-date-to')?.value || '';
  const hasFilters = !!(searchQ || bodyVals.size || catVals.size || dateFrom || dateTo);

  const configuredNames = new Set(state.configuredCategories.map(c => c.name));
  const filtered = lastLoadedAgendas.filter((a) => {
    if (searchQ && !(a.title || '').toLowerCase().includes(searchQ)) return false;
    if (bodyVals.size && !bodyVals.has(a.body || '')) return false;
    if (dateFrom && (!a.meeting_date || a.meeting_date < dateFrom)) return false;
    if (dateTo && (!a.meeting_date || a.meeting_date > dateTo)) return false;
    if (catVals.size) {
      const isOther = !configuredNames.has(a.status);
      const matchCat = catVals.has(a.status) || (isOther && catVals.has('__other__'));
      if (!matchCat) return false;
    }
    return true;
  });

  const catContainer = document.getElementById('agenda-categories-container');
  catContainer.textContent = '';
  const card = document.createElement('div');
  card.className = 'card';
  const h2 = document.createElement('h2');
  if (catVals.size === 1) {
    const only = [...catVals][0];
    h2.textContent = only === '__other__' ? 'Other Agendas' : only;
  } else {
    h2.textContent = 'Agendas';
  }
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const col of ['Title', 'Body', 'Meeting Date', 'Category', 'Items / Docs', 'Actions']) {
    const th = document.createElement('th');
    th.textContent = col;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  const tbody = document.createElement('tbody');
  tbody.id = 'agendas-body';
  table.append(thead, tbody);
  card.append(h2, table);
  catContainer.appendChild(card);

  const emptyMsg = hasFilters
    ? 'No agendas match the current filters.'
    : 'No agendas yet. Create one above.';
  renderAgendaTable(filtered, tbody, emptyMsg, '');
}

for (const fid of [
  'filter-agenda-search', 'filter-agenda-date-from', 'filter-agenda-date-to',
]) {
  const el = document.getElementById(fid);
  el.addEventListener(el.tagName === 'INPUT' && el.type === 'search' ? 'input' : 'change', () => {
    saveAgendaFilters();
    renderAgendaCategories();
  });
}
document.getElementById('filter-agenda-clear').addEventListener('click', () => {
  document.getElementById('filter-agenda-search').value = '';
  document.getElementById('filter-agenda-date-from').value = '';
  document.getElementById('filter-agenda-date-to').value = '';
  for (const cb of document.querySelectorAll('#filter-agenda-body input[type="checkbox"], #filter-agenda-category input[type="checkbox"]')) {
    cb.checked = false;
  }
  updateMultiFilterSummary('filter-agenda-body', 'All Bodies', 'Bodies');
  updateMultiFilterSummary('filter-agenda-category', 'All Categories', 'Categories');
  saveAgendaFilters();
  renderAgendaCategories();
});

document.getElementById('agendas-open-backlog-btn')?.addEventListener('click', () => {
  document.querySelector('#menu button[data-section="backlog"]')?.click();
});

export async function loadAgendas() {
  const [agendas, prefs, templates, backlog] = await Promise.all([
    api('/api/agendas'),
    api('/api/agendas/preferences'),
    api('/api/agendas/templates'),
    api('/api/agendas/backlog'),
  ]);
  const backlogList = Array.isArray(backlog) ? backlog : [];
  updateBacklogNavBadge(backlogList);
  const today = todayIso();
  const dueItems = backlogList.filter(it => it.target_date && it.target_date <= today);
  const alertEl = document.getElementById('agendas-backlog-alert');
  const alertText = document.getElementById('agendas-backlog-alert-text');
  if (alertEl && alertText) {
    if (dueItems.length) {
      alertText.textContent = `${dueItems.length} backlog item(s) have reached their target date and are ready to assign.`;
      alertEl.classList.add('show');
    } else {
      alertEl.classList.remove('show');
    }
  }
  agendaTemplates = Array.isArray(templates) ? templates : [];
  const tplSel = document.getElementById('agenda-template');
  const prevTpl = tplSel.value;
  tplSel.textContent = '';
  const blankOpt = document.createElement('option');
  blankOpt.value = ''; blankOpt.textContent = '(Blank Agenda)';
  tplSel.appendChild(blankOpt);
  for (const t of agendaTemplates) {
    const opt = document.createElement('option');
    opt.value = String(t.id);
    opt.textContent = `${t.name} (${(t.items || []).length} items)`;
    tplSel.appendChild(opt);
  }
  if (prevTpl && [...tplSel.options].some(o => o.value === prevTpl)) {
    tplSel.value = prevTpl;
  }

  state.configuredBodies = Array.isArray(prefs.bodies) ? [...prefs.bodies] : [];
  state.configuredCategories = Array.isArray(prefs.categories) && prefs.categories.length
    ? prefs.categories.map(c => ({ name: c.name, warn_on_leave: !!c.warn_on_leave }))
    : [
        { name: 'In-Progress Agendas', warn_on_leave: false },
        { name: 'Finalized Agendas', warn_on_leave: true },
      ];
  syncSectionsDatalist(prefs.sections);
  state.defaultMeetingTime = prefs.meeting_time || '';
  const timeEl = document.getElementById('agenda-time');
  if (!timeEl.value && state.defaultMeetingTime) {
    timeEl.value = toTimeInputValue(state.defaultMeetingTime);
  }
  const bodySel = document.getElementById('agenda-body');
  const prevBody = bodySel.value;
  bodySel.textContent = '';
  for (const b of state.configuredBodies) {
    const opt = document.createElement('option');
    opt.value = b;
    opt.textContent = b;
    bodySel.appendChild(opt);
  }
  if (prevBody && [...bodySel.options].some(o => o.value === prevBody)) {
    bodySel.value = prevBody;
  }

  lastLoadedAgendas = Array.isArray(agendas) ? agendas : [];
  state.agendasList = lastLoadedAgendas;

  let initBodies = null;
  let initCats = null;
  if (!agendaFiltersRestored) {
    agendaFiltersRestored = true;
    const saved = loadSavedAgendaFilters();
    if (saved && typeof saved === 'object') {
      if (typeof saved.search === 'string') document.getElementById('filter-agenda-search').value = saved.search;
      if (typeof saved.dateFrom === 'string') document.getElementById('filter-agenda-date-from').value = saved.dateFrom;
      if (typeof saved.dateTo === 'string') document.getElementById('filter-agenda-date-to').value = saved.dateTo;
      if (Array.isArray(saved.bodies)) initBodies = saved.bodies;
      if (Array.isArray(saved.categories)) initCats = saved.categories;
    }
  }

  const bodyOpts = [...new Set([...state.configuredBodies, ...lastLoadedAgendas.map(a => a.body).filter(Boolean)])];
  populateMultiFilter('filter-agenda-body', bodyOpts, 'All Bodies', 'Bodies', initBodies);

  const catOpts = state.configuredCategories.map(c => ({ value: c.name, label: c.name }));
  const cfgNames = new Set(state.configuredCategories.map(c => c.name));
  if (lastLoadedAgendas.some(a => !cfgNames.has(a.status))) {
    catOpts.push({ value: '__other__', label: 'Other Agendas' });
  }
  populateMultiFilter('filter-agenda-category', catOpts, 'All Categories', 'Categories', initCats);

  renderAgendaCategories();
  await loadPendingCouncilSubmissions();
}

async function loadPendingCouncilSubmissions() {
  const card = document.getElementById('council-submissions-card');
  const badge = document.getElementById('council-submissions-badge');
  const tbody = document.getElementById('staff-council-submissions-tbody');
  if (!card || !tbody) return;
  let subs = [];
  try {
    subs = await api('/api/agendas/council/submissions');
  } catch {
    card.hidden = true;
    return;
  }
  if (!subs.length) {
    card.hidden = true;
    tbody.textContent = '';
    return;
  }
  card.hidden = false;
  badge.textContent = `${subs.length} pending`;
  tbody.textContent = '';

  const agendas = state.agendasList || [];
  const councilAgendas = agendas.filter(a => (a.body || '').toLowerCase().includes('council'));
  const targetOptions = councilAgendas.length ? councilAgendas : agendas;

  for (const s of subs) {
    const tr = document.createElement('tr');

    const tdItem = document.createElement('td');
    const titleEl = document.createElement('div');
    titleEl.style.fontWeight = '600';
    titleEl.textContent = s.title;
    tdItem.appendChild(titleEl);
    const meta = [s.section, s.description, s.recommended_motion && `Motion: ${s.recommended_motion}`, s.fiscal_impact && `Fiscal: ${s.fiscal_impact}`].filter(Boolean);
    if (meta.length) {
      const subEl = document.createElement('div');
      subEl.className = 'muted';
      subEl.style.fontSize = '.82rem';
      subEl.textContent = meta.join(' · ');
      tdItem.appendChild(subEl);
    }
    const subDocs = Array.isArray(s.documents) ? s.documents : [];
    if (subDocs.length) {
      const docsEl = document.createElement('div');
      docsEl.className = 'muted';
      docsEl.style.fontSize = '.82rem';
      docsEl.textContent = `Attachments: ${subDocs.map(d => `${d.filename}${d.approval_status === 'pending' ? ' (pending approval)' : ''}`).join(', ')}`;
      tdItem.appendChild(docsEl);
    }

    const tdUser = document.createElement('td');
    tdUser.className = 'muted';
    tdUser.textContent = s.submitted_username || '—';

    const tdTarget = document.createElement('td');
    tdTarget.className = 'muted';
    if (s.target_agenda_title) {
      tdTarget.textContent = s.target_agenda_date
        ? `${s.target_agenda_title} (${s.target_agenda_date})`
        : s.target_agenda_title;
    } else {
      const tParts = [s.target_date, s.target_note].filter(Boolean);
      tdTarget.textContent = tParts.length ? `Some future agenda · ${tParts.join(' · ')}` : 'Some future agenda';
    }

    const tdAssign = document.createElement('td');
    const tdActions = document.createElement('td');
    const actWrap = document.createElement('div');
    actWrap.className = 'actions';

    if (s.status === 'accepted') {
      tdAssign.className = 'muted';
      tdAssign.textContent = s.accepted_agenda_title
        ? `On ${s.accepted_agenda_title}${s.accepted_agenda_date ? ` (${s.accepted_agenda_date})` : ''}`
        : 'Already on agenda';
      const pendingDocs = subDocs.filter(d => d.approval_status === 'pending');
      for (const d of pendingDocs) {
        const appBtn = document.createElement('button');
        appBtn.type = 'button';
        appBtn.className = 'btn sm primary';
        appBtn.textContent = `Approve ${d.filename}`;
        appBtn.addEventListener('click', async () => {
          appBtn.disabled = true;
          try {
            await api(`/api/agendas/council/submissions/${s.id}/documents/${d.id}/approve`, { method: 'POST' });
            showToast(`Approved "${d.filename}"`, 'ok');
            await loadAgendas();
          } catch (err) {
            showToast(err.message, 'error');
            appBtn.disabled = false;
          }
        });
        const decBtn = document.createElement('button');
        decBtn.type = 'button';
        decBtn.className = 'btn sm danger';
        decBtn.textContent = `Decline ${d.filename}`;
        decBtn.addEventListener('click', async () => {
          decBtn.disabled = true;
          try {
            await api(`/api/agendas/council/submissions/${s.id}/documents/${d.id}/decline`, { method: 'POST' });
            showToast(`Declined "${d.filename}"`, 'ok');
            await loadPendingCouncilSubmissions();
          } catch (err) {
            showToast(err.message, 'error');
            decBtn.disabled = false;
          }
        });
        actWrap.append(appBtn, decBtn);
      }
      tdActions.appendChild(actWrap);
      tr.append(tdItem, tdUser, tdTarget, tdAssign, tdActions);
      tbody.appendChild(tr);
      continue;
    }

    const sel = document.createElement('select');
    sel.style.width = '100%';
    sel.style.minWidth = '200px';
    let matchedId = s.target_agenda_id ? String(s.target_agenda_id) : null;
    for (const a of targetOptions) {
      const opt = document.createElement('option');
      opt.value = String(a.id);
      opt.textContent = `${a.title}${a.meeting_date ? ` (${a.meeting_date})` : ''}`;
      if (!matchedId && s.target_date && a.meeting_date === s.target_date) {
        matchedId = String(a.id);
      }
      sel.appendChild(opt);
    }
    const newOpt = document.createElement('option');
    newOpt.value = '__new__';
    newOpt.textContent = '+ Create new council agenda…';
    sel.appendChild(newOpt);
    if (matchedId) sel.value = matchedId;
    else if (!targetOptions.length) sel.value = '__new__';

    const newWrap = document.createElement('div');
    newWrap.style.marginTop = '.4rem';
    newWrap.style.display = sel.value === '__new__' ? 'flex' : 'none';
    newWrap.style.gap = '.35rem';
    const newTitle = document.createElement('input');
    newTitle.placeholder = 'New agenda title';
    newTitle.value = 'Regular Meeting';
    newTitle.style.flex = '1';
    const newDate = document.createElement('input');
    newDate.type = 'date';
    newDate.value = s.target_date || '';
    newWrap.append(newTitle, newDate);

    sel.addEventListener('change', () => {
      newWrap.style.display = sel.value === '__new__' ? 'flex' : 'none';
    });
    tdAssign.append(sel, newWrap);

    const acceptBtn = document.createElement('button');
    acceptBtn.type = 'button';
    acceptBtn.className = 'btn sm primary';
    acceptBtn.textContent = 'Accept & Add';
    acceptBtn.addEventListener('click', async () => {
      acceptBtn.disabled = true;
      try {
        const payload = sel.value === '__new__'
          ? { new_agenda_title: newTitle.value.trim(), new_agenda_date: newDate.value || null }
          : { agenda_id: Number(sel.value) };
        await api(`/api/agendas/council/submissions/${s.id}/accept`, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        showToast(`Added "${s.title}" to agenda`, 'ok');
        await loadAgendas();
      } catch (err) {
        showToast(err.message, 'error');
        acceptBtn.disabled = false;
      }
    });

    const declineBtn = document.createElement('button');
    declineBtn.type = 'button';
    declineBtn.className = 'btn sm danger';
    declineBtn.textContent = 'Decline';
    declineBtn.addEventListener('click', async () => {
      declineBtn.disabled = true;
      try {
        await api(`/api/agendas/council/submissions/${s.id}/decline`, {
          method: 'POST',
          body: JSON.stringify({ review_note: '' }),
        });
        showToast(`Declined "${s.title}"`, 'ok');
        await loadPendingCouncilSubmissions();
      } catch (err) {
        showToast(err.message, 'error');
        declineBtn.disabled = false;
      }
    });

    actWrap.append(acceptBtn, declineBtn);
    tdActions.appendChild(actWrap);
    tr.append(tdItem, tdUser, tdTarget, tdAssign, tdActions);
    tbody.appendChild(tr);
  }
}

document.getElementById('create-agenda-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('agenda-form-error');
  errEl.textContent = '';
  const titleEl = document.getElementById('agenda-title');
  const bodyEl = document.getElementById('agenda-body');
  const dateEl = document.getElementById('agenda-date');
  const timeEl = document.getElementById('agenda-time');
  const tplEl = document.getElementById('agenda-template');
  try {
    const payload = {
      title: titleEl.value.trim(),
      body: bodyEl.value.trim(),
      meeting_date: dateEl.value,
      meeting_time: timeEl.value,
    };
    if (tplEl.value) payload.template_id = Number(tplEl.value);
    const created = await api('/api/agendas', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    titleEl.value = ''; dateEl.value = ''; tplEl.value = '';
    timeEl.value = toTimeInputValue(state.defaultMeetingTime);
    state.agendasList = [created, ...state.agendasList.filter(a => a.id !== created.id)];
    renderAgendaDetail(created);
    showAgendaDetail();
    setAgendaTab('edit');
  } catch (err) { errEl.textContent = err.message; }
});
