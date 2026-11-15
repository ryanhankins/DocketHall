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

import { state, api, showAgendaList, showAgendaDetail, toTimeInputValue, formatTime12h, formatSize, syncSectionsDatalist, makeInlineInput, categoryBadgeClass, setAgendaStatus, showToast } from './state.js';
import { loadAgendas } from './agendas-list.js';
import { todayIso, updateBacklogNavBadge, openCreateTodoModal, recurrenceLabel } from './backlog.js';


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

function createAgendaTransferControl(otherAgendas, { className, placeholder, ariaLabel, subjectLabel, onTransfer }) {
  const sel = document.createElement('select');
  sel.className = `btn sm ${className}`;
  sel.style.width = 'auto';
  sel.setAttribute('aria-label', ariaLabel);
  const defOpt = document.createElement('option');
  defOpt.value = '';
  defOpt.textContent = placeholder;
  sel.appendChild(defOpt);
  for (const [mode, groupLabel] of [['move', 'Move to…'], ['copy', 'Copy to…']]) {
    const grp = document.createElement('optgroup');
    grp.label = groupLabel;
    for (const oa of otherAgendas) {
      const opt = document.createElement('option');
      opt.value = `${mode}:${oa.id}`;
      opt.textContent = oa.meeting_date ? `${oa.title} (${oa.meeting_date})` : oa.title;
      grp.appendChild(opt);
    }
    sel.appendChild(grp);
  }
  sel.addEventListener('change', async () => {
    const raw = sel.value;
    if (!raw) return;
    const [mode, idStr] = raw.split(':');
    const targetId = Number(idStr);
    const targetTitle = sel.options[sel.selectedIndex].textContent;
    const verb = mode === 'copy' ? 'Copy' : 'Move';
    if (!confirm(`${verb} ${subjectLabel} to "${targetTitle}"?`)) {
      sel.value = '';
      return;
    }
    try {
      await onTransfer(targetId, mode === 'copy');
      if (mode === 'copy') sel.value = '';
      showToast(
        `${mode === 'copy' ? 'Copied' : 'Moved'} ${subjectLabel} to "${targetTitle}"`,
        'ok',
        { label: 'Open', onClick: () => openAgenda(targetId) },
      );
    } catch (err) {
      showToast(err.message, 'error');
      sel.value = '';
    }
  });
  return sel;
}

document.getElementById('agenda-backlog-popup-dismiss')?.addEventListener('click', () => {
  document.getElementById('agenda-backlog-popup').hidden = true;
});

async function loadImportSource(sourceId) {
  const box = document.getElementById('import-source-content');
  if (!box) return;
  if (!sourceId) {
    box.textContent = '';
    return;
  }
  box.textContent = 'Loading…';
  try {
    const src = await api(`/api/agendas/${sourceId}`);
    box.textContent = '';
    const items = Array.isArray(src.items) ? src.items : [];
    if (!items.length) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = 'This agenda has no items.';
      box.appendChild(p);
      return;
    }

    // Group by section
    const sections = new Map();
    for (const it of items) {
      const sec = it.section || '';
      if (!sections.has(sec)) sections.set(sec, []);
      sections.get(sec).push(it);
    }

    for (const [secName, secItems] of sections.entries()) {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'border:1px solid #d9e2ec; border-radius:8px; padding:.65rem .8rem; background:#f8fafc;';
      if (secName) {
        const secHdr = document.createElement('div');
        secHdr.className = 'between';
        secHdr.style.marginBottom = '.45rem';
        const sTitle = document.createElement('strong');
        sTitle.textContent = `Section: ${secName} (${secItems.length})`;
        const sBtns = document.createElement('div');
        sBtns.className = 'actions';
        for (const [copy, lbl] of [[false, 'Move Section Here'], [true, 'Copy Section Here']]) {
          const btn = document.createElement('button');
          btn.type = 'button'; btn.className = copy ? 'btn sm' : 'btn sm primary'; btn.textContent = lbl;
          btn.addEventListener('click', async () => {
            btn.disabled = true;
            try {
              await api(`/api/agendas/${src.id}/sections/move`, {
                method: 'POST',
                body: JSON.stringify({ section: secName, target_agenda_id: state.currentAgenda.id, copy }),
              });
              showToast(`${copy ? 'Copied' : 'Moved'} section "${secName}" here`, 'ok');
              await openAgenda(state.currentAgenda.id, 'edit', false);
              await loadImportSource(src.id);
            } catch (err) {
              showToast(err.message, 'error');
              btn.disabled = false;
            }
          });
          sBtns.appendChild(btn);
        }
        secHdr.append(sTitle, sBtns);
        wrap.appendChild(secHdr);
      }

      for (const it of secItems) {
        const row = document.createElement('div');
        row.className = 'between';
        row.style.cssText = 'background:#fff; border:1px solid #e2e8f0; border-radius:6px; padding:.4rem .6rem; margin-top:.35rem; gap:.5rem;';
        const lbl = document.createElement('span');
        lbl.textContent = `${it.position}. ${it.title}`;
        const btns = document.createElement('div');
        btns.className = 'actions';
        for (const [copy, txt] of [[false, 'Move Here'], [true, 'Copy Here']]) {
          const btn = document.createElement('button');
          btn.type = 'button'; btn.className = 'btn sm'; btn.textContent = txt;
          btn.addEventListener('click', async () => {
            btn.disabled = true;
            try {
              await api(`/api/agendas/${src.id}/items/${it.id}/move`, {
                method: 'POST',
                body: JSON.stringify({ target_agenda_id: state.currentAgenda.id, copy }),
              });
              showToast(`${copy ? 'Copied' : 'Moved'} "${it.title}" here`, 'ok');
              await openAgenda(state.currentAgenda.id, 'edit', false);
              await loadImportSource(src.id);
            } catch (err) {
              showToast(err.message, 'error');
              btn.disabled = false;
            }
          });
          btns.appendChild(btn);
        }
        row.append(lbl, btns);
        wrap.appendChild(row);
      }
      box.appendChild(wrap);
    }
  } catch (err) {
    box.textContent = '';
    const p = document.createElement('p');
    p.className = 'error-msg';
    p.textContent = err.message;
    box.appendChild(p);
  }
}

