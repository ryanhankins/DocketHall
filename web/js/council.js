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

import { api, categoryBadgeClass, showToast } from './state.js';

function formatTargetLabel(s) {
  if (s.target_agenda_title) {
    return s.target_agenda_date
      ? `${s.target_agenda_title} (${s.target_agenda_date})`
      : s.target_agenda_title;
  }
  const parts = [s.target_date, s.target_note].filter(Boolean);
  return parts.length ? `Some future agenda · ${parts.join(' · ')}` : 'Some future agenda';
}

function syncTargetDateVisibility() {
  const sel = document.getElementById('cs-target-agenda');
  const wrap = document.getElementById('cs-target-date-wrap');
  if (!sel || !wrap) return;
  wrap.hidden = sel.value !== '';
}

async function loadTargetAgendas() {
  const sel = document.getElementById('cs-target-agenda');
  if (!sel) return;
  const prev = sel.value;
  sel.textContent = '';
  try {
    const targets = await api('/api/agendas/council/targets');
    for (const a of targets) {
      const opt = document.createElement('option');
      opt.value = String(a.id);
      opt.textContent = a.meeting_date ? `${a.title} (${a.meeting_date})` : a.title;
      sel.appendChild(opt);
    }
  } catch {
    // Keep "Some future agenda" fallback if targets fail to load
  }
  const futureOpt = document.createElement('option');
  futureOpt.value = '';
  futureOpt.textContent = 'Some future agenda';
  sel.appendChild(futureOpt);
  if (prev && [...sel.options].some(o => o.value === prev)) {
    sel.value = prev;
  } else if (sel.options.length > 1) {
    sel.selectedIndex = 0;
  }
  syncTargetDateVisibility();
}

document.getElementById('cs-target-agenda')?.addEventListener('change', syncTargetDateVisibility);

function submissionBadge(status) {
  const span = document.createElement('span');
  if (status === 'accepted') {
    span.className = 'badge finalized';
    span.textContent = 'Accepted';
  } else if (status === 'declined') {
    span.className = 'badge';
    span.textContent = 'Declined';
  } else {
    span.className = 'badge draft';
    span.textContent = 'Pending';
  }
  return span;
}

