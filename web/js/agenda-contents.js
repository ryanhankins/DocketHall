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

export function renderContentsView(agenda) {
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
