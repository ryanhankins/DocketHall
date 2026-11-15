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

import { state, api, formatSize, syncSectionsDatalist, makeInlineInput, showToast } from './state.js';
import { openAgenda } from './agenda-detail.js';

const MONTHS = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

let backlogItems = [];
let agendasCache = [];
let modalContext = null;

export function todayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function recurrenceLabel(item) {
  if (item.recurrence === 'every_agenda') return 'Every Agenda';
  if (item.recurrence === 'monthly') return 'Monthly';
  if (item.recurrence === 'quarterly') return 'Quarterly';
  if (item.recurrence === 'yearly') return 'Yearly';
  if (item.recurrence === 'first_agenda_month') {
    const m = MONTHS[item.recurrence_month] || `Month ${item.recurrence_month}`;
    return `1st Agenda in ${m}`;
  }
  return 'One-time';
}

export function updateBacklogNavBadge(items) {
  const badge = document.getElementById('backlog-nav-badge');
  if (!badge) return;
  const today = todayIso();
  const dueCount = (Array.isArray(items) ? items : []).filter(
    it => it.todo_status !== 'done' && ((it.target_date && it.target_date <= today) || it.recurrence === 'every_agenda'),
  ).length;
  badge.hidden = dueCount === 0;
  badge.textContent = dueCount > 0 ? String(dueCount) : '';
}

function populateBodySelects() {
  const bodies = state.configuredBodies || [];
  for (const [id, firstLabel] of [['backlog-target-body', 'Any Body'], ['backlog-filter-body', 'All Bodies']]) {
    const sel = document.getElementById(id);
    if (!sel) continue;
    const prev = sel.value;
    sel.textContent = '';
    const first = document.createElement('option');
    first.value = ''; first.textContent = firstLabel;
    sel.appendChild(first);
    for (const b of bodies) {
      const opt = document.createElement('option');
      opt.value = b; opt.textContent = b;
      sel.appendChild(opt);
    }
    if (prev && bodies.includes(prev)) sel.value = prev;
  }
}