async function uploadSubmissionFiles(subId, files) {
  for (const f of files) {
    const fd = new FormData();
    fd.append('file', f);
    const res = await fetch(`/api/agendas/council/submissions/${subId}/documents`, {
      method: 'POST',
      credentials: 'same-origin',
      body: fd,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || `Failed to upload ${f.name}`);
  }
}

async function loadMySubmissions() {
  const tbody = document.getElementById('council-submissions-tbody');
  tbody.textContent = '';
  try {
    const items = await api('/api/agendas/council/submissions');
    if (!items.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 4;
      td.className = 'muted';
      td.textContent = 'No submitted items yet.';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    for (const s of items) {
      const tr = document.createElement('tr');

      const tdTitle = document.createElement('td');
      tdTitle.textContent = s.title;

      const tdTarget = document.createElement('td');
      tdTarget.className = 'muted';
      tdTarget.textContent = formatTargetLabel(s);

      const tdStatus = document.createElement('td');
      tdStatus.appendChild(submissionBadge(s.status));

      const tdDetails = document.createElement('td');
      tdDetails.className = 'muted';
      const detailText = document.createElement('div');
      if (s.status === 'accepted' && s.accepted_agenda_title) {
        detailText.textContent = s.accepted_agenda_date
          ? `Added to ${s.accepted_agenda_title} (${s.accepted_agenda_date})`
          : `Added to ${s.accepted_agenda_title}`;
      } else if (s.status === 'declined') {
        detailText.textContent = s.review_note || 'Declined by staff';
      } else {
        detailText.textContent = 'Awaiting staff review';
      }
      tdDetails.appendChild(detailText);

      const docs = Array.isArray(s.documents) ? s.documents : [];
      if (docs.length) {
        const listEl = document.createElement('div');
        listEl.style.marginTop = '.35rem';
        listEl.style.fontSize = '.82rem';
        for (const d of docs) {
          const itemEl = document.createElement('div');
          const statusTxt = d.approval_status === 'pending'
            ? 'Pending staff approval'
            : (d.approval_status === 'declined' ? 'Declined' : 'Included');
          itemEl.textContent = `• ${d.filename} (${statusTxt})`;
          listEl.appendChild(itemEl);
        }
        tdDetails.appendChild(listEl);
      }

      if (s.status !== 'declined') {
        const addWrap = document.createElement('div');
        addWrap.style.marginTop = '.4rem';
        const fileInp = document.createElement('input');
        fileInp.type = 'file';
        fileInp.hidden = true;
        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'btn sm';
        addBtn.textContent = '+ Add Attachment (or drop on row)';
        addBtn.addEventListener('click', () => fileInp.click());

        const handleRowFiles = async (files) => {
          if (!files.length) return;
          addBtn.disabled = true;
          try {
            await uploadSubmissionFiles(s.id, files);
            showToast(
              s.status === 'accepted'
                ? `Uploaded ${files.length} attachment(s) (pending staff approval)`
                : `Added ${files.length} attachment(s) to submission`,
              'ok'
            );
            await loadMySubmissions();
          } catch (err) {
            showToast(err.message, 'error');
            addBtn.disabled = false;
          }
        };

        fileInp.addEventListener('change', () => handleRowFiles([...(fileInp.files || [])]));
        tr.addEventListener('dragover', (e) => {
          if (e.dataTransfer?.types?.includes('Files')) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            tr.classList.add('file-drag-over');
          }
        });
        tr.addEventListener('dragleave', (e) => {
          if (!tr.contains(e.relatedTarget)) tr.classList.remove('file-drag-over');
        });
        tr.addEventListener('drop', (e) => {
          if (e.dataTransfer?.files?.length) {
            e.preventDefault();
            tr.classList.remove('file-drag-over');
            handleRowFiles([...e.dataTransfer.files]);
          }
        });
        addWrap.append(fileInp, addBtn);
        if (s.status === 'pending') {
          const delBtn = document.createElement('button');
          delBtn.type = 'button';
          delBtn.className = 'btn sm danger';
          delBtn.textContent = 'Delete';
          delBtn.style.marginLeft = '.4rem';
          delBtn.addEventListener('click', async () => {
            if (!confirm(`Delete pending submission "${s.title}"?`)) return;
            delBtn.disabled = true;
            try {
              await api(`/api/agendas/council/submissions/${s.id}`, { method: 'DELETE' });
              showToast(`Deleted "${s.title}"`, 'ok');
              await loadMySubmissions();
            } catch (err) {
              showToast(err.message, 'error');
              delBtn.disabled = false;
            }
          });
          addWrap.appendChild(delBtn);
        }
        tdDetails.appendChild(addWrap);
      }

      tr.append(tdTitle, tdTarget, tdStatus, tdDetails);
      tbody.appendChild(tr);
    }
  } catch (err) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 4;
    td.className = 'error-msg';
    td.textContent = err.message;
    tr.appendChild(td);
    tbody.appendChild(tr);
  }
}

async function loadFinalizedCouncilAgendas() {
  const tbody = document.getElementById('council-agendas-tbody');
  tbody.textContent = '';
  try {
    const agendas = await api('/api/agendas/council');
    if (!agendas.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 5;
      td.className = 'muted';
      td.textContent = 'No finalized agendas.';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    for (const a of agendas) {
      const tr = document.createElement('tr');

      const tdTitle = document.createElement('td');
      tdTitle.textContent = a.title;

      const tdBody = document.createElement('td');
      tdBody.className = 'muted';
      tdBody.textContent = a.body || '—';

      const tdDate = document.createElement('td');
      tdDate.className = 'muted';
      tdDate.textContent = a.meeting_date || '—';

      const tdStatus = document.createElement('td');
      const badge = document.createElement('span');
      badge.className = categoryBadgeClass(a.status || 'Finalized Agendas');
      badge.textContent = a.status || 'Finalized Agendas';
      tdStatus.appendChild(badge);

      const tdActions = document.createElement('td');
      const sumLink = document.createElement('a');
      sumLink.className = 'btn sm primary';
      sumLink.textContent = 'Agenda-Only PDF';
      sumLink.href = `/api/agendas/${a.id}/packet.pdf?summary=1`;
      sumLink.target = '_blank';
      sumLink.rel = 'noopener';
      tdActions.appendChild(sumLink);

      tr.append(tdTitle, tdBody, tdDate, tdStatus, tdActions);
      tbody.appendChild(tr);
    }
  } catch (err) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 5;
    td.className = 'error-msg';
    td.textContent = err.message;
    tr.appendChild(td);
    tbody.appendChild(tr);
  }
}

