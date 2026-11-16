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

import { state, api } from './state.js';

export function renderMinutesView(agenda) {
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