document.getElementById('open-import-agenda-btn')?.addEventListener('click', async () => {
  if (!state.currentAgenda) return;
  const dlg = document.getElementById('import-agenda-dialog');
  const sel = document.getElementById('import-source-agenda');
  const box = document.getElementById('import-source-content');
  if (!dlg || !sel || !box) return;

  const all = await api('/api/agendas').catch(() => state.agendasList || []);
  state.agendasList = Array.isArray(all) ? all : [];
  const others = state.agendasList.filter(a => a.id !== state.currentAgenda.id);
  sel.textContent = '';
  if (!others.length) {
    const opt = document.createElement('option');
    opt.value = ''; opt.textContent = '(No other agendas available)';
    sel.appendChild(opt);
    box.textContent = 'Create another agenda first to import items from it.';
  } else {
    for (const a of others) {
      const opt = document.createElement('option');
      opt.value = String(a.id);
      opt.textContent = a.meeting_date ? `${a.title} (${a.meeting_date})` : a.title;
      sel.appendChild(opt);
    }
    loadImportSource(Number(sel.value));
  }
  dlg.showModal();
});
document.getElementById('import-source-agenda')?.addEventListener('change', (e) => {
  loadImportSource(Number(e.target.value));
});
document.getElementById('close-import-agenda')?.addEventListener('click', () => {
  document.getElementById('import-agenda-dialog')?.close();
});

function renderBacklogPopup(agenda, matching) {
  const box = document.getElementById('agenda-backlog-popup');
  const titleEl = document.getElementById('agenda-backlog-popup-title');
  const listEl = document.getElementById('agenda-backlog-popup-list');
  if (!box || !listEl) return;

  if (!matching.length) {
    box.hidden = true;
    listEl.textContent = '';
    return;
  }
  titleEl.textContent = `${matching.length} scheduled / backlog item(s) ready for this agenda`;
  listEl.textContent = '';
  for (const it of matching) {
    const row = document.createElement('div');
    row.className = 'between';
    row.style.cssText = 'background:#fff; border:1px solid #fde68a; border-radius:6px; padding:.45rem .65rem; gap:.6rem;';

    const info = document.createElement('div');
    const strong = document.createElement('strong');
    strong.textContent = it.title;
    const meta = document.createElement('span');
    meta.className = 'muted';
    const docCnt = (it.documents || []).length;
    const parts = [];
    if (it.recurrence && it.recurrence !== 'none') parts.push(recurrenceLabel(it));
    if (it.target_date) parts.push(`Due: ${it.target_date}`);
    if (it.assigned_to) parts.push(`Assigned: ${it.assigned_to}`);
    if (it.section) parts.push(it.section);
    if (docCnt) parts.push(`${docCnt} doc(s)`);
    meta.textContent = parts.length ? ` — ${parts.join(' · ')}` : '';
    info.append(strong, meta);

    const btns = document.createElement('div');
    btns.className = 'actions';
    const isRec = it.recurrence && it.recurrence !== 'none';
    const addBtn = document.createElement('button');
    addBtn.type = 'button'; addBtn.className = 'btn sm primary'; addBtn.textContent = 'Add to Agenda';
    addBtn.addEventListener('click', async () => {
      addBtn.disabled = true;
      try {
        await api(`/api/agendas/backlog/${it.id}/assign`, {
          method: 'POST',
          body: JSON.stringify({ target_agenda_id: agenda.id, copy: isRec }),
        });
        showToast(`Added "${it.title}" to agenda`, 'ok');
        await openAgenda(agenda.id, 'edit', false);
      } catch (err) {
        showToast(err.message, 'error');
        addBtn.disabled = false;
      }
    });
    btns.appendChild(addBtn);

    if (!isRec) {
      const copyBtn = document.createElement('button');
      copyBtn.type = 'button'; copyBtn.className = 'btn sm'; copyBtn.textContent = 'Copy';
      copyBtn.addEventListener('click', async () => {
        copyBtn.disabled = true;
        try {
          await api(`/api/agendas/backlog/${it.id}/assign`, {
            method: 'POST',
            body: JSON.stringify({ target_agenda_id: agenda.id, copy: true }),
          });
          showToast(`Copied "${it.title}" to agenda`, 'ok');
          await openAgenda(agenda.id, 'edit', false);
        } catch (err) {
          showToast(err.message, 'error');
          copyBtn.disabled = false;
        }
      });
      btns.appendChild(copyBtn);
    }

    row.append(info, btns);
    listEl.appendChild(row);
  }
  box.hidden = false;
}

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

let draggedItemId = null;
let draggedDoc = null;
let draggedSectionIdx = null;
const collapsedItems = new Set();
const collapsedSections = new Set();

document.getElementById('collapse-all-btn').addEventListener('click', () => {
  if (!state.currentAgenda) return;
  for (const it of state.currentAgenda.items) {
    collapsedItems.add(it.id);
    const sec = (it.section || '').trim();
    if (sec) collapsedSections.add(`${state.currentAgenda.id}:${sec}`);
  }
  renderEditItems(state.currentAgenda);
});

document.getElementById('expand-all-btn').addEventListener('click', () => {
  if (!state.currentAgenda) return;
  for (const it of state.currentAgenda.items) {
    collapsedItems.delete(it.id);
    const sec = (it.section || '').trim();
    if (sec) collapsedSections.delete(`${state.currentAgenda.id}:${sec}`);
  }
  renderEditItems(state.currentAgenda);
});

