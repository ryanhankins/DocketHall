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

import { state, api, formatSize, makeInlineInput, showToast } from './state.js';
import { todayIso, openCreateTodoModal } from './backlog.js';
import { createAgendaTransferControl } from './agenda-transfer.js';

let onAgendaUpdated = () => {};

export function initAgendaItems({ renderAgendaDetail }) {
  onAgendaUpdated = renderAgendaDetail;
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

export function renderEditItems(agenda) {
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
            onAgendaUpdated(await api(`/api/agendas/${agenda.id}/sections/move`, {
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
        onAgendaUpdated(await api(`/api/agendas/${agenda.id}/items/${draggedItemId}`, {
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
        onAgendaUpdated(await api(`/api/agendas/${agenda.id}/items/reorder`, {
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
      onSave: async (next) => onAgendaUpdated(await api(`/api/agendas/${agenda.id}/items/${item.id}`, {
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
      onAgendaUpdated(await api(`/api/agendas/${agenda.id}/items/${item.id}`, {
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
        onAgendaUpdated(await api(
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
      onAgendaUpdated(await api(`/api/agendas/${agenda.id}/items/${draggedItemId}`, {
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
      onSave: async (next) => onAgendaUpdated(await api(`/api/agendas/${agenda.id}/items/${item.id}`, {
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
        onSave: async (next) => onAgendaUpdated(await api(`/api/agendas/${agenda.id}/items/${item.id}`, {
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
          onAgendaUpdated(await api(`/api/agendas/${agenda.id}/items/${item.id}/move`, {
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
        onAgendaUpdated(await api(`/api/agendas/${agenda.id}/items/${item.id}/move-to-backlog`, {
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
      onAgendaUpdated(await api(`/api/agendas/${agenda.id}/items/${item.id}`, { method: 'DELETE' }));
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
          onAgendaUpdated(await api(
            `/api/agendas/${agenda.id}/items/${srcItemId}/documents/${docId}`,
            { method: 'PATCH', body: JSON.stringify({ position: targetPos }) }
          ));
        } else {
          onAgendaUpdated(await api(
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
        onSave: async (next) => onAgendaUpdated(await api(
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
              onAgendaUpdated(await api(
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
        onAgendaUpdated(await api(
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
      if (latest) onAgendaUpdated(latest);
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
        onAgendaUpdated(updated);
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
        onAgendaUpdated(updated);
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
    onAgendaUpdated(updated);
  } catch (err) { errEl.textContent = err.message; }
});