function createAssignSelect(item) {
  const sel = document.createElement('select');
  sel.className = 'btn sm';
  sel.style.width = 'auto';
  sel.setAttribute('aria-label', `Assign ${item.title} to agenda`);

  const def = document.createElement('option');
  def.value = '';
  def.textContent = 'Add to Agenda…';
  sel.appendChild(def);

  if (agendasCache.length) {
    const modes = item.recurrence && item.recurrence !== 'none'
      ? [['copy', 'Add Occurrence to Agenda']]
      : [['move', 'Move to Agenda'], ['copy', 'Copy to Agenda']];
    for (const [mode, label] of modes) {
      const grp = document.createElement('optgroup');
      grp.label = label;
      for (const ag of agendasCache) {
        const opt = document.createElement('option');
        opt.value = `${mode}:${ag.id}`;
        const parts = [ag.title];
        if (ag.body) parts.push(ag.body);
        if (ag.meeting_date) parts.push(ag.meeting_date);
        opt.textContent = parts.join(' · ');
        grp.appendChild(opt);
      }
      sel.appendChild(grp);
    }
  } else {
    const noneOpt = document.createElement('option');
    noneOpt.disabled = true;
    noneOpt.textContent = '(No agendas available)';
    sel.appendChild(noneOpt);
  }

  sel.addEventListener('change', async () => {
    const raw = sel.value;
    if (!raw) return;
    const [mode, idStr] = raw.split(':');
    const targetId = Number(idStr);
    const targetLabel = sel.options[sel.selectedIndex].textContent;
    const isCopy = mode === 'copy';
    try {
      backlogItems = await api(`/api/agendas/backlog/${item.id}/assign`, {
        method: 'POST',
        body: JSON.stringify({ target_agenda_id: targetId, copy: isCopy }),
      });
      renderBacklog();
      updateBacklogNavBadge(backlogItems);
      showToast(
        `${isCopy ? 'Added' : 'Moved'} "${item.title}" to "${targetLabel}"`,
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

function renderBacklog() {
  const listEl = document.getElementById('backlog-list');
  const countEl = document.getElementById('backlog-count');
  if (!listEl) return;

  const statusFilter = document.getElementById('backlog-filter-status')?.value || 'active';
  const bodyFilter = document.getElementById('backlog-filter-body')?.value || '';
  const dueFilter = document.getElementById('backlog-filter-due')?.value || 'all';
  const search = (document.getElementById('backlog-filter-search')?.value || '').trim().toLowerCase();
  const today = todayIso();

  const filtered = backlogItems.filter((it) => {
    if (statusFilter === 'active' && it.todo_status === 'done') return false;
    if (statusFilter !== 'active' && statusFilter !== 'all' && it.todo_status !== statusFilter) return false;
    if (bodyFilter && it.target_body !== bodyFilter) return false;
    if (dueFilter === 'due' && (!it.target_date || it.target_date > today)) return false;
    if (dueFilter === 'recurring' && (!it.recurrence || it.recurrence === 'none')) return false;
    if (dueFilter === 'scheduled' && !it.target_date) return false;
    if (search) {
      const hay = `${it.title} ${it.description} ${it.section} ${it.presenter} ${it.assigned_to} ${it.target_body} ${it.source_agenda_title}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  if (countEl) countEl.textContent = String(filtered.length);
  listEl.textContent = '';

  if (!filtered.length) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = backlogItems.length
      ? 'No items match the current filters.'
      : 'No todos or unassigned items yet.';
    listEl.appendChild(p);
    return;
  }

  for (const item of filtered) {
    const card = document.createElement('div');
    card.className = 'item-card';
    if (item.todo_status === 'done') card.style.opacity = '0.72';

    const header = document.createElement('div');
    header.className = 'item-header';

    const left = document.createElement('div');
    left.style.flex = '1';

    const titleEl = document.createElement('div');
    titleEl.className = 'editable';
    titleEl.style.fontWeight = '600';
    titleEl.style.fontSize = '1rem';
    titleEl.textContent = item.title;
    titleEl.title = 'Click to edit title';
    titleEl.addEventListener('click', () => {
      makeInlineInput(titleEl, item.title, {
        required: true,
        onSave: async (val) => {
          backlogItems = await api(`/api/agendas/backlog/${item.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ title: val }),
          });
          renderBacklog();
        },
      });
    });

    const badges = document.createElement('div');
    badges.style.cssText = 'display:flex; flex-wrap:wrap; gap:.4rem; margin-top:.35rem; align-items:center;';

    if (item.target_date) {
      const isDue = item.todo_status !== 'done' && item.target_date <= today;
      const b = document.createElement('span');
      b.className = isDue ? 'badge disabled' : 'badge draft';
      b.textContent = isDue ? `Due ${item.target_date}` : `Due ${item.target_date}`;
      badges.appendChild(b);
    }
    if (item.recurrence && item.recurrence !== 'none') {
      const b = document.createElement('span');
      b.className = 'badge docx';
      b.textContent = recurrenceLabel(item);
      badges.appendChild(b);
    }
    if (item.target_body) {
      const b = document.createElement('span');
      b.className = 'badge text';
      b.textContent = item.target_body;
      badges.appendChild(b);
    }
    if (item.assigned_to) {
      const b = document.createElement('span');
      b.className = 'badge';
      b.style.background = '#e2e8f0';
      b.textContent = `Assigned: ${item.assigned_to}`;
      badges.appendChild(b);
    }
    if (item.section) {
      const b = document.createElement('span');
      b.className = 'badge';
      b.style.background = '#f1f5f9';
      b.textContent = item.section;
      badges.appendChild(b);
    }
    if (item.source_agenda_id) {
      const srcBtn = document.createElement('button');
      srcBtn.type = 'button';
      srcBtn.className = 'link-btn';
      srcBtn.style.fontSize = '.8rem';
      srcBtn.textContent = `From: ${item.source_agenda_title || `Agenda #${item.source_agenda_id}`}`;
      srcBtn.addEventListener('click', () => openAgenda(item.source_agenda_id));
      badges.appendChild(srcBtn);
    }

    left.append(titleEl, badges);

    const actions = document.createElement('div');
    actions.className = 'actions';

    const statusSel = document.createElement('select');
    statusSel.className = 'btn sm';
    statusSel.style.width = 'auto';
    statusSel.setAttribute('aria-label', `Status for ${item.title}`);
    const isRec = item.recurrence && item.recurrence !== 'none';
    for (const [val, lbl] of [['open', 'Open'], ['in_progress', 'In Progress'], ['done', isRec ? 'Done (Next Cycle)' : 'Done']]) {
      const opt = document.createElement('option');
      opt.value = val; opt.textContent = lbl; opt.selected = item.todo_status === val;
      statusSel.appendChild(opt);
    }
    statusSel.addEventListener('change', async () => {
      try {
        backlogItems = await api(`/api/agendas/backlog/${item.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ todo_status: statusSel.value }),
        });
        renderBacklog();
        updateBacklogNavBadge(backlogItems);
        if (statusSel.value === 'done' && isRec) {
          showToast(`Completed cycle for "${item.title}" — scheduled next occurrence`, 'ok');
        }
      } catch (err) {
        showToast(err.message, 'error');
        statusSel.value = item.todo_status;
      }
    });
    actions.appendChild(statusSel);
    actions.appendChild(createAssignSelect(item));

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn sm danger';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', async () => {
      if (!confirm(`Delete "${item.title}" and its documents?`)) return;
      delBtn.disabled = true;
      try {
        backlogItems = await api(`/api/agendas/backlog/${item.id}`, { method: 'DELETE' });
        renderBacklog();
        updateBacklogNavBadge(backlogItems);
        showToast(`Deleted "${item.title}"`, 'ok');
      } catch (err) {
        showToast(err.message, 'error');
        delBtn.disabled = false;
      }
    });
    actions.appendChild(delBtn);

    header.append(left, actions);
    card.appendChild(header);

    // Target body & due date controls
    const schedRow = document.createElement('div');
    schedRow.className = 'row';
    schedRow.style.cssText = 'margin-top:.65rem; gap:.6rem; align-items:center; font-size:.86rem;';

    const bodyLbl = document.createElement('label');
    bodyLbl.className = 'muted';
    bodyLbl.textContent = 'Target Body:';
    const bodySel = document.createElement('select');
    bodySel.className = 'btn sm';
    bodySel.style.width = 'auto';
    const anyOpt = document.createElement('option');
    anyOpt.value = ''; anyOpt.textContent = 'Any Body';
    bodySel.appendChild(anyOpt);
    const bodyOpts = [...new Set([...(state.configuredBodies || []), ...(item.target_body ? [item.target_body] : [])])];
    for (const b of bodyOpts) {
      const opt = document.createElement('option');
      opt.value = b; opt.textContent = b;
      bodySel.appendChild(opt);
    }
    bodySel.value = item.target_body || '';
    bodySel.addEventListener('change', async () => {
      try {
        backlogItems = await api(`/api/agendas/backlog/${item.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ target_body: bodySel.value }),
        });
        renderBacklog();
      } catch (err) {
        showToast(err.message, 'error');
        bodySel.value = item.target_body || '';
      }
    });

    const dateLbl = document.createElement('label');
    dateLbl.className = 'muted';
    dateLbl.textContent = 'Due / Pop-Up Date:';
    const dateInp = document.createElement('input');
    dateInp.type = 'date';
    dateInp.className = 'btn sm';
    dateInp.style.width = 'auto';
    dateInp.value = item.target_date || '';
    dateInp.addEventListener('change', async () => {
      try {
        const payload = dateInp.value
          ? { target_date: dateInp.value }
          : { clear_target_date: true };
        backlogItems = await api(`/api/agendas/backlog/${item.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        renderBacklog();
        updateBacklogNavBadge(backlogItems);
      } catch (err) {
        showToast(err.message, 'error');
        dateInp.value = item.target_date || '';
      }
    });

    schedRow.append(bodyLbl, bodySel, dateLbl, dateInp);
    card.appendChild(schedRow);

    const desc = document.createElement('p');
    desc.className = item.description ? 'muted editable' : 'editable editable-empty';
    desc.style.margin = '.5rem 0 .25rem';
    desc.textContent = item.description || 'Click to add description or follow-up notes…';
    desc.addEventListener('click', () => {
      makeInlineInput(desc, item.description || '', {
        multiline: true,
        onSave: async (val) => {
          backlogItems = await api(`/api/agendas/backlog/${item.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ description: val }),
          });
          renderBacklog();
        },
      });
    });
    card.appendChild(desc);

    // Supporting documents
    const docList = document.createElement('ul');
    docList.className = 'doc-list';
    for (const d of (item.documents || [])) {
      const li = document.createElement('li');
      const dLeft = document.createElement('div');
      const badge = document.createElement('span');
      badge.className = `badge ${d.doc_type.toLowerCase()}`;
      badge.textContent = d.doc_type;
      badge.style.marginRight = '.45rem';
      const titleSpan = document.createElement('span');
      titleSpan.textContent = `${d.title} `;
      const metaSpan = document.createElement('span');
      metaSpan.className = 'muted';
      metaSpan.textContent = `(${d.filename}, ${formatSize(d.size_bytes)})`;
      dLeft.append(badge, titleSpan, metaSpan);

      const dRight = document.createElement('div');
      dRight.className = 'actions';
      const pdfA = document.createElement('a');
      pdfA.className = 'btn sm'; pdfA.textContent = 'View PDF';
      pdfA.href = `/api/agendas/backlog/documents/${d.id}/pdf`;
      pdfA.target = '_blank'; pdfA.rel = 'noopener';

      const dlA = document.createElement('a');
      dlA.className = 'btn sm'; dlA.textContent = 'Download';
      dlA.href = `/api/agendas/backlog/documents/${d.id}/download`;
      dlA.target = '_blank'; dlA.rel = 'noopener';

      const rmDoc = document.createElement('button');
      rmDoc.type = 'button'; rmDoc.className = 'btn sm danger'; rmDoc.textContent = 'Remove';
      rmDoc.addEventListener('click', async () => {
        if (!confirm(`Remove document "${d.title}"?`)) return;
        try {
          backlogItems = await api(`/api/agendas/backlog/${item.id}/documents/${d.id}`, { method: 'DELETE' });
          renderBacklog();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
      dRight.append(pdfA, dlA, rmDoc);
      li.append(dLeft, dRight);
      docList.appendChild(li);
    }
    if (docList.children.length) card.appendChild(docList);

    const drop = document.createElement('div');
    drop.className = 'drop-zone';
    drop.textContent = 'Drop file here or click to attach a supporting document';
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.hidden = true;
    const uploadFile = async (f) => {
      if (!f) return;
      const fd = new FormData();
      fd.append('file', f);
      fd.append('title', f.name);
      try {
        drop.textContent = `Uploading ${f.name}...`;
        backlogItems = await api(`/api/agendas/backlog/${item.id}/documents`, {
          method: 'POST',
          body: fd,
        });
        renderBacklog();
        showToast(`Attached "${f.name}"`, 'ok');
      } catch (err) {
        showToast(err.message, 'error');
        drop.textContent = 'Drop file here or click to attach a supporting document';
      }
    };
    drop.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => uploadFile(fileInput.files[0]));
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('file-drag-over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('file-drag-over'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      drop.classList.remove('file-drag-over');
      if (e.dataTransfer.files[0]) uploadFile(e.dataTransfer.files[0]);
    });
    card.append(drop, fileInput);
    listEl.appendChild(card);
  }
}