function renderEditItems(agenda) {
  draggedItemId = null;
  draggedDoc = null;
  draggedSectionIdx = null;
  const container = document.getElementById('items-container');
  container.textContent = '';
  if (!agenda.items.length) {
    const empty = document.createElement('div');
    empty.className = 'card muted';
    empty.textContent = 'No agenda items yet. Add the first item above.';
    container.appendChild(empty);
    return;
  }

  const groups = [];
  for (const item of agenda.items) {
    const secName = (item.section || '').trim();
    if (secName && groups.length && groups[groups.length - 1].section === secName) {
      groups[groups.length - 1].items.push(item);
    } else {
      groups.push({ section: secName, items: [item] });
    }
  }

  groups.forEach((group, gIdx) => {
    const groupEl = document.createElement('div');
    groupEl.className = 'section-group';
    const secKey = group.section ? `${agenda.id}:${group.section}` : '';
    const isSecCollapsed = !!(secKey && collapsedSections.has(secKey));
    const sectionItemsEl = document.createElement('div');
    sectionItemsEl.className = 'section-items';
    sectionItemsEl.hidden = isSecCollapsed;

    if (group.section) {
      const secHdr = document.createElement('div');
      secHdr.style.cssText = 'display:flex; align-items:center; gap:.4rem; font-size:.82rem; font-weight:700; letter-spacing:.04em; text-transform:uppercase; color:#1e3a8a; margin:1rem 0 .4rem; padding-left:.25rem; border-left:3px solid #1d4ed8;';
      if (groups.length > 1) {
        const secHandle = document.createElement('span');
        secHandle.className = 'drag-handle';
        secHandle.textContent = '⋮⋮';
        secHandle.title = 'Drag to reorder entire section';
        secHandle.setAttribute('aria-label', 'Drag section');
        secHandle.addEventListener('mouseenter', () => { groupEl.draggable = true; });
        secHandle.addEventListener('mouseleave', () => { if (draggedSectionIdx !== gIdx) groupEl.draggable = false; });
        secHandle.addEventListener('mousedown', () => { groupEl.draggable = true; });
        secHandle.addEventListener('mouseup', () => { groupEl.draggable = false; });
        secHdr.appendChild(secHandle);
      }
      const secToggle = document.createElement('button');
      secToggle.type = 'button';
      secToggle.className = 'collapse-btn';
      secToggle.textContent = isSecCollapsed ? '▸' : '▾';
      secToggle.title = isSecCollapsed ? 'Expand section' : 'Collapse section';
      secToggle.setAttribute('aria-expanded', String(!isSecCollapsed));
      secToggle.style.cssText = 'border:0; background:none; cursor:pointer; font-size:.9rem; color:#1e3a8a; padding:0 .2rem; line-height:1;';
      const secTitle = document.createElement('span');
      secTitle.textContent = group.section;
      const secCount = document.createElement('span');
      secCount.className = 'muted';
      secCount.style.cssText = 'font-weight:400; text-transform:none; letter-spacing:0;';
      secCount.textContent = isSecCollapsed ? `(${group.items.length} item${group.items.length === 1 ? '' : 's'})` : '';
      secToggle.addEventListener('click', () => {
        if (collapsedSections.has(secKey)) {
          collapsedSections.delete(secKey);
        } else {
          collapsedSections.add(secKey);
        }
        const next = collapsedSections.has(secKey);
        sectionItemsEl.hidden = next;
        secToggle.textContent = next ? '▸' : '▾';
        secToggle.title = next ? 'Expand section' : 'Collapse section';
        secToggle.setAttribute('aria-expanded', String(!next));
        secCount.textContent = next ? `(${group.items.length} item${group.items.length === 1 ? '' : 's'})` : '';
      });
      secHdr.append(secToggle, secTitle, secCount);
      const otherAgendas = (state.agendasList || []).filter(a => a.id !== agenda.id);
      if (otherAgendas.length) {
        const moveSecSel = createAgendaTransferControl(otherAgendas, {
          className: 'move-section-select',
          placeholder: 'Move / Copy section…',
          ariaLabel: `Move or copy section ${group.section} to another agenda`,
          subjectLabel: `section "${group.section}" (${group.items.length} item(s))`,
          onTransfer: async (targetId, copy) => {
            renderAgendaDetail(await api(`/api/agendas/${agenda.id}/sections/move`, {
              method: 'POST',
              body: JSON.stringify({ section: group.section, target_agenda_id: targetId, copy }),
            }));
          },
        });
        moveSecSel.style.cssText = 'width:auto; margin-left:auto; font-weight:400; text-transform:none; letter-spacing:0;';
        secHdr.appendChild(moveSecSel);
      }
      secHdr.addEventListener('dragover', (e) => {
        if (draggedItemId === null) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        secHdr.classList.add('drag-over-top');
      });
      secHdr.addEventListener('dragleave', () => secHdr.classList.remove('drag-over-top'));
      secHdr.addEventListener('drop', async (e) => {
        if (draggedItemId === null) return;
        e.preventDefault();
        e.stopPropagation();
        secHdr.classList.remove('drag-over-top');
        const fromIdx = agenda.items.findIndex(x => x.id === draggedItemId);
        if (fromIdx === -1) return;
        let targetPos = group.items[0].position;
        if (fromIdx + 1 < targetPos) targetPos -= 1;
        targetPos = Math.max(1, Math.min(targetPos, agenda.items.length));
        if (targetPos === fromIdx + 1) return;
        renderAgendaDetail(await api(`/api/agendas/${agenda.id}/items/${draggedItemId}`, {
          method: 'PATCH', body: JSON.stringify({ position: targetPos }),
        }));
      });
      groupEl.appendChild(secHdr);
    }

    if (groups.length > 1) {
      groupEl.addEventListener('dragstart', (e) => {
        if (draggedItemId !== null || draggedDoc !== null) return;
        draggedSectionIdx = gIdx;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', `section:${gIdx}`);
        groupEl.classList.add('dragging');
      });
      groupEl.addEventListener('dragend', () => {
        groupEl.draggable = false;
        draggedSectionIdx = null;
        container.querySelectorAll('.section-group').forEach(el => {
          el.classList.remove('dragging', 'drag-over-top', 'drag-over-bottom');
        });
      });
      groupEl.addEventListener('dragover', (e) => {
        if (draggedSectionIdx === null || draggedSectionIdx === gIdx) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        container.querySelectorAll('.section-group').forEach(el => {
          if (el !== groupEl) el.classList.remove('drag-over-top', 'drag-over-bottom');
        });
        const rect = groupEl.getBoundingClientRect();
        const before = e.clientY < rect.top + rect.height / 2;
        groupEl.classList.toggle('drag-over-top', before);
        groupEl.classList.toggle('drag-over-bottom', !before);
      });
      groupEl.addEventListener('dragleave', (e) => {
        if (!groupEl.contains(e.relatedTarget)) {
          groupEl.classList.remove('drag-over-top', 'drag-over-bottom');
        }
      });
      groupEl.addEventListener('drop', async (e) => {
        if (draggedSectionIdx === null || draggedSectionIdx === gIdx) return;
        e.preventDefault();
        groupEl.classList.remove('drag-over-top', 'drag-over-bottom');
        const fromIdx = draggedSectionIdx;
        draggedSectionIdx = null;
        const rect = groupEl.getBoundingClientRect();
        const before = e.clientY < rect.top + rect.height / 2;
        const nextGroups = [...groups];
        const [moved] = nextGroups.splice(fromIdx, 1);
        let targetIdx = before ? gIdx : gIdx + 1;
        if (fromIdx < targetIdx) targetIdx -= 1;
        nextGroups.splice(targetIdx, 0, moved);
        const item_ids = nextGroups.flatMap(g => g.items.map(it => it.id));
        renderAgendaDetail(await api(`/api/agendas/${agenda.id}/items/reorder`, {
          method: 'POST', body: JSON.stringify({ item_ids }),
        }));
      });
    }

    group.items.forEach((item) => {
      const card = document.createElement('div');
      card.className = 'item-card';

    const header = document.createElement('div');
    header.className = 'item-header';

    const left = document.createElement('div');
    const titleRow = document.createElement('div');
    titleRow.style.display = 'flex';
    titleRow.style.alignItems = 'center';

    if (agenda.items.length > 1) {
      const handle = document.createElement('span');
      handle.className = 'drag-handle';
      handle.textContent = '⋮⋮';
      handle.title = 'Drag to reorder';
      handle.setAttribute('aria-label', 'Drag to reorder');
      handle.addEventListener('mouseenter', () => { card.draggable = true; });
      handle.addEventListener('mouseleave', () => { if (draggedItemId !== item.id) card.draggable = false; });
      handle.addEventListener('mousedown', () => { card.draggable = true; });
      handle.addEventListener('mouseup', () => { card.draggable = false; });
      titleRow.appendChild(handle);
    }

    const isItemCollapsed = collapsedItems.has(item.id);
    const itemToggle = document.createElement('button');
    itemToggle.type = 'button';
    itemToggle.className = 'collapse-btn';
    itemToggle.textContent = isItemCollapsed ? '▸' : '▾';
    itemToggle.title = isItemCollapsed ? 'Expand item' : 'Collapse item';
    itemToggle.setAttribute('aria-expanded', String(!isItemCollapsed));
    itemToggle.style.cssText = 'border:0; background:none; cursor:pointer; font-size:.9rem; color:#475569; padding:0 .25rem 0 0; line-height:1;';
    titleRow.appendChild(itemToggle);

    const numSpan = document.createElement('strong');
    numSpan.textContent = `${item.position}.\u00a0`;
    const h = document.createElement('strong');
    h.className = 'editable';
    h.title = 'Click to edit item title';
    h.textContent = item.title;
    h.addEventListener('click', () => makeInlineInput(h, item.title, {
      required: true,
      onSave: async (next) => renderAgendaDetail(await api(`/api/agendas/${agenda.id}/items/${item.id}`, {
        method: 'PATCH', body: JSON.stringify({ title: next }),
      })),
    }));
    titleRow.append(numSpan, h);
    let rb = null;
    if (item.revision_status === 'revised' || item.revision_status === 'addendum') {
      rb = document.createElement('span');
      rb.className = item.revision_status === 'revised' ? 'badge draft' : 'badge active';
      rb.style.marginLeft = '.45rem';
      rb.textContent = item.revision_status === 'revised' ? 'REVISED' : 'ADDENDUM';
      titleRow.appendChild(rb);
    }
    const revSel = document.createElement('select');
    revSel.title = 'Revision / Addendum badge';
    revSel.style.cssText = 'margin-left:.5rem; font-size:.76rem; padding:.15rem .35rem; width:auto;';
    for (const [val, lbl] of [['', 'Badge: None'], ['revised', 'Revised'], ['addendum', 'Addendum']]) {
      const opt = document.createElement('option');
      opt.value = val; opt.textContent = lbl;
      opt.selected = (item.revision_status || '') === val;
      revSel.appendChild(opt);
    }
    revSel.addEventListener('change', async () => {
      renderAgendaDetail(await api(`/api/agendas/${agenda.id}/items/${item.id}`, {
        method: 'PATCH', body: JSON.stringify({ revision_status: revSel.value }),
      }));
    });
    titleRow.appendChild(revSel);
    left.appendChild(titleRow);

    card.addEventListener('dragstart', (e) => {
      e.stopPropagation();
      draggedItemId = item.id;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(item.id));
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', () => {
      card.draggable = false;
      draggedItemId = null;
      container.querySelectorAll('.item-card').forEach(c => {
        c.classList.remove('dragging', 'drag-over-top', 'drag-over-bottom');
      });
    });
    card.addEventListener('dragover', (e) => {
      if (draggedDoc && draggedDoc.itemId !== item.id) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        card.classList.add('drag-over');
        return;
      }
      if (draggedItemId === null || draggedItemId === item.id) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      container.querySelectorAll('.item-card').forEach(c => {
        if (c !== card) c.classList.remove('drag-over-top', 'drag-over-bottom');
      });
      const rect = card.getBoundingClientRect();
      const before = e.clientY < rect.top + rect.height / 2;
      card.classList.toggle('drag-over-top', before);
      card.classList.toggle('drag-over-bottom', !before);
    });
    card.addEventListener('dragleave', (e) => {
      if (!card.contains(e.relatedTarget)) {
        card.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-over');
      }
    });
    card.addEventListener('drop', async (e) => {
      if (draggedSectionIdx !== null) return;
      if (draggedDoc && draggedDoc.itemId !== item.id) {
        e.preventDefault();
        card.classList.remove('drag-over');
        const { itemId: srcItemId, docId } = draggedDoc;
        draggedDoc = null;
        renderAgendaDetail(await api(
          `/api/agendas/${agenda.id}/items/${srcItemId}/documents/${docId}`,
          { method: 'PATCH', body: JSON.stringify({ target_item_id: item.id }) }
        ));
        return;
      }
      e.preventDefault();
      card.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-over');
      if (draggedItemId === null || draggedItemId === item.id) return;
      const fromIdx = agenda.items.findIndex(x => x.id === draggedItemId);
      if (fromIdx === -1) return;
      const rect = card.getBoundingClientRect();
      const before = e.clientY < rect.top + rect.height / 2;
      let targetPos = before ? item.position : item.position + 1;
      if (fromIdx + 1 < targetPos) targetPos -= 1;
      targetPos = Math.max(1, Math.min(targetPos, agenda.items.length));
      if (targetPos === fromIdx + 1) return;
      renderAgendaDetail(await api(`/api/agendas/${agenda.id}/items/${draggedItemId}`, {
        method: 'PATCH', body: JSON.stringify({ position: targetPos }),
      }));
    });

    const p = document.createElement('div');
    p.className = item.description ? 'muted editable' : 'muted editable editable-empty';
    p.style.marginTop = '.25rem';
    p.title = 'Click to edit description';
    p.textContent = item.description || 'Click to add description…';
    p.addEventListener('click', () => makeInlineInput(p, item.description || '', {
      multiline: true,
      onSave: async (next) => renderAgendaDetail(await api(`/api/agendas/${agenda.id}/items/${item.id}`, {
        method: 'PATCH', body: JSON.stringify({ description: next }),
      })),
    }));
    left.appendChild(p);

    const metaGrid = document.createElement('div');
    metaGrid.style.cssText = 'display:flex; flex-wrap:wrap; gap:.4rem .9rem; margin-top:.35rem; font-size:.82rem;';
    for (const [fieldKey, label, placeholder] of [
      ['section', 'Section', 'Add section…'],
      ['presenter', 'Presenter', 'Add presenter…'],
      ['recommended_motion', 'Motion', 'Add recommended motion…'],
      ['fiscal_impact', 'Fiscal Impact', 'Add fiscal impact…'],
    ]) {
      const wrapSpan = document.createElement('span');
      const lblEl = document.createElement('span');
      lblEl.className = 'muted';
      lblEl.textContent = `${label}: `;
      const valEl = document.createElement('span');
      const curVal = item[fieldKey] || '';
      valEl.className = curVal ? 'editable' : 'muted editable editable-empty';
      valEl.textContent = curVal || placeholder;
      valEl.title = `Click to edit ${label.toLowerCase()}`;
      valEl.addEventListener('click', () => makeInlineInput(valEl, curVal, {
        listId: fieldKey === 'section' ? 'agenda-sections-datalist' : '',
        onSave: async (next) => renderAgendaDetail(await api(`/api/agendas/${agenda.id}/items/${item.id}`, {
          method: 'PATCH', body: JSON.stringify({ [fieldKey]: next }),
        })),
      }));
      wrapSpan.append(lblEl, valEl);
      metaGrid.appendChild(wrapSpan);
    }
    left.appendChild(metaGrid);

    const ctrl = document.createElement('div');
    ctrl.className = 'actions';
    const otherAgendasForItem = (state.agendasList || []).filter(a => a.id !== agenda.id);
    if (otherAgendasForItem.length) {
      const moveItemSel = createAgendaTransferControl(otherAgendasForItem, {
        className: 'move-item-select',
        placeholder: 'Move / Copy…',
        ariaLabel: `Move or copy item ${item.title} to another agenda`,
        subjectLabel: `"${item.title}"`,
        onTransfer: async (targetId, copy) => {
          renderAgendaDetail(await api(`/api/agendas/${agenda.id}/items/${item.id}/move`, {
            method: 'POST',
            body: JSON.stringify({ target_agenda_id: targetId, copy }),
          }));
        },
      });
      ctrl.appendChild(moveItemSel);
    }
    const todoBtn = document.createElement('button');
    todoBtn.type = 'button'; todoBtn.className = 'btn sm'; todoBtn.textContent = '+ Todo';
    todoBtn.addEventListener('click', () => {
      openCreateTodoModal({
        title: item.title,
        body: agenda.body || '',
        source_agenda_id: agenda.id,
        source_item_id: item.id,
        notes: item.recommended_motion || item.description || '',
      });
    });
    ctrl.appendChild(todoBtn);

    const toBacklogBtn = document.createElement('button');
    toBacklogBtn.type = 'button'; toBacklogBtn.className = 'btn sm'; toBacklogBtn.textContent = 'To Backlog';
    toBacklogBtn.addEventListener('click', async () => {
      if (!confirm(`Move "${item.title}" to the Item Backlog?`)) return;
      toBacklogBtn.disabled = true;
      try {
        renderAgendaDetail(await api(`/api/agendas/${agenda.id}/items/${item.id}/move-to-backlog`, {
          method: 'POST',
          body: JSON.stringify({}),
        }));
        api('/api/agendas/backlog').then(updateBacklogNavBadge).catch(() => {});
        showToast(`Moved "${item.title}" to Item Backlog`, 'ok');
      } catch (err) {
        showToast(err.message, 'error');
        toBacklogBtn.disabled = false;
      }
    });
    ctrl.appendChild(toBacklogBtn);

    const rmBtn = document.createElement('button');
    rmBtn.type = 'button'; rmBtn.className = 'btn sm danger'; rmBtn.textContent = 'Remove Item';
    rmBtn.addEventListener('click', async () => {
      if (!confirm(`Remove item "${item.title}" and its documents?`)) return;
      renderAgendaDetail(await api(`/api/agendas/${agenda.id}/items/${item.id}`, { method: 'DELETE' }));
    });
    ctrl.appendChild(rmBtn);

    header.append(left, ctrl);
    card.appendChild(header);

    // Supporting documents list
    const docList = document.createElement('ul');
    docList.className = 'doc-list';
    for (const d of item.documents) {
      const li = document.createElement('li');
      li.style.flexWrap = 'wrap';
      const info = document.createElement('div');
      info.className = 'actions';

      const docHandle = document.createElement('span');
      docHandle.className = 'drag-handle';
      docHandle.textContent = '⋮⋮';
      docHandle.title = 'Drag to reorder or move to another item';
      docHandle.setAttribute('aria-label', 'Drag attachment');
      docHandle.addEventListener('mouseenter', () => { li.draggable = true; });
      docHandle.addEventListener('mouseleave', () => { if (!draggedDoc || draggedDoc.docId !== d.id) li.draggable = false; });
      docHandle.addEventListener('mousedown', () => { li.draggable = true; });
      docHandle.addEventListener('mouseup', () => { li.draggable = false; });

      li.addEventListener('dragstart', (e) => {
        e.stopPropagation();
        draggedDoc = { itemId: item.id, docId: d.id };
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', `doc:${d.id}`);
        li.classList.add('dragging');
      });
      li.addEventListener('dragend', () => {
        li.draggable = false;
        draggedDoc = null;
        document.querySelectorAll('.doc-list li').forEach(el => {
          el.classList.remove('dragging', 'drag-over-top', 'drag-over-bottom');
        });
        document.querySelectorAll('.item-card').forEach(el => el.classList.remove('drag-over'));
      });
      li.addEventListener('dragover', (e) => {
        if (!draggedDoc || draggedDoc.docId === d.id) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        const rect = li.getBoundingClientRect();
        const before = e.clientY < rect.top + rect.height / 2;
        li.classList.toggle('drag-over-top', before);
        li.classList.toggle('drag-over-bottom', !before);
      });
      li.addEventListener('dragleave', () => {
        li.classList.remove('drag-over-top', 'drag-over-bottom');
      });
      li.addEventListener('drop', async (e) => {
        if (!draggedDoc || draggedDoc.docId === d.id) return;
        e.preventDefault();
        e.stopPropagation();
        li.classList.remove('drag-over-top', 'drag-over-bottom');
        const { itemId: srcItemId, docId } = draggedDoc;
        draggedDoc = null;
        const rect = li.getBoundingClientRect();
        const before = e.clientY < rect.top + rect.height / 2;
        let targetPos = before ? d.position : d.position + 1;
        if (srcItemId === item.id) {
          const srcIdx = item.documents.findIndex(x => x.id === docId);
          if (srcIdx !== -1 && srcIdx + 1 < targetPos) targetPos -= 1;
          targetPos = Math.max(1, Math.min(targetPos, item.documents.length));
          if (srcIdx !== -1 && targetPos === srcIdx + 1) return;
          renderAgendaDetail(await api(
            `/api/agendas/${agenda.id}/items/${srcItemId}/documents/${docId}`,
            { method: 'PATCH', body: JSON.stringify({ position: targetPos }) }
          ));
        } else {
          renderAgendaDetail(await api(
            `/api/agendas/${agenda.id}/items/${srcItemId}/documents/${docId}`,
            { method: 'PATCH', body: JSON.stringify({ target_item_id: item.id, position: targetPos }) }
          ));
        }
      });

      const badge = document.createElement('span');
      badge.className = `badge ${d.doc_type.toLowerCase()}`;
      badge.textContent = d.doc_type;
      const docNumSpan = document.createElement('span');
      docNumSpan.textContent = `${item.position}.${d.position}\u00a0`;
      const label = document.createElement('span');
      label.className = 'editable';
      label.title = 'Click to rename attachment';
      label.textContent = d.title;
      label.addEventListener('click', () => makeInlineInput(label, d.title, {
        required: true,
        onSave: async (next) => renderAgendaDetail(await api(
          `/api/agendas/${agenda.id}/items/${item.id}/documents/${d.id}`,
          { method: 'PATCH', body: JSON.stringify({ title: next }) }
        )),
      }));
      const meta = document.createElement('span');
      meta.className = 'muted';
      meta.textContent = `(${d.filename}, ${formatSize(d.size_bytes)})`;
      info.append(docHandle, badge, docNumSpan, label, meta);

      const docActions = document.createElement('div');
      docActions.className = 'actions';
      const viewPdf = document.createElement('a');
      viewPdf.className = 'btn sm';
      viewPdf.href = `/api/agendas/${agenda.id}/documents/${d.id}/pdf`;
      viewPdf.target = '_blank';
      viewPdf.textContent = 'View PDF';
      docActions.appendChild(viewPdf);

      let textEditBox = null;
      if (d.doc_type === 'TEXT') {
        const editTextBtn = document.createElement('button');
        editTextBtn.type = 'button';
        editTextBtn.className = 'btn sm';
        editTextBtn.textContent = 'Edit Text';
        editTextBtn.addEventListener('click', async () => {
          if (textEditBox) {
            textEditBox.hidden = !textEditBox.hidden;
            return;
          }
          const res = await fetch(`/api/agendas/${agenda.id}/documents/${d.id}/download`, {
            credentials: 'same-origin',
          });
          const txt = res.ok ? await res.text() : '';
          textEditBox = document.createElement('form');
          textEditBox.style.cssText = 'width:100%; margin-top:.45rem;';
          const ta = document.createElement('textarea');
          ta.rows = 5;
          ta.value = txt;
          ta.style.cssText = 'width:100%; margin-bottom:.35rem;';
          const rowBtns = document.createElement('div');
          rowBtns.className = 'actions';
          const saveBtn = document.createElement('button');
          saveBtn.type = 'submit'; saveBtn.className = 'btn sm primary'; saveBtn.textContent = 'Save Text';
          const cancelBtn = document.createElement('button');
          cancelBtn.type = 'button'; cancelBtn.className = 'btn sm'; cancelBtn.textContent = 'Cancel';
          cancelBtn.addEventListener('click', () => { textEditBox.hidden = true; });
          rowBtns.append(saveBtn, cancelBtn);
          textEditBox.append(ta, rowBtns);
          textEditBox.addEventListener('submit', async (ev) => {
            ev.preventDefault();
            saveBtn.disabled = true;
            try {
              renderAgendaDetail(await api(
                `/api/agendas/${agenda.id}/items/${item.id}/documents/${d.id}`,
                { method: 'PATCH', body: JSON.stringify({ content: ta.value }) }
              ));
            } finally {
              saveBtn.disabled = false;
            }
          });
          li.appendChild(textEditBox);
        });
        docActions.appendChild(editTextBtn);
      }

      if (d.doc_type !== 'PDF') {
        const dl = document.createElement('a');
        dl.className = 'btn sm';
        dl.href = `/api/agendas/${agenda.id}/documents/${d.id}/download`;
        dl.target = '_blank';
        dl.textContent = 'Original';
        docActions.appendChild(dl);
      }

      const delDoc = document.createElement('button');
      delDoc.type = 'button'; delDoc.className = 'btn sm danger'; delDoc.textContent = 'Remove';
      delDoc.addEventListener('click', async () => {
        renderAgendaDetail(await api(
          `/api/agendas/${agenda.id}/items/${item.id}/documents/${d.id}`,
          { method: 'DELETE' }
        ));
      });
      docActions.appendChild(delDoc);
      li.append(info, docActions);
      docList.appendChild(li);
    }
    card.appendChild(docList);

    // Add supporting document form
    const uploadForm = document.createElement('form');
    uploadForm.className = 'row';
    uploadForm.style.marginTop = '.65rem';

    const titleInput = document.createElement('input');
    titleInput.placeholder = 'Document title (optional)';
    titleInput.style.minWidth = '180px';

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.pdf,.docx,.xlsx,.csv,.pptx,.png,.jpg,.jpeg,.txt,.md';
    fileInput.required = true;

    const upBtn = document.createElement('button');
    upBtn.type = 'submit'; upBtn.className = 'btn sm'; upBtn.textContent = 'Add Document';

    const docErr = document.createElement('div');
    docErr.className = 'error-msg';

    const dropZone = document.createElement('div');
    dropZone.className = 'drop-zone';
    dropZone.textContent = 'Drag & drop PDF, DOCX, XLSX, CSV, PPTX, PNG, JPG, or TXT/MD files here';

    async function uploadDroppedFiles(files) {
      docErr.textContent = '';
      let latest = null;
      const errs = [];
      dropZone.textContent = `Uploading ${files.length} file(s)…`;
      for (const f of files) {
        const fd = new FormData();
        fd.append('file', f);
        fd.append('title', '');
        try {
          latest = await api(
            `/api/agendas/${agenda.id}/items/${item.id}/documents`,
            { method: 'POST', body: fd }
          );
        } catch (err) {
          errs.push(`${f.name}: ${err.message}`);
        }
      }
      if (latest) renderAgendaDetail(latest);
      if (errs.length) {
        dropZone.textContent = 'Drag & drop PDF, DOCX, XLSX, CSV, PPTX, PNG, JPG, or TXT/MD files here';
        docErr.textContent = errs.join(' | ');
      }
    }

    const isFileDrag = (e) =>
      draggedItemId === null &&
      e.dataTransfer &&
      Array.from(e.dataTransfer.types || []).includes('Files');

    card.addEventListener('dragover', (e) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      card.classList.add('file-drag-over');
    });
    card.addEventListener('dragleave', (e) => {
      if (!card.contains(e.relatedTarget)) card.classList.remove('file-drag-over');
    });
    card.addEventListener('drop', async (e) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      card.classList.remove('file-drag-over');
      const files = Array.from(e.dataTransfer.files || []);
      if (files.length) await uploadDroppedFiles(files);
    });

    uploadForm.append(titleInput, fileInput, upBtn);
    uploadForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      docErr.textContent = '';
      if (!fileInput.files.length) return;
      const fd = new FormData();
      fd.append('file', fileInput.files[0]);
      fd.append('title', titleInput.value.trim());
      upBtn.disabled = true;
      try {
        const updated = await api(
          `/api/agendas/${agenda.id}/items/${item.id}/documents`,
          { method: 'POST', body: fd }
        );
        renderAgendaDetail(updated);
      } catch (err) {
        docErr.textContent = err.message;
      } finally {
        upBtn.disabled = false;
      }
    });
    card.append(uploadForm, dropZone, docErr);

    // Add typed text attachment form
    const textDetails = document.createElement('details');
    textDetails.style.marginTop = '.5rem';
    const textSummary = document.createElement('summary');
    textSummary.className = 'btn sm';
    textSummary.style.listStyle = 'none';
    textSummary.textContent = '+ Add Text Attachment';
    textDetails.appendChild(textSummary);

    const textForm = document.createElement('form');
    textForm.style.marginTop = '.65rem';
    const textTitle = document.createElement('input');
    textTitle.placeholder = 'Attachment title (e.g. Staff Summary)';
    textTitle.required = true;
    textTitle.style.cssText = 'width:100%; margin-bottom:.45rem;';
    const textArea = document.createElement('textarea');
    textArea.rows = 4;
    textArea.required = true;
    textArea.placeholder = 'Type or paste the attachment text here...';
    textArea.style.cssText = 'width:100%; margin-bottom:.45rem;';
    const textSubmit = document.createElement('button');
    textSubmit.type = 'submit';
    textSubmit.className = 'btn sm primary';
    textSubmit.textContent = 'Save Text Attachment';
    const textErr = document.createElement('div');
    textErr.className = 'error-msg';
    textForm.append(textTitle, textArea, textSubmit, textErr);

    textForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      textErr.textContent = '';
      textSubmit.disabled = true;
      try {
        const updated = await api(
          `/api/agendas/${agenda.id}/items/${item.id}/text-documents`,
          {
            method: 'POST',
            body: JSON.stringify({
              title: textTitle.value.trim(),
              content: textArea.value,
            }),
          }
        );
        renderAgendaDetail(updated);
      } catch (err) {
        textErr.textContent = err.message;
      } finally {
        textSubmit.disabled = false;
      }
    });
    textDetails.appendChild(textForm);
    card.appendChild(textDetails);

    const itemDocHint = document.createElement('span');
    itemDocHint.className = 'muted';
    itemDocHint.style.cssText = 'font-size:.8rem; margin-left:.45rem;';
    const docCnt = (item.documents || []).length;
    itemDocHint.textContent = isItemCollapsed ? `(${docCnt} doc${docCnt === 1 ? '' : 's'})` : '';
    titleRow.appendChild(itemDocHint);

    const applyItemCollapse = (collapsed) => {
      p.hidden = collapsed;
      metaGrid.hidden = collapsed;
      docList.hidden = collapsed;
      uploadForm.hidden = collapsed;
      dropZone.hidden = collapsed;
      docErr.hidden = collapsed;
      textDetails.hidden = collapsed;
      revSel.hidden = collapsed;
      ctrl.hidden = collapsed;
      if (rb) rb.hidden = collapsed;
      itemDocHint.hidden = true;
      header.style.marginBottom = collapsed ? '0' : '';
      itemToggle.textContent = collapsed ? '▸' : '▾';
      itemToggle.title = collapsed ? 'Expand item' : 'Collapse item';
      itemToggle.setAttribute('aria-expanded', String(!collapsed));
    };
    applyItemCollapse(isItemCollapsed);
    itemToggle.addEventListener('click', () => {
      if (collapsedItems.has(item.id)) {
        collapsedItems.delete(item.id);
      } else {
        collapsedItems.add(item.id);
      }
      applyItemCollapse(collapsedItems.has(item.id));
    });

    sectionItemsEl.appendChild(card);
    });
    groupEl.appendChild(sectionItemsEl);
    container.appendChild(groupEl);
  });
}

