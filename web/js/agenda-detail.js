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

import { state, api, showAgendaList, showAgendaDetail, toTimeInputValue, syncSectionsDatalist, makeInlineInput, categoryBadgeClass, setAgendaStatus } from './state.js';
import { loadAgendas } from './agendas-list.js';
import { updateBacklogNavBadge } from './backlog.js';
import { initAgendaTransfer, renderBacklogPopup } from './agenda-transfer.js';
import { initAgendaItems, renderEditItems } from './agenda-items.js';
import { renderContentsView } from './agenda-contents.js';
import { renderMinutesView } from './agenda-minutes.js';


export function setAgendaTab(tab, pushHash = true) {
  const active = (tab === 'contents' || tab === 'minutes') ? tab : 'edit';
  document.getElementById('tab-edit').classList.toggle('active', active === 'edit');
  document.getElementById('tab-contents').classList.toggle('active', active === 'contents');
  document.getElementById('tab-minutes').classList.toggle('active', active === 'minutes');
  document.getElementById('agenda-edit-pane').hidden = active !== 'edit';
  document.getElementById('agenda-contents-pane').hidden = active !== 'contents';
  document.getElementById('agenda-minutes-pane').hidden = active !== 'minutes';
  if (state.currentAgenda) {
    const suffix = active === 'edit' ? '' : `/${active}`;
    const targetHash = `#agendas/${state.currentAgenda.id}${suffix}`;
    if (pushHash && location.hash !== targetHash) history.pushState(null, '', targetHash);
  }
}

document.getElementById('back-to-agendas').addEventListener('click', () => {
  if (location.hash !== '#agendas') history.pushState(null, '', '#agendas');
  showAgendaList();
  loadAgendas();
});
document.getElementById('tab-edit').addEventListener('click', () => setAgendaTab('edit'));
document.getElementById('tab-contents').addEventListener('click', () => setAgendaTab('contents'));
document.getElementById('tab-minutes').addEventListener('click', () => setAgendaTab('minutes'));

export async function openAgenda(agendaId, tab = 'edit', pushHash = true) {
  if (!pushHash && state.currentAgenda && state.currentAgenda.id === agendaId) {
    showAgendaDetail();
    setAgendaTab(tab, false);
    return;
  }
  const [agenda, prefs, allAgendas, backlog, forAgendaBacklog] = await Promise.all([
    api(`/api/agendas/${agendaId}`),
    api('/api/agendas/preferences'),
    api('/api/agendas'),
    api('/api/agendas/backlog'),
    api(`/api/agendas/backlog/for-agenda/${agendaId}`),
  ]);
  const backlogList = Array.isArray(backlog) ? backlog : [];
  updateBacklogNavBadge(backlogList);
  renderBacklogPopup(agenda, Array.isArray(forAgendaBacklog) ? forAgendaBacklog : []);
  state.agendasList = Array.isArray(allAgendas) ? allAgendas : [];
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
  renderAgendaDetail(agenda);
  showAgendaDetail();
  setAgendaTab(tab, pushHash);
}