let queuedSubmissionFiles = [];

function renderQueuedSubmissionFiles() {
  const listEl = document.getElementById('cs-file-list');
  if (!listEl) return;
  listEl.textContent = '';
  if (!queuedSubmissionFiles.length) return;
  queuedSubmissionFiles.forEach((f, idx) => {
    const chip = document.createElement('span');
    chip.className = 'badge draft';
    chip.style.marginRight = '.35rem';
    chip.style.marginBottom = '.25rem';
    chip.textContent = `${f.name} `;
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.textContent = '×';
    rm.style.cssText = 'border:none; background:none; cursor:pointer; font-weight:700; padding:0 .15rem;';
    rm.addEventListener('click', () => {
      queuedSubmissionFiles.splice(idx, 1);
      renderQueuedSubmissionFiles();
    });
    chip.appendChild(rm);
    listEl.appendChild(chip);
  });
}

const csDrop = document.getElementById('cs-drop-zone');
const csFilesInp = document.getElementById('cs-files');
if (csDrop && csFilesInp) {
  csDrop.addEventListener('click', () => csFilesInp.click());
  csDrop.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); csFilesInp.click(); }
  });
  csFilesInp.addEventListener('change', () => {
    queuedSubmissionFiles.push(...(csFilesInp.files || []));
    csFilesInp.value = '';
    renderQueuedSubmissionFiles();
  });
  csDrop.addEventListener('dragover', (e) => {
    if (e.dataTransfer?.types?.includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      csDrop.classList.add('file-drag-over');
    }
  });
  csDrop.addEventListener('dragleave', () => csDrop.classList.remove('file-drag-over'));
  csDrop.addEventListener('drop', (e) => {
    if (e.dataTransfer?.files?.length) {
      e.preventDefault();
      csDrop.classList.remove('file-drag-over');
      queuedSubmissionFiles.push(...e.dataTransfer.files);
      renderQueuedSubmissionFiles();
    }
  });
}

// Prevent accidental browser navigation when dropping files anywhere else in the window.
window.addEventListener('dragover', (e) => {
  if (e.dataTransfer?.types?.includes('Files')) e.preventDefault();
});
window.addEventListener('drop', (e) => {
  if (e.dataTransfer?.types?.includes('Files')) e.preventDefault();
});

const submitForm = document.getElementById('council-submit-form');
if (submitForm) {
  submitForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('cs-form-error');
    errEl.textContent = '';
    const titleEl = document.getElementById('cs-title');
    const agEl = document.getElementById('cs-target-agenda');
    const dateEl = document.getElementById('cs-target-date');
    const noteEl = document.getElementById('cs-target-note');
    const secEl = document.getElementById('cs-section');
    const motEl = document.getElementById('cs-motion');
    const fiscEl = document.getElementById('cs-fiscal');
    const descEl = document.getElementById('cs-description');
    try {
      const created = await api('/api/agendas/council/submissions', {
        method: 'POST',
        body: JSON.stringify({
          title: titleEl.value.trim(),
          target_agenda_id: agEl.value ? Number(agEl.value) : null,
          target_date: agEl.value ? null : (dateEl.value || null),
          target_note: noteEl.value.trim(),
          section: secEl.value.trim(),
          recommended_motion: motEl.value.trim(),
          fiscal_impact: fiscEl.value.trim(),
          description: descEl.value.trim(),
        }),
      });
      if (queuedSubmissionFiles.length) {
        await uploadSubmissionFiles(created.id, queuedSubmissionFiles);
      }
      queuedSubmissionFiles = [];
      renderQueuedSubmissionFiles();
      submitForm.reset();
      syncTargetDateVisibility();
      showToast('Submitted item (pending staff review)', 'ok');
      await loadMySubmissions();
    } catch (err) {
      errEl.textContent = err.message;
    }
  });
}

/** Load submitted items, target dropdown, and finalized council agendas for council members. */
export async function loadCouncilAgendas() {
  await Promise.all([loadTargetAgendas(), loadMySubmissions(), loadFinalizedCouncilAgendas()]);
}
