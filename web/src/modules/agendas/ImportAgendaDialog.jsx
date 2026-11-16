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

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../core/api.js';
import { useToast } from '../../core/toast.jsx';

export default function ImportAgendaDialog({ open, currentAgendaId, agendasList = [], onClose, onImported }) {
  const dlgRef = useRef(null);
  const [others, setOthers] = useState([]);
  const [sourceId, setSourceId] = useState('');
  const [srcData, setSrcData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const showToast = useToast();

  const loadSource = useCallback(async (id) => {
    if (!id) { setSrcData(null); return; }
    setLoading(true);
    setErr('');
    try {
      const data = await api(`/api/agendas/${id}`);
      setSrcData(data);
    } catch (error) {
      setErr(error.message);
      setSrcData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const dlg = dlgRef.current;
    if (!dlg) return;
    if (open) {
      if (!dlg.open) dlg.showModal();
      api('/api/agendas')
        .catch(() => agendasList)
        .then((all) => {
          const list = (Array.isArray(all) ? all : []).filter(a => a.id !== currentAgendaId);
          setOthers(list);
          if (list.length) {
            const firstId = String(list[0].id);
            setSourceId(firstId);
            loadSource(list[0].id);
          } else {
            setSourceId('');
            setSrcData(null);
          }
        });
    } else if (dlg.open) {
      dlg.close();
    }
  }, [open, currentAgendaId, agendasList, loadSource]);

  const sections = [];
  if (srcData?.items?.length) {
    const map = new Map();
    for (const it of srcData.items) {
      const s = it.section || '';
      if (!map.has(s)) map.set(s, []);
      map.get(s).push(it);
    }
    for (const [secName, secItems] of map.entries()) {
      sections.push({ secName, secItems });
    }
  }

  return (
    <dialog ref={dlgRef} style={{ maxWidth: '640px' }} onCancel={(e) => { e.preventDefault(); onClose?.(); }}>
      <h2>Import Items from Another Agenda</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Move or copy individual items or whole sections from another agenda into this one.
      </p>
      <div className="field">
        <label htmlFor="import-source-agenda">Source Agenda</label>
        <select
          id="import-source-agenda"
          value={sourceId}
          onChange={(e) => {
            setSourceId(e.target.value);
            loadSource(Number(e.target.value));
          }}
        >
          {!others.length ? (
            <option value="">(No other agendas available)</option>
          ) : others.map(a => (
            <option key={a.id} value={a.id}>{a.meeting_date ? `${a.title} (${a.meeting_date})` : a.title}</option>
          ))}
        </select>
      </div>

      <div style={{ maxHeight: '340px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '.65rem', marginBottom: '.5rem' }}>
        {!others.length && <p className="muted">Create another agenda first to import items from it.</p>}
        {loading && <p className="muted">Loading…</p>}
        {err && <p className="error-msg">{err}</p>}
        {!loading && srcData && !(srcData.items || []).length && <p className="muted">This agenda has no items.</p>}
        {!loading && sections.map(({ secName, secItems }) => (
          <div key={secName || '__none__'} style={{ border: '1px solid #d9e2ec', borderRadius: '8px', padding: '.65rem .8rem', background: '#f8fafc' }}>
            {secName && (
              <div className="between" style={{ marginBottom: '.45rem' }}>
                <strong>Section: {secName} ({secItems.length})</strong>
                <div className="actions">
                  {[false, true].map(copy => (
                    <button
                      key={String(copy)}
                      type="button"
                      className={copy ? 'btn sm' : 'btn sm primary'}
                      onClick={async () => {
                        try {
                          await api(`/api/agendas/${srcData.id}/sections/move`, {
                            method: 'POST',
                            body: JSON.stringify({ section: secName, target_agenda_id: currentAgendaId, copy }),
                          });
                          showToast(`${copy ? 'Copied' : 'Moved'} section "${secName}" here`, 'ok');
                          await onImported?.();
                          await loadSource(srcData.id);
                        } catch (error) {
                          showToast(error.message, 'error');
                        }
                      }}
                    >
                      {copy ? 'Copy Section Here' : 'Move Section Here'}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {secItems.map(it => (
              <div key={it.id} className="between" style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '.4rem .6rem', marginTop: '.35rem', gap: '.5rem' }}>
                <span>{it.position}. {it.title}</span>
                <div className="actions">
                  {[false, true].map(copy => (
                    <button
                      key={String(copy)}
                      type="button"
                      className="btn sm"
                      onClick={async () => {
                        try {
                          await api(`/api/agendas/${srcData.id}/items/${it.id}/move`, {
                            method: 'POST',
                            body: JSON.stringify({ target_agenda_id: currentAgendaId, copy }),
                          });
                          showToast(`${copy ? 'Copied' : 'Moved'} "${it.title}" here`, 'ok');
                          await onImported?.();
                          await loadSource(srcData.id);
                        } catch (error) {
                          showToast(error.message, 'error');
                        }
                      }}
                    >
                      {copy ? 'Copy Here' : 'Move Here'}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="dialog-actions">
        <button type="button" className="btn" onClick={onClose}>Close</button>
      </div>
    </dialog>
  );
}
