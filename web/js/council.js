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
      if (s.status === 'accepted' && s.accepted_agenda_title) {
        tdDetails.textContent = s.accepted_agenda_date
          ? `Added to ${s.accepted_agenda_title} (${s.accepted_agenda_date})`
          : `Added to ${s.accepted_agenda_title}`;
      } else if (s.status === 'declined') {
        tdDetails.textContent = s.review_note || 'Declined by staff';
      } else {
        tdDetails.textContent = 'Awaiting staff review';
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
      await api('/api/agendas/council/submissions', {
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
