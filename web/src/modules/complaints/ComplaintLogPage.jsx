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

import { useCallback, useEffect, useState } from 'react';
import { api, formatDate, formatSize } from '../../core/api.js';
import { useToast } from '../../core/toast.jsx';
import { COMPLAINT_STATUSES, StatusBadge } from './constants.jsx';

export default function ComplaintLogPage() {
  const showToast = useToast();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selected, setSelected] = useState(null);

  const loadLog = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (statusFilter) params.set('status', statusFilter);
      const qs = params.toString();
      const data = await api(`/api/complaints/public-log${qs ? `?${qs}` : ''}`);
      const list = data.items || [];
      setItems(list);
      setSelected((prev) => (prev ? list.find((r) => r.id === prev.id) || null : null));
    } catch (err) {
      showToast(err.message || 'Failed to load complaint log', 'error');
    } finally {
      setLoading(false);
    }
  }, [q, statusFilter, showToast]);

  useEffect(() => {
    loadLog();
  }, [loadLog]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h2 style={{ margin: 0 }}>Complaint Log Book</h2>
        <p className="muted" style={{ margin: '4px 0 0' }}>
          Official log of written, anonymous, and investigated oral complaints and their final resolutions.
          Complainant names and confidential data are excluded per applicable public-records law.
        </p>
      </div>

      <div className="card" style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        <input
          className="input"
          style={{ flex: '1 1 240px' }}
          placeholder="Search complaint #, property, ordinance, conduct, resolution..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className="input"
          style={{ width: 'auto' }}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All Statuses</option>
          {COMPLAINT_STATUSES.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: selected ? '1.3fr 1fr' : '1fr',
          gap: 16,
          alignItems: 'start',
        }}
      >
        <div className="card" style={{ overflowX: 'auto' }}>
          {loading ? (
            <p className="muted">Loading complaint log...</p>
          ) : items.length === 0 ? (
            <p className="muted">No complaints in the log book match the current filters.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>
                  <th style={{ padding: '8px 6px' }}>Complaint #</th>
                  <th style={{ padding: '8px 6px' }}>Received</th>
                  <th style={{ padding: '8px 6px' }}>Channel</th>
                  <th style={{ padding: '8px 6px' }}>Property / Subject</th>
                  <th style={{ padding: '8px 6px' }}>Ordinance</th>
                  <th style={{ padding: '8px 6px' }}>Status</th>
                  <th style={{ padding: '8px 6px' }}>Resolution</th>
                </tr>
              </thead>
              <tbody>
                {items.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => setSelected(c)}
                    style={{
                      cursor: 'pointer',
                      borderBottom: '1px solid #f3f4f6',
                      background: selected?.id === c.id ? '#eff6ff' : 'transparent',
                    }}
                  >
                    <td style={{ padding: '8px 6px', whiteSpace: 'nowrap', fontWeight: 500 }}>
                      <button type="button" className="link-btn" onClick={(e) => { e.stopPropagation(); setSelected(c); }}>
                        {c.complaint_number}
                      </button>
                    </td>
                    <td style={{ padding: '8px 6px', whiteSpace: 'nowrap' }}>
                      {formatDate(c.created_at)}
                    </td>
                    <td style={{ padding: '8px 6px', textTransform: 'capitalize' }}>
                      {c.intake_channel}
                    </td>
                    <td style={{ padding: '8px 6px' }}>
                      {c.subject_property_address || c.subject_person_name || '—'}
                    </td>
                    <td style={{ padding: '8px 6px' }}>{c.ordinance_section || '—'}</td>
                    <td style={{ padding: '8px 6px' }}>
                      <StatusBadge status={c.status} />
                    </td>
                    <td style={{ padding: '8px 6px', maxWidth: 240 }}>
                      {c.final_resolution ? (
                        <span>{c.final_resolution.slice(0, 80)}{c.final_resolution.length > 80 ? '…' : ''}</span>
                      ) : (
                        <span className="muted">Pending</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {selected && (
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0 }}>{selected.complaint_number}</h3>
              <button type="button" className="btn sm" onClick={() => setSelected(null)}>
                Close
              </button>
            </div>
            <div><StatusBadge status={selected.status} /></div>

            <div style={{ display: 'grid', gap: 6, fontSize: 14 }}>
              <div><strong>Property / Location:</strong> {selected.subject_property_address || '—'}</div>
              <div><strong>Person(s) Involved:</strong> {selected.subject_person_name || '—'}</div>
              <div><strong>Ordinance:</strong> {selected.ordinance_section || '—'}</div>
              <div><strong>Date Observed:</strong> {selected.date_observed || '—'}</div>
              <div><strong>Assisting Agency:</strong> {selected.assisting_agency || 'City Staff'}</div>
            </div>

            <div>
              <div className="muted" style={{ fontSize: 12 }}>Conduct Complained About</div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{selected.conduct_description}</div>
            </div>

            {selected.investigation_report && (
              <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 10 }}>
                <div className="muted" style={{ fontSize: 12 }}>
                  Written Investigation Report
                </div>
                <div style={{ whiteSpace: 'pre-wrap' }}>{selected.investigation_report}</div>
              </div>
            )}

            {selected.nov_issued_at && (
              <div
                style={{
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: 6,
                  padding: 10,
                  fontSize: 13,
                }}
              >
                <strong>Notice of Violation</strong>
                <div>Issued: {formatDate(selected.nov_issued_at)} by {selected.nov_issuing_official}</div>
                <div>Compliance Deadline: {selected.nov_compliance_deadline}</div>
                {selected.nov_required_action && (
                  <div style={{ marginTop: 4 }}>{selected.nov_required_action}</div>
                )}
              </div>
            )}

            {selected.final_resolution && (
              <div
                style={{
                  background: '#f0fdf4',
                  border: '1px solid #bbf7d0',
                  borderRadius: 6,
                  padding: 10,
                  fontSize: 13,
                }}
              >
                <strong>Final Resolution</strong>
                <div style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{selected.final_resolution}</div>
              </div>
            )}

            {(selected.documents || []).length > 0 && (
              <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 10 }}>
                <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
                  Public Documents
                </div>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 4 }}>
                  {selected.documents.map((d) => (
                    <li key={d.id}>
                      <a
                        href={`/api/complaints/documents/${d.id}/download`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {d.filename}
                      </a>{' '}
                      <span className="muted" style={{ fontSize: 12 }}>
                        ({d.doc_category}, {formatSize(d.size_bytes)})
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