function renderContentsView(agenda) {
  const hdr = document.getElementById('contents-header');
  hdr.textContent = '';
  if (agenda.body) {
    const b = document.createElement('div');
    b.style.cssText = 'font-weight:700; color:#1e40af; font-size:.95rem; margin-bottom:.2rem;';
    b.textContent = agenda.body;
    hdr.appendChild(b);
  }
  const t = document.createElement('div');
  t.style.cssText = 'font-size:1.15rem; font-weight:700;';
  t.textContent = agenda.title;
  hdr.appendChild(t);
  if (agenda.meeting_date) {
    const d = document.createElement('div');
    d.className = 'muted';
    d.textContent = `Meeting Date: ${agenda.meeting_date}`;
    hdr.appendChild(d);
  }

  const toc = document.getElementById('toc-list');
  const ordered = document.getElementById('ordered-items');
  toc.textContent = '';
  ordered.textContent = '';

  if (!agenda.items.length) {
    ordered.innerHTML = '<p class="muted">No items in this agenda yet.</p>';
    return;
  }

  for (const item of agenda.items) {
    const li = document.createElement('li');
    li.textContent = item.title;
    if (item.documents.length) {
      const sub = document.createElement('ul');
      sub.className = 'toc-docs';
      for (const d of item.documents) {
        const dli = document.createElement('li');
        dli.textContent = `${item.position}.${d.position} ${d.title} [${d.doc_type}]`;
        sub.appendChild(dli);
      }
      li.appendChild(sub);
    }
    toc.appendChild(li);

    const sec = document.createElement('div');
    sec.style.padding = '.85rem 0';
    sec.style.borderBottom = '1px solid #e4e7eb';
    const h = document.createElement('h3');
    h.style.margin = '0 0 .35rem';
    h.textContent = `${item.position}. ${item.title}`;
    sec.appendChild(h);
    if (item.description) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.style.margin = '0 0 .5rem';
      p.textContent = item.description;
      sec.appendChild(p);
    }
    if (item.documents.length) {
      const ul = document.createElement('ul');
      ul.className = 'doc-list';
      for (const d of item.documents) {
        const dli = document.createElement('li');
        const left = document.createElement('span');
        left.textContent = `${item.position}.${d.position} ${d.title} (${d.doc_type})`;
        const right = document.createElement('div');
        right.className = 'actions';
        const aPdf = document.createElement('a');
        aPdf.className = 'btn sm';
        aPdf.href = `/api/agendas/${agenda.id}/documents/${d.id}/pdf`;
        aPdf.target = '_blank';
        aPdf.textContent = 'View PDF';
        right.appendChild(aPdf);
        if (d.doc_type !== 'PDF') {
          const aOrig = document.createElement('a');
          aOrig.className = 'btn sm';
          aOrig.href = `/api/agendas/${agenda.id}/documents/${d.id}/download`;
          aOrig.target = '_blank';
          aOrig.textContent = `Original (${d.doc_type})`;
          right.appendChild(aOrig);
        }
        dli.append(left, right);
        ul.appendChild(dli);
      }
      sec.appendChild(ul);
    } else {
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = 'No supporting documents.';
      sec.appendChild(p);
    }
    ordered.appendChild(sec);
  }
}

