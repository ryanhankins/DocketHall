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

import { state, api, showToast } from './state.js';
import { recurrenceLabel } from './backlog.js';

let onOpenAgenda = () => {};

export function initAgendaTransfer({ openAgenda }) {
  onOpenAgenda = openAgenda;
}

export function createAgendaTransferControl(otherAgendas, { className, placeholder, ariaLabel, subjectLabel, onTransfer }) {
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
        { label: 'Open', onClick: () => onOpenAgenda(targetId) },
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
              await onOpenAgenda(state.currentAgenda.id, 'edit', false);
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
              await onOpenAgenda(state.currentAgenda.id, 'edit', false);
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

export function renderBacklogPopup(agenda, matching) {
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
        await onOpenAgenda(agenda.id, 'edit', false);
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
          await onOpenAgenda(agenda.id, 'edit', false);
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
