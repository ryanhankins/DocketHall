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
import { api } from '../../core/api.js';
import { useToast } from '../../core/toast.jsx';

const PROGRAM_TYPES = [
  'Rental Housing',
  'Short-Term Rental (STR)',
  'Commercial Fire Safety',
  'Backflow / FOG',
  'Other',
];

const EMPTY_FORM = {
  program_type: 'Rental Housing',
  property_address: '',
  parcel_id: '',
  unit_count: 1,
  owner_name: '',
  local_agent_name: '',
  local_agent_phone: '',
  local_agent_email: '',
  cycle_months: 12,
  last_inspected_date: '',
  next_inspection_date: '',
  last_result: 'pending',
  inspector: '',
  certificate_number: '',
  status: 'active',
  notes: '',
};

export default function ComplianceProgramsPage() {
  const [items, setItems] = useState([]);
  const [q, setQ] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [editId, setEditId] = useState(null);
  const [busy, setBusy] = useState(false);
  const showToast = useToast();

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (typeFilter) params.set('program_type', typeFilter);
    if (statusFilter) params.set('status', statusFilter);
    const qs = params.toString() ? `?${params.toString()}` : '';
    const rows = await api(`/api/permits/compliance-programs${qs}`);
    setItems(Array.isArray(rows) ? rows : []);
  }, [q, typeFilter, statusFilter]);

  useEffect(() => {
    load().catch((e) => showToast(e.message, 'error'));
  }, [load, showToast]);

  const save = async (e) => {
    e.preventDefault();
    if (!form.property_address.trim()) return;
    setBusy(true);
    try {
      const payload = {
        ...form,
        property_address: form.property_address.trim(),
        parcel_id: form.parcel_id.trim(),
        unit_count: Math.max(1, Number(form.unit_count) || 1),
        owner_name: form.owner_name.trim(),
        local_agent_name: form.local_agent_name.trim(),
        local_agent_phone: form.local_agent_phone.trim(),
        local_agent_email: form.local_agent_email.trim(),
        cycle_months: Math.max(1, Number(form.cycle_months) || 12),
        inspector: form.inspector.trim(),
        certificate_number: form.certificate_number.trim(),
        notes: form.notes.trim(),
      };
      if (editId) {
        await api(`/api/permits/compliance-programs/${editId}`, { method: 'PATCH', body: JSON.stringify(payload) });
        showToast('Compliance program updated', 'ok');
      } else {
        await api('/api/permits/compliance-programs', { method: 'POST', body: JSON.stringify(payload) });
        showToast('Compliance program added', 'ok');
      }
      setForm({ ...EMPTY_FORM });
      setEditId(null);
      await load();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const overdueCount = items.filter((i) => i.due_status === 'overdue').length;
  const dueSoonCount = items.filter((i) => i.due_status === 'due_soon').length;

  return (
    <section id="section-compliance-programs">
      <div className="between" style={{ marginBottom: '1rem', flexWrap: 'wrap', gap: '.5rem' }}>
        <div>
          <h1 style={{ margin: 0 }}>Rental &amp; Fire Recurring Compliance Programs</h1>
          <p className="muted" style={{ margin: '.2rem 0 0' }}>
            Track recurring Rental Housing, Short-Term Rental (STR), Commercial Fire, and Backflow/FOG inspection cycles with automatic next-due dates and Compliance Certificates.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
          <span className="badge active">Total: {items.length}</span>
          {dueSoonCount > 0 && <span className="badge draft">Due &le; 30d: {dueSoonCount}</span>}
          {overdueCount > 0 && <span className="badge disabled">Overdue: {overdueCount}</span>}
        </div>
      </div>

      <div className="card">
        <h2>{editId ? 'Edit Compliance Program' : 'Register Property for Recurring Inspection'}</h2>
        <form onSubmit={save}>
          <div className="row" style={{ marginBottom: '.75rem' }}>
            <div className="field" style={{ flex: 1, minWidth: 180 }}>
              <label htmlFor="cp-type">Program Type</label>
              <select id="cp-type" value={form.program_type} onChange={(e) => setForm((f) => ({ ...f, program_type: e.target.value }))}>
                {PROGRAM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="field" style={{ flex: 2, minWidth: 210 }}>
              <label htmlFor="cp-addr">Property Address *</label>
              <input id="cp-addr" required placeholder="e.g. 312 Cedar Lane" value={form.property_address} onChange={(e) => setForm((f) => ({ ...f, property_address: e.target.value }))} />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 120 }}>
              <label htmlFor="cp-parcel">Parcel ID</label>
              <input id="cp-parcel" value={form.parcel_id} onChange={(e) => setForm((f) => ({ ...f, parcel_id: e.target.value }))} />
            </div>
            <div className="field" style={{ width: 85 }}>
              <label htmlFor="cp-units">Units</label>
              <input id="cp-units" type="number" min="1" value={form.unit_count} onChange={(e) => setForm((f) => ({ ...f, unit_count: e.target.value }))} />
            </div>
          </div>

          <div className="row" style={{ marginBottom: '.75rem' }}>
            <div className="field" style={{ flex: 1, minWidth: 160 }}>
              <label htmlFor="cp-owner">Property Owner</label>
              <input id="cp-owner" value={form.owner_name} onChange={(e) => setForm((f) => ({ ...f, owner_name: e.target.value }))} />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 160 }}>
              <label htmlFor="cp-agent">Local Agent / Manager</label>
              <input id="cp-agent" value={form.local_agent_name} onChange={(e) => setForm((f) => ({ ...f, local_agent_name: e.target.value }))} />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 140 }}>
              <label htmlFor="cp-phone">Agent Phone</label>
              <input id="cp-phone" value={form.local_agent_phone} onChange={(e) => setForm((f) => ({ ...f, local_agent_phone: e.target.value }))} />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 170 }}>
              <label htmlFor="cp-email">Agent Email</label>
              <input id="cp-email" type="email" value={form.local_agent_email} onChange={(e) => setForm((f) => ({ ...f, local_agent_email: e.target.value }))} />
            </div>
          </div>

          <div className="row" style={{ marginBottom: '.75rem' }}>
            <div className="field" style={{ width: 120 }}>
              <label htmlFor="cp-cycle">Cycle (Months)</label>
              <select id="cp-cycle" value={form.cycle_months} onChange={(e) => setForm((f) => ({ ...f, cycle_months: Number(e.target.value) }))}>
                <option value={6}>6 Months</option>
                <option value={12}>12 Months</option>
                <option value={24}>24 Months</option>
                <option value={36}>36 Months</option>
              </select>
            </div>
            <div className="field" style={{ flex: 1, minWidth: 145 }}>
              <label htmlFor="cp-last">Last Inspected</label>
              <input id="cp-last" type="date" value={form.last_inspected_date} onChange={(e) => setForm((f) => ({ ...f, last_inspected_date: e.target.value }))} />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 145 }}>
              <label htmlFor="cp-next">Next Inspection Due</label>
              <input id="cp-next" type="date" value={form.next_inspection_date} onChange={(e) => setForm((f) => ({ ...f, next_inspection_date: e.target.value }))} />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 130 }}>
              <label htmlFor="cp-status">Program Status</label>
              <select id="cp-status" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
                <option value="active">Active</option>
                <option value="non_compliant">Non-Compliant</option>
                <option value="suspended">Suspended</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>

          <div className="row" style={{ marginBottom: '.75rem' }}>
            <div className="field" style={{ flex: 1, minWidth: 150 }}>
              <label htmlFor="cp-insp">Assigned Inspector</label>
              <input id="cp-insp" value={form.inspector} onChange={(e) => setForm((f) => ({ ...f, inspector: e.target.value }))} />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 140 }}>
              <label htmlFor="cp-cert">Certificate #</label>
              <input id="cp-cert" placeholder="Auto on Pass" value={form.certificate_number} onChange={(e) => setForm((f) => ({ ...f, certificate_number: e.target.value }))} />
            </div>
            <div className="field" style={{ flex: 2, minWidth: 200 }}>
              <label htmlFor="cp-notes">Notes</label>
              <input id="cp-notes" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>

          <div className="actions">
            <button type="submit" className="btn primary" disabled={busy}>
              {busy ? 'Saving…' : (editId ? 'Save Program' : 'Add Program')}
            </button>
            {editId && (
              <button type="button" className="btn" onClick={() => { setEditId(null); setForm({ ...EMPTY_FORM }); }}>
                Cancel
              </button>
            )}
          </div>
        </form>
      </div>

      <div className="card">
        <div className="between" style={{ marginBottom: '.75rem', flexWrap: 'wrap', gap: '.5rem' }}>
          <h2 style={{ margin: 0 }}>Registered Compliance Properties ({items.length})</h2>
          <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
            <input placeholder="Search address, owner, agent, cert #…" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 210 }} />
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="">All Program Types</option>
              {PROGRAM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All Statuses</option>
              <option value="active">Active</option>
              <option value="non_compliant">Non-Compliant</option>
              <option value="suspended">Suspended</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
        </div>

        {items.length === 0 ? (
          <p className="muted">No compliance programs match your filter.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Property &amp; Program</th>
                <th>Owner / Local Agent</th>
                <th>Schedule &amp; Due</th>
                <th>Last Result / Cert</th>
                <th style={{ width: 250 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id}>
                  <td>
                    <div><strong>{p.property_address}</strong> ({p.unit_count} unit{p.unit_count === 1 ? '' : 's'})</div>
                    <span className="badge draft">{p.program_type}</span>
                    {p.parcel_id && <span className="muted" style={{ fontSize: '.8rem', marginLeft: '.4rem' }}>Parcel {p.parcel_id}</span>}
                  </td>
                  <td style={{ fontSize: '.83rem' }}>
                    <div>{p.owner_name || '—'}</div>
                    {p.local_agent_name && <div className="muted">Agent: {p.local_agent_name} {p.local_agent_phone}</div>}
                  </td>
                  <td style={{ fontSize: '.83rem' }}>
                    <div>Next Due: <strong>{p.next_inspection_date || '—'}</strong> ({p.cycle_months}m)</div>
                    <div>
                      {p.due_status === 'overdue' && <span className="badge disabled">Overdue ({Math.abs(p.days_until_due)}d)</span>}
                      {p.due_status === 'due_soon' && <span className="badge draft">Due in {p.days_until_due}d</span>}
                      {p.due_status === 'ok' && <span className="badge active">On Schedule</span>}
                      {p.due_status !== 'overdue' && p.due_status !== 'due_soon' && p.due_status !== 'ok' && (
                        <span className="badge disabled">{p.due_status.replace('_', ' ')}</span>
                      )}
                    </div>
                  </td>
                  <td style={{ fontSize: '.83rem' }}>
                    <div>{p.last_result} {p.last_inspected_date ? `(${p.last_inspected_date})` : ''}</div>
                    {p.certificate_number && (
                      <a href={`/api/permits/compliance-programs/${p.id}/certificate`} target="_blank" rel="noreferrer">
                        Cert {p.certificate_number} PDF
                      </a>
                    )}
                  </td>
                  <td>
                    <div className="actions">
                      <button
                        type="button"
                        className="btn sm primary"
                        onClick={async () => {
                          await api(`/api/permits/compliance-programs/${p.id}/record-inspection`, {
                            method: 'POST',
                            body: JSON.stringify({ result: 'passed' }),
                          });
                          showToast('Inspection passed & next due date advanced', 'ok');
                          await load();
                        }}
                      >
                        Pass Cycle
                      </button>
                      <button
                        type="button"
                        className="btn sm"
                        onClick={() => {
                          setEditId(p.id);
                          setForm({ ...p });
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn sm danger"
                        onClick={async () => {
                          if (!window.confirm(`Delete compliance program for "${p.property_address}"?`)) return;
                          await api(`/api/permits/compliance-programs/${p.id}`, { method: 'DELETE' });
                          await load();
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