function renderMinutesView(agenda) {
  document.getElementById('minutes-attendance').value = agenda.minutes_attendance || '';
  document.getElementById('minutes-notes').value = agenda.minutes_notes || '';
  document.getElementById('minutes-save-msg').textContent = '';

  const box = document.getElementById('minutes-items-container');
  box.textContent = '';
  if (!agenda.items.length) {
    const empty = document.createElement('div');
    empty.className = 'card muted';
    empty.textContent = 'No agenda items yet.';
    box.appendChild(empty);
    return;
  }

  let lastSec = null;
  for (const item of agenda.items) {
    const sec = (item.section || '').trim();
    if (sec && sec !== lastSec) {
      const sh = document.createElement('div');
      sh.style.cssText = 'font-size:.82rem; font-weight:700; letter-spacing:.04em; text-transform:uppercase; color:#1e3a8a; margin:1rem 0 .4rem; padding-left:.25rem; border-left:3px solid #1d4ed8;';
      sh.textContent = sec;
      box.appendChild(sh);
    }
    lastSec = sec;

    const card = document.createElement('div');
    card.className = 'card';
    const h = document.createElement('h3');
    h.style.cssText = 'margin:0 0 .65rem; font-size:1rem;';
    h.textContent = `${item.position}. ${item.title}`;
    card.appendChild(h);

    const form = document.createElement('form');
    const row1 = document.createElement('div');
    row1.className = 'row';
    row1.style.marginBottom = '.6rem';

    const mkField = (lblText, val, placeholder, listAttr) => {
      const f = document.createElement('div');
      f.className = 'field';
      f.style.minWidth = '150px';
      f.style.flex = '1';
      const lbl = document.createElement('label');
      lbl.textContent = lblText;
      const inp = document.createElement('input');
      inp.value = val || '';
      inp.placeholder = placeholder;
      if (listAttr) inp.setAttribute('list', listAttr);
      f.append(lbl, inp);
      return { f, inp };
    };

    const act = mkField('Action Taken', item.minutes_action, 'e.g. Approved', 'minutes-action-datalist');
    const mot = mkField('Motion By', item.minutes_motion_by, 'e.g. Councilmember Lee');
    const secBy = mkField('Seconded By', item.minutes_second_by, 'e.g. Councilmember Patel');
    const vote = mkField('Vote', item.minutes_vote, 'e.g. 5-0');
    row1.append(act.f, mot.f, secBy.f, vote.f);

    const notesField = document.createElement('div');
    notesField.className = 'field';
    notesField.style.marginBottom = '.6rem';
    const nLbl = document.createElement('label');
    nLbl.textContent = 'Minutes / Discussion Notes';
    const nTa = document.createElement('textarea');
    nTa.rows = 2;
    nTa.value = item.minutes_notes || '';
    nTa.placeholder = 'Summary of discussion, public comment, or conditions...';
    notesField.append(nLbl, nTa);

    const btnRow = document.createElement('div');
    btnRow.className = 'actions';
    const saveBtn = document.createElement('button');
    saveBtn.type = 'submit'; saveBtn.className = 'btn sm primary'; saveBtn.textContent = 'Save Item Minutes';
    const msg = document.createElement('span');
    msg.className = 'ok-msg'; msg.style.margin = '0';
    btnRow.append(saveBtn, msg);

    form.append(row1, notesField, btnRow);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      saveBtn.disabled = true;
      msg.textContent = '';
      try {
        const updated = await api(`/api/agendas/${agenda.id}/items/${item.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            minutes_action: act.inp.value.trim(),
            minutes_motion_by: mot.inp.value.trim(),
            minutes_second_by: secBy.inp.value.trim(),
            minutes_vote: vote.inp.value.trim(),
            minutes_notes: nTa.value.trim(),
          }),
        });
        state.currentAgenda = updated;
        msg.textContent = 'Saved.';
      } catch (err) {
        msg.className = 'error-msg';
        msg.textContent = err.message;
      } finally {
        saveBtn.disabled = false;
      }
    });

    card.appendChild(form);
    box.appendChild(card);
  }
}

document.getElementById('minutes-meta-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!state.currentAgenda) return;
  const msg = document.getElementById('minutes-save-msg');
  msg.className = 'ok-msg';
  msg.textContent = '';
  try {
    const updated = await api(`/api/agendas/${state.currentAgenda.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        minutes_attendance: document.getElementById('minutes-attendance').value.trim(),
        minutes_notes: document.getElementById('minutes-notes').value.trim(),
      }),
    });
    state.currentAgenda = updated;
    msg.textContent = 'Saved.';
  } catch (err) {
    msg.className = 'error-msg';
    msg.textContent = err.message;
  }
});

document.getElementById('add-item-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!state.currentAgenda) return;
  const errEl = document.getElementById('item-form-error');
  errEl.textContent = '';
  const titleEl = document.getElementById('item-title');
  const descEl = document.getElementById('item-desc');
  const secEl = document.getElementById('item-section');
  const presEl = document.getElementById('item-presenter');
  const motEl = document.getElementById('item-motion');
  const fiscEl = document.getElementById('item-fiscal');
  const revEl = document.getElementById('item-revision');
  try {
    const updated = await api(`/api/agendas/${state.currentAgenda.id}/items`, {
      method: 'POST',
      body: JSON.stringify({
        title: titleEl.value.trim(),
        description: descEl.value.trim(),
        section: secEl.value.trim(),
        presenter: presEl.value.trim(),
        recommended_motion: motEl.value.trim(),
        fiscal_impact: fiscEl.value.trim(),
        revision_status: revEl.value,
      }),
    });
    titleEl.value = ''; descEl.value = ''; secEl.value = '';
    presEl.value = ''; motEl.value = ''; fiscEl.value = ''; revEl.value = '';
    renderAgendaDetail(updated);
  } catch (err) { errEl.textContent = err.message; }
});