export async function loadBacklog() {
  const [items, prefs, agendas] = await Promise.all([
    api('/api/agendas/backlog'),
    api('/api/agendas/preferences'),
    api('/api/agendas'),
  ]);
  backlogItems = Array.isArray(items) ? items : [];
  agendasCache = Array.isArray(agendas) ? agendas : [];
  state.configuredBodies = Array.isArray(prefs.bodies) ? [...prefs.bodies] : [];
  syncSectionsDatalist(prefs.sections);
  populateBodySelects();
  updateBacklogNavBadge(backlogItems);
  renderBacklog();
}

export function openCreateTodoModal({
  title = '',
  body = '',
  source_agenda_id = null,
  source_item_id = null,
  notes = '',
  presenter = '',
  section = '',
  onCreated = null,
}) {
  const dlg = document.getElementById('create-todo-dialog');
  if (!dlg) return;
  modalContext = { body, source_agenda_id, source_item_id, presenter, section, onCreated };
  document.getElementById('modal-todo-title').value = title;
  document.getElementById('modal-todo-assigned').value = '';
  document.getElementById('modal-todo-due').value = '';
  document.getElementById('modal-todo-rec').value = 'none';
  document.getElementById('modal-todo-month-wrap').hidden = true;
  document.getElementById('modal-todo-notes').value = notes;
  document.getElementById('modal-todo-err').textContent = '';
  dlg.showModal();
}

