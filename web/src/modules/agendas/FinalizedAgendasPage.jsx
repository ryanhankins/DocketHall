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

import React, { useCallback, useEffect, useState } from 'react';
import { api, formatTime12h } from '../../core/api.js';
import { useToast } from '../../core/toast.jsx';

export default function FinalizedAgendasPage() {
  const [agendas, setAgendas] = useState([]);
  const showToast = useToast();

  const loadData = useCallback(async () => {
    const ags = await api('/api/agendas/council');
    setAgendas(Array.isArray(ags) ? ags : []);
  }, []);

  useEffect(() => {
    loadData().catch(e => showToast(e.message, 'error'));
  }, [loadData, showToast]);

  return (
    <section id="section-finalized-agendas">
      <h1>Finalized Agendas</h1>

      <div className="card">
        <p className="muted" style={{ marginTop: 0 }}>
          View finalized meeting agendas and packets.
        </p>
        <table>
          <thead>
            <tr><th>Meeting</th><th>Body</th><th>Date</th><th>Time</th><th>Items</th><th>Packet</th></tr>
          </thead>
          <tbody>
            {!agendas.length ? (
              <tr><td colSpan={6} className="muted">No finalized agendas yet.</td></tr>
            ) : agendas.map(a => (
              <tr key={a.id}>
                <td>
                  {a.title}
                  {a.amended_at && (
                    <> <span className="badge draft" title={`Amended ${new Date(a.amended_at).toLocaleString()}`}>Amended</span></>
                  )}
                </td>
                <td>{a.body || '—'}</td>
                <td>{a.meeting_date || '—'}</td>
                <td>{a.meeting_time ? formatTime12h(a.meeting_time) : '—'}</td>
                <td>{a.item_count}</td>
                <td>
                  <div className="actions">
                    <a className="btn sm" href={`/api/agendas/${a.id}/packet.pdf?summary=1`} target="_blank" rel="noreferrer">Summary</a>
                    <a className="btn sm primary" href={`/api/agendas/${a.id}/packet.pdf`} target="_blank" rel="noreferrer">Full Packet</a>
                    <a className="btn sm" href={`/api/agendas/${a.id}/packet.pdf?download=1`} target="_blank" rel="noreferrer">Download</a>
                    <a className="btn sm" href={`/api/agendas/${a.id}/minutes.pdf`} target="_blank" rel="noreferrer">
                      {a.minutes_status === 'approved' ? 'Minutes' : 'Minutes (Draft)'}
                    </a>
                    {a.media_url && (
                      <a className="btn sm" href={a.media_url} target="_blank" rel="noreferrer">
                        {a.media_type === 'audio' ? 'Listen Audio' : 'Watch Video'}
                      </a>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