document.getElementById('edit-agenda-meta-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!state.currentAgenda) return;
  const msg = document.getElementById('detail-save-msg');
  msg.className = 'ok-msg';
  msg.textContent = '';
  try {
    const updated = await api(`/api/agendas/${state.currentAgenda.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        body: document.getElementById('detail-body-select').value,
        meeting_date: document.getElementById('detail-date-input').value,
        meeting_time: document.getElementById('detail-time-input').value,
      }),
    });
    renderAgendaDetail(updated);
    document.getElementById('detail-save-msg').textContent = 'Saved.';
  } catch (err) {
    msg.className = 'error-msg';
    msg.textContent = err.message;
  }
});

export function renderAgendaDetail(agenda) {
  state.currentAgenda = agenda;
  const titleEl = document.getElementById('detail-title');
  titleEl.textContent = agenda.title;
  titleEl.className = 'editable';
  titleEl.title = 'Click to edit meeting name';
  titleEl.onclick = () => makeInlineInput(titleEl, agenda.title, {
    required: true,
    onSave: async (next) => renderAgendaDetail(await api(`/api/agendas/${agenda.id}`, {
      method: 'PATCH', body: JSON.stringify({ title: next }),
    })),
  });

  const statusBadge = document.getElementById('detail-status-badge');
  statusBadge.hidden = !agenda.status;
  statusBadge.className = categoryBadgeClass(agenda.status);
  statusBadge.textContent = agenda.status || '';
  document.getElementById('detail-save-msg').textContent = '';

  const logEl = document.getElementById('detail-activity-log');
  logEl.textContent = '';
  const showFinalized = Boolean(agenda.finalized_at && categoryBadgeClass(agenda.status) === 'badge active');
  if (showFinalized) {
    const finSpan = document.createElement('span');
    finSpan.textContent = `Finalized: ${new Date(agenda.finalized_at).toLocaleString()} `;
    logEl.appendChild(finSpan);
  }
  const logs = Array.isArray(agenda.activity_log) ? agenda.activity_log : [];
  if (logs.length) {
    const det = document.createElement('details');
    det.style.display = 'inline-block';
    det.style.marginLeft = showFinalized ? '.4rem' : '0';
    const sum = document.createElement('summary');
    sum.style.cssText = 'cursor:pointer; color:#1d4ed8;';
    sum.textContent = `Status Log (${logs.length})`;
    det.appendChild(sum);
    const ul = document.createElement('ul');
    ul.style.cssText = 'margin:.35rem 0 0; padding-left:1.1rem;';
    for (const ev of logs) {
      const li = document.createElement('li');
      const ts = ev.created_at ? new Date(ev.created_at).toLocaleString() : '';
      li.textContent = `${ts} — ${ev.action}${ev.actor ? ' by ' + ev.actor : ''}${ev.note ? ' (' + ev.note + ')' : ''}`;
      ul.appendChild(li);
    }
    det.appendChild(ul);
    logEl.appendChild(det);
  }

  const detailBodySel = document.getElementById('detail-body-select');
  detailBodySel.textContent = '';
  const opts = [...state.configuredBodies];
  if (agenda.body && !opts.includes(agenda.body)) opts.unshift(agenda.body);
  for (const b of opts) {
    const opt = document.createElement('option');
    opt.value = b; opt.textContent = b;
    opt.selected = b === agenda.body;
    detailBodySel.appendChild(opt);
  }
  document.getElementById('detail-date-input').value = agenda.meeting_date || '';
  document.getElementById('detail-time-input').value = toTimeInputValue(agenda.meeting_time || state.defaultMeetingTime);
  const statusSel = document.getElementById('detail-status-select');
  statusSel.textContent = '';
  const noneOpt = document.createElement('option');
  noneOpt.value = ''; noneOpt.textContent = '(No Category)';
  noneOpt.selected = !agenda.status;
  statusSel.appendChild(noneOpt);
  const catNames = state.configuredCategories.map(c => c.name);
  if (agenda.status && !catNames.includes(agenda.status)) catNames.unshift(agenda.status);
  for (const cname of catNames) {
    const opt = document.createElement('option');
    opt.value = cname; opt.textContent = cname;
    opt.selected = cname === agenda.status;
    statusSel.appendChild(opt);
  }
  statusSel.onchange = async () => {
    const updated = await setAgendaStatus(agenda.id, agenda.status, statusSel.value, agenda.title);
    if (updated) renderAgendaDetail(updated);
    else statusSel.value = agenda.status;
  };
  document.getElementById('detail-clone-btn').onclick = async () => {
    const cloned = await api(`/api/agendas/${agenda.id}/clone`, { method: 'POST' });
    openAgenda(cloned.id);
  };
  document.getElementById('detail-save-tpl-btn').onclick = async () => {
    const name = prompt('Template name:', `${agenda.body || 'Meeting'} Template`);
    if (!name || !name.trim()) return;
    await api(`/api/agendas/${agenda.id}/save-template`, {
      method: 'POST',
      body: JSON.stringify({ name: name.trim() }),
    });
    document.getElementById('detail-save-msg').textContent = 'Template saved.';
  };
  document.getElementById('view-summary-pdf').href = `/api/agendas/${agenda.id}/packet.pdf?summary=1`;
  document.getElementById('view-packet-pdf').href = `/api/agendas/${agenda.id}/packet.pdf`;
  document.getElementById('dl-packet-pdf').href = `/api/agendas/${agenda.id}/packet.pdf?download=1`;
  document.getElementById('view-minutes-pdf').href = `/api/agendas/${agenda.id}/minutes.pdf`;
  document.getElementById('dl-minutes-pdf').href = `/api/agendas/${agenda.id}/minutes.pdf?download=1`;

  renderEditItems(agenda);
  renderContentsView(agenda);
  renderMinutesView(agenda);
}

initAgendaTransfer({ openAgenda });
initAgendaItems({ renderAgendaDetail });