document.getElementById('backlog-recurrence')?.addEventListener('change', (e) => {
  document.getElementById('backlog-rec-month-wrap').hidden = e.target.value !== 'first_agenda_month';
});
document.getElementById('modal-todo-rec')?.addEventListener('change', (e) => {
  document.getElementById('modal-todo-month-wrap').hidden = e.target.value !== 'first_agenda_month';
});
document.getElementById('cancel-modal-todo')?.addEventListener('click', () => {
  document.getElementById('create-todo-dialog')?.close();
});

document.getElementById('modal-todo-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('modal-todo-err');
  errEl.textContent = '';
  const rec = document.getElementById('modal-todo-rec').value;
  const payload = {
    title: document.getElementById('modal-todo-title').value.trim(),
    assigned_to: document.getElementById('modal-todo-assigned').value.trim(),
    target_date: document.getElementById('modal-todo-due').value || null,
    recurrence: rec,
    recurrence_month: rec === 'first_agenda_month' ? Number(document.getElementById('modal-todo-month').value) : null,
    description: document.getElementById('modal-todo-notes').value.trim(),
    target_body: modalContext?.body || '',
    presenter: modalContext?.presenter || document.getElementById('modal-todo-assigned').value.trim(),
    section: modalContext?.section || '',
    source_agenda_id: modalContext?.source_agenda_id || null,
    source_item_id: modalContext?.source_item_id || null,
  };
  try {
    const updated = await api('/api/agendas/backlog', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    updateBacklogNavBadge(updated);
    document.getElementById('create-todo-dialog').close();
    showToast(`Added "${payload.title}" to Todos & Backlog`, 'ok');
    if (modalContext?.onCreated) modalContext.onCreated(updated);
  } catch (err) {
    errEl.textContent = err.message;
  }
});

