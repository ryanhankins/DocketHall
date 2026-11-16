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

import React from 'react';

export default function AgendaContentsTab({ agenda }) {
  const items = agenda?.items || [];

  return (
    <div id="agenda-contents-pane">
      <div className="card">
        <div style={{ marginBottom: '1rem' }}>
          {agenda.body && (
            <div style={{ fontWeight: 700, color: '#1e40af', fontSize: '.95rem', marginBottom: '.2rem' }}>
              {agenda.body}
            </div>
          )}
          <div style={{ fontSize: '1.15rem', fontWeight: 700 }}>{agenda.title}</div>
          {agenda.meeting_date && <div className="muted">Meeting Date: {agenda.meeting_date}</div>}
        </div>
        <h2>Table of Contents</h2>
        <ol className="toc-list">
          {items.map(item => (
            <li key={item.id}>
              {item.title}
              {item.documents?.length > 0 && (
                <ul className="toc-docs">
                  {item.documents.map(d => (
                    <li key={d.id}>{item.position}.{d.position} {d.title} [{d.doc_type}]</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      </div>

      <div className="card">
        <h2>Items &amp; Supporting Documents</h2>
        {!items.length ? (
          <p className="muted">No items in this agenda yet.</p>
        ) : items.map(item => (
          <div key={item.id} style={{ padding: '.85rem 0', borderBottom: '1px solid #e4e7eb' }}>
            <h3 style={{ margin: '0 0 .35rem' }}>{item.position}. {item.title}</h3>
            {item.description && <p className="muted" style={{ margin: '0 0 .5rem' }}>{item.description}</p>}
            {item.documents?.length > 0 ? (
              <ul className="doc-list">
                {item.documents.map(d => (
                  <li key={d.id}>
                    <span>{item.position}.{d.position} {d.title} ({d.doc_type})</span>
                    <div className="actions">
                      <a className="btn sm" href={`/api/agendas/${agenda.id}/documents/${d.id}/pdf`} target="_blank" rel="noreferrer">View PDF</a>
                      {d.doc_type !== 'PDF' && (
                        <a className="btn sm" href={`/api/agendas/${agenda.id}/documents/${d.id}/download`} target="_blank" rel="noreferrer">
                          Original ({d.doc_type})
                        </a>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">No supporting documents.</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