document.getElementById('create-backlog-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('backlog-form-error');
  errEl.textContent = '';
  const rec = document.getElementById('backlog-recurrence').value;
  const assigned = document.getElementById('backlog-assigned').value.trim();
  const presenter = document.getElementById('backlog-presenter').value.trim() || assigned;
  const payload = {
    title: document.getElementById('backlog-title').value.trim(),
    assigned_to: assigned,
    target_body: document.getElementById('backlog-target-body').value.trim(),
    target_date: document.getElementById('backlog-target-date').value || null,
    recurrence: rec,
    recurrence_month: rec === 'first_agenda_month' ? Number(document.getElementById('backlog-rec-month').value) : null,
    section: document.getElementById('backlog-section').value.trim(),
    presenter,
    recommended_motion: document.getElementById('backlog-motion').value.trim(),
    fiscal_impact: document.getElementById('backlog-fiscal').value.trim(),
    description: document.getElementById('backlog-desc').value.trim(),
  };
  try {
    backlogItems = await api('/api/agendas/backlog', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    e.target.reset();
    document.getElementById('backlog-rec-month-wrap').hidden = true;
    renderBacklog();
    updateBacklogNavBadge(backlogItems);
    showToast('Added to Todos & Backlog', 'ok');
  } catch (err) {
    errEl.textContent = err.message;
  }
});

['backlog-filter-status', 'backlog-filter-body', 'backlog-filter-due'].forEach((id) => {
  document.getElementById(id)?.addEventListener('change', renderBacklog);
});
document.getElementById('backlog-filter-search')?.addEventListener('input', renderBacklog);
