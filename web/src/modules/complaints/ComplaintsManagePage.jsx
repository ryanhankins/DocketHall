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
import { api, formatDate, formatSize, hasPermission } from '../../core/api.js';
import { useToast } from '../../core/toast.jsx';
import {
  ASSISTING_AGENCIES,
  COMPLAINT_STATUSES,
  ENFORCEMENT_STAGES,
  ORDINANCE_PRESETS,
  StatusBadge,
} from './constants.jsx';

export default function ComplaintsManagePage({ me, initialId = null }) {
  const showToast = useToast();
  const canViewPrivate = hasPermission(me, 'complaints.view_private');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const [showOralForm, setShowOralForm] = useState(false);
  const [oralForm, setOralForm] = useState({
    intake_channel: 'oral',
    is_anonymous: false,
    complainant_name: '',
    complainant_phone: '',
    subject_property_address: '',
    subject_person_name: '',
    ordinance_section: '',
    date_observed: '',
    conduct_description: '',
  });

  const [selected, setSelected] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [saving, setSaving] = useState(false);

  const [showNov, setShowNov] = useState(false);
  const [novForm, setNovForm] = useState({
    issuing_official: me?.username || '',
    violation_datetime: '',
    required_action: '',
    compliance_deadline: '',
  });
  const [uploading, setUploading] = useState(false);
  const [docConfidential, setDocConfidential] = useState(false);
  const [docCategory, setDocCategory] = useState('investigation_report');
  const [stats, setStats] = useState({ total: 0, open_count: 0, overdue_nov_count: 0, avg_resolution_days: null });
  const [msgText, setMsgText] = useState('');
  const [msgInternal, setMsgInternal] = useState(false);
  const [sendingMsg, setSendingMsg] = useState(false);

  const [codeSections, setCodeSections] = useState([]);
  const [showQueue, setShowQueue] = useState(false);
  const [showWo, setShowWo] = useState(false);
  const [woList, setWoList] = useState([]);
  const [reinspQueue, setReinspQueue] = useState([]);
  const [reinspForm, setReinspForm] = useState({
    inspect_date: '',
    inspector: me?.username || '',
    outcome: 'scheduled',
    notes: '',
    resolve_if_compliant: false,
  });

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (statusFilter) params.set('status', statusFilter);
      const qs = params.toString();
      const data = await api(`/api/complaints${qs ? `?${qs}` : ''}`);
      const list = data.items || [];
      setItems(list);
      if (data.stats) setStats(data.stats);
      setSelected((prev) => {
        if (!prev) return null;
        return list.find((r) => r.id === prev.id) || null;
      });
    } catch (err) {
      showToast(err.message || 'Failed to load complaints', 'error');
    } finally {
      setLoading(false);
    }
  }, [q, statusFilter, showToast]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    fetch('/api/codification/public')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const list = [];
        for (const ch of d?.chapters || []) {
          for (const sec of ch.sections || []) {
            list.push({
              id: sec.id,
              section_number: sec.section_number,
              title: sec.title,
              summary: sec.summary || '',
              label: `§ ${sec.section_number} — ${sec.title}`,
            });
          }
        }
        setCodeSections(list);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!showQueue) return;
    api('/api/complaints/reinspections/queue')
      .then((rows) => setReinspQueue(Array.isArray(rows) ? rows : []))
      .catch(() => setReinspQueue([]));
  }, [showQueue, items]);

  useEffect(() => {
    if (!showWo) return;
    api('/api/complaints/work-orders')
      .then((rows) => setWoList(Array.isArray(rows) ? rows : []))
      .catch(() => setWoList([]));
  }, [showWo]);

  useEffect(() => {
    if (!initialId || items.length === 0) return;
    const target = items.find((c) => c.id === initialId);
    if (target) openCase(target);
  }, [initialId, items]);

  function openCase(c) {
    setSelected(c);
    setShowNov(false);
    setEditForm({
      status: c.status || 'submitted',
      assigned_to: c.assigned_to || '',
      assisting_agency: c.assisting_agency || 'City Staff',
      ordinance_section: c.ordinance_section || '',
      subject_property_address: c.subject_property_address || '',
      subject_person_name: c.subject_person_name || '',
      investigation_report: c.investigation_report || '',
      internal_notes: c.internal_notes || '',
      council_meeting_date: c.council_meeting_date || '',
      final_resolution: c.final_resolution || '',
      code_section_id: c.code_section_id || 0,
      enforcement_stage: c.enforcement_stage || 'intake',
      reinspection_date: c.reinspection_date || '',
      citation_amount: c.citation_amount || '',
    });
  }

  async function handleLogOral(e) {
    e.preventDefault();
    try {
      const created = await api('/api/complaints', {
        method: 'POST',
        body: JSON.stringify(oralForm),
      });
      showToast(`Logged ${created.complaint_number}`, 'ok');
      setShowOralForm(false);
      setOralForm({
        intake_channel: 'oral',
        is_anonymous: false,
        complainant_name: '',
        complainant_phone: '',
        subject_property_address: '',
        subject_person_name: '',
        ordinance_section: '',
        date_observed: '',
        conduct_description: '',
      });
      await loadAll();
      openCase(created);
    } catch (err) {
      showToast(err.message || 'Failed to log complaint', 'error');
    }
  }

  async function handleSaveCase(e) {
    e.preventDefault();
    if (!selected || !editForm) return;
    setSaving(true);
    try {
      const updated = await api(`/api/complaints/${selected.id}`, {
        method: 'PATCH',
        body: JSON.stringify(editForm),
      });
      setSelected(updated);
      showToast('Complaint updated', 'ok');
      await loadAll();
    } catch (err) {
      showToast(err.message || 'Failed to update complaint', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleIssueNov(e) {
    e.preventDefault();
    if (!selected) return;
    try {
      const updated = await api(`/api/complaints/${selected.id}/nov`, {
        method: 'POST',
        body: JSON.stringify(novForm),
      });
      setSelected(updated);
      openCase(updated);
      setShowNov(false);
      showToast('Notice of Violation issued', 'ok');
      await loadAll();
    } catch (err) {
      showToast(err.message || 'Failed to issue Notice of Violation', 'error');
    }
  }

  async function handleUploadDoc(fileList) {
    if (!selected || !fileList || fileList.length === 0) return;
    setUploading(true);
    try {
      let latest = selected;
      for (const f of Array.from(fileList)) {
        const fd = new FormData();
        fd.append('file', f);
        fd.append('doc_category', docCategory);
        fd.append('is_confidential', String(docConfidential));
        fd.append('title', f.name);
        latest = await api(`/api/complaints/${selected.id}/documents`, {
          method: 'POST',
          body: fd,
        });
      }
      setSelected(latest);
      showToast('Document uploaded', 'ok');
      await loadAll();
    } catch (err) {
      showToast(err.message || 'Failed to upload document', 'error');
    } finally {
      setUploading(false);
    }
  }

  async function handleDeleteCase(c) {
    if (!window.confirm(`Delete complaint ${c.complaint_number}?`)) return;
    try {
      await api(`/api/complaints/${c.id}`, { method: 'DELETE' });
      showToast('Complaint deleted', 'ok');
      setSelected(null);
      setEditForm(null);
      await loadAll();
    } catch (err) {
      showToast(err.message || 'Failed to delete complaint', 'error');
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0 }}>Complaint Queue &amp; Investigations</h2>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Staff workbench for investigations, Notices of Violation, Council/Board referrals, and Log Book resolutions.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn"
            onClick={() => setShowWo((v) => !v)}
          >
            {showWo ? 'Hide 311 / Public Works' : '311 / Public Works Orders'}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => setShowQueue((v) => !v)}
          >
            {showQueue ? 'Hide Reinspection Queue' : 'Reinspection & Deadline Queue'}
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => setShowOralForm((v) => !v)}
          >
            {showOralForm ? 'Close Intake Form' : '+ Log Oral / Staff Complaint'}
          </button>
        </div>
      </div>

      {showWo && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Public Works &amp; 311 Work Orders ({woList.length})</h3>
          {!woList.length ? (
            <p className="muted" style={{ margin: 0 }}>No Public Works work orders yet.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>
                  <th style={{ padding: 6 }}>WO #</th>
                  <th style={{ padding: 6 }}>Category &amp; Asset</th>
                  <th style={{ padding: 6 }}>Location &amp; Description</th>
                  <th style={{ padding: 6 }}>Crew</th>
                  <th style={{ padding: 6 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {woList.map((wo) => (
                  <tr key={wo.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: 6 }}><strong>{wo.work_order_number}</strong><div className="muted" style={{ fontSize: 11 }}>{wo.priority}</div></td>
                    <td style={{ padding: 6 }}>{wo.category}{wo.asset_id && <div className="muted" style={{ fontSize: 11 }}>Asset: {wo.asset_id}</div>}</td>
                    <td style={{ padding: 6 }}><strong>{wo.location || '—'}</strong><div className="muted" style={{ fontSize: 11 }}>{wo.description}</div></td>
                    <td style={{ padding: 6 }}>{wo.assigned_crew || 'Unassigned'}</td>
                    <td style={{ padding: 6 }}>
                      <select
                        className="input"
                        style={{ width: 'auto' }}
                        value={wo.status}
                        onChange={async (e) => {
                          const updated = await api(`/api/complaints/work-orders/${wo.id}`, {
                            method: 'PATCH',
                            body: JSON.stringify({ status: e.target.value }),
                          });
                          setWoList((prev) => prev.map((x) => (x.id === wo.id ? updated : x)));
                          showToast('Work order updated', 'ok');
                        }}
                      >
                        <option value="open">Open</option>
                        <option value="assigned">Assigned</option>
                        <option value="in_progress">In Progress</option>
                        <option value="completed">Completed</option>
                        <option value="cancelled">Cancelled</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {showQueue && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Reinspection &amp; NOV Compliance Queue</h3>
          {reinspQueue.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>No open cases with scheduled reinspections or NOV deadlines.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>
                  <th style={{ padding: '6px' }}>Case #</th>
                  <th style={{ padding: '6px' }}>Property</th>
                  <th style={{ padding: '6px' }}>Stage</th>
                  <th style={{ padding: '6px' }}>Reinspection</th>
                  <th style={{ padding: '6px' }}>NOV Deadline</th>
                  <th style={{ padding: '6px' }}>Open</th>
                </tr>
              </thead>
              <tbody>
                {reinspQueue.map((rq) => (
                  <tr key={rq.id} style={{ borderBottom: '1px solid #f3f4f6', background: rq.is_overdue ? '#fef2f2' : 'transparent' }}>
                    <td style={{ padding: '6px' }}>
                      <strong>{rq.complaint_number}</strong>
                      {rq.is_overdue && <span className="badge disabled" style={{ marginLeft: 6 }}>Overdue</span>}
                    </td>
                    <td style={{ padding: '6px' }}>{rq.subject_property_address || '—'}</td>
                    <td style={{ padding: '6px' }}><span className="badge draft">{rq.enforcement_stage.replace('_', ' ')}</span></td>
                    <td style={{ padding: '6px' }}>{rq.reinspection_date || '—'}</td>
                    <td style={{ padding: '6px' }}>{rq.nov_compliance_deadline || '—'}</td>
                    <td style={{ padding: '6px' }}>
                      <button
                        type="button"
                        className="btn sm"
                        onClick={() => {
                          const match = items.find((x) => x.id === rq.id);
                          if (match) openCase(match);
                        }}
                      >
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
        <div className="card" style={{ margin: 0, padding: '.75rem 1rem' }}>
          <div className="muted" style={{ fontSize: 12 }}>Total Complaints</div>
          <div style={{ fontSize: '1.35rem', fontWeight: 700 }}>{stats.total}</div>
        </div>
        <div className="card" style={{ margin: 0, padding: '.75rem 1rem' }}>
          <div className="muted" style={{ fontSize: 12 }}>Open Cases</div>
          <div style={{ fontSize: '1.35rem', fontWeight: 700, color: '#2563eb' }}>{stats.open_count}</div>
        </div>
        <div className="card" style={{ margin: 0, padding: '.75rem 1rem', borderColor: stats.overdue_nov_count > 0 ? '#fca5a5' : undefined }}>
          <div className="muted" style={{ fontSize: 12 }}>Overdue NOV Deadlines</div>
          <div style={{ fontSize: '1.35rem', fontWeight: 700, color: stats.overdue_nov_count > 0 ? '#dc2626' : undefined }}>
            {stats.overdue_nov_count}
          </div>
        </div>
        <div className="card" style={{ margin: 0, padding: '.75rem 1rem' }}>
          <div className="muted" style={{ fontSize: 12 }}>Avg. Resolution</div>
          <div style={{ fontSize: '1.35rem', fontWeight: 700 }}>
            {stats.avg_resolution_days != null ? `${stats.avg_resolution_days}d` : '—'}
          </div>
        </div>
      </div>

      {showOralForm && (
        <form className="card" onSubmit={handleLogOral} style={{ display: 'grid', gap: 10 }}>
          <h3 style={{ margin: 0 }}>Log Oral, Anonymous, or Written Complaint</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
            <label>
              <div className="muted" style={{ fontSize: 12 }}>Intake Channel</div>
              <select
                className="input"
                value={oralForm.intake_channel}
                onChange={(e) => setOralForm({ ...oralForm, intake_channel: e.target.value })}
              >
                <option value="oral">Oral (Phone / In-Person)</option>
                <option value="written">Written</option>
                <option value="anonymous">Anonymous</option>
              </select>
            </label>
            <label>
              <div className="muted" style={{ fontSize: 12 }}>Complainant Name (Confidential)</div>
              <input
                className="input"
                value={oralForm.complainant_name}
                onChange={(e) => setOralForm({ ...oralForm, complainant_name: e.target.value })}
              />
            </label>
            <label>
              <div className="muted" style={{ fontSize: 12 }}>Complainant Phone (Confidential)</div>
              <input
                className="input"
                value={oralForm.complainant_phone}
                onChange={(e) => setOralForm({ ...oralForm, complainant_phone: e.target.value })}
              />
            </label>
            <label>
              <div className="muted" style={{ fontSize: 12 }}>Property / Location</div>
              <input
                className="input"
                value={oralForm.subject_property_address}
                onChange={(e) => setOralForm({ ...oralForm, subject_property_address: e.target.value })}
              />
            </label>
            <label>
              <div className="muted" style={{ fontSize: 12 }}>Ordinance Section</div>
              <input
                className="input"
                list="staff-ordinance-presets"
                value={oralForm.ordinance_section}
                onChange={(e) => setOralForm({ ...oralForm, ordinance_section: e.target.value })}
              />
              <datalist id="staff-ordinance-presets">
                {ORDINANCE_PRESETS.map((o) => <option key={o} value={o} />)}
              </datalist>
            </label>
          </div>
          <label>
            <div className="muted" style={{ fontSize: 12 }}>Conduct Description *</div>
            <textarea
              className="input"
              rows={3}
              required
              value={oralForm.conduct_description}
              onChange={(e) => setOralForm({ ...oralForm, conduct_description: e.target.value })}
            />
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" className="btn primary">Save Complaint</button>
          </div>
        </form>
      )}

      <div className="card" style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        <input
          className="input"
          style={{ flex: '1 1 240px' }}
          placeholder="Search #, property, complainant (staff only), ordinance..."
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
          gridTemplateColumns: selected ? '1.15fr 1fr' : '1fr',
          gap: 16,
          alignItems: 'start',
        }}
      >
        <div className="card" style={{ overflowX: 'auto' }}>
          {loading ? (
            <p className="muted">Loading complaints...</p>
          ) : items.length === 0 ? (
            <p className="muted">No complaints match the current filters.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>
                  <th style={{ padding: '8px 6px' }}>#</th>
                  <th style={{ padding: '8px 6px' }}>Received</th>
                  <th style={{ padding: '8px 6px' }}>Property</th>
                  <th style={{ padding: '8px 6px' }}>Ordinance</th>
                  <th style={{ padding: '8px 6px' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {items.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => openCase(c)}
                    style={{
                      cursor: 'pointer',
                      borderBottom: '1px solid #f3f4f6',
                      background: selected?.id === c.id ? '#eff6ff' : 'transparent',
                    }}
                  >
                    <td style={{ padding: '8px 6px', whiteSpace: 'nowrap', fontWeight: 500 }}>
                      <button type="button" className="link-btn" onClick={(e) => { e.stopPropagation(); openCase(c); }}>
                        {c.complaint_number}
                      </button>
                    </td>
                    <td style={{ padding: '8px 6px', whiteSpace: 'nowrap' }}>
                      {formatDate(c.created_at)}
                    </td>
                    <td style={{ padding: '8px 6px' }}>{c.subject_property_address || '—'}</td>
                    <td style={{ padding: '8px 6px' }}>{c.ordinance_section || '—'}</td>
                    <td style={{ padding: '8px 6px' }}><StatusBadge status={c.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {selected && editForm && (
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0 }}>{selected.complaint_number}</h3>
              <button type="button" className="btn sm" onClick={() => setSelected(null)}>
                Close
              </button>
            </div>

            <div
              style={{
                background: '#fffbeb',
                border: '1px solid #fcd34d',
                borderRadius: 6,
                padding: 10,
                fontSize: 13,
              }}
            >
              <strong>Confidential Complainant Data (Never in Public Log):</strong>
              {!canViewPrivate ? (
                <div className="muted">
                  Restricted — requires <code>complaints.view_private</code> permission.
                </div>
              ) : selected.is_anonymous ? (
                <div>Filed anonymously</div>
              ) : (
                <div>
                  {selected.complainant_name || 'No name'} · {selected.complainant_email || 'No email'} ·{' '}
                  {selected.complainant_phone || 'No phone'}
                  {selected.complainant_address ? ` · ${selected.complainant_address}` : ''}
                </div>
              )}
            </div>

            <div style={{ fontSize: 13 }}>
              <strong>Conduct Reported:</strong> {selected.conduct_description}
            </div>

            <form onSubmit={handleSaveCase} style={{ display: 'grid', gap: 10 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <label>
                  <div className="muted" style={{ fontSize: 12 }}>Status</div>
                  <select
                    className="input"
                    value={editForm.status}
                    onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                  >
                    {COMPLAINT_STATUSES.map((s) => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <div className="muted" style={{ fontSize: 12 }}>Assisting Agency</div>
                  <select
                    className="input"
                    value={editForm.assisting_agency}
                    onChange={(e) => setEditForm({ ...editForm, assisting_agency: e.target.value })}
                  >
                    {ASSISTING_AGENCIES.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                </label>
                <label>
                  <div className="muted" style={{ fontSize: 12 }}>Assigned Staff</div>
                  <input
                    className="input"
                    value={editForm.assigned_to}
                    onChange={(e) => setEditForm({ ...editForm, assigned_to: e.target.value })}
                  />
                </label>
                    <label>
                      <div className="muted" style={{ fontSize: 12 }}>Council / Board Meeting Date</div>
                      <input
                        type="date"
                        className="input"
                        value={editForm.council_meeting_date}
                        onChange={(e) => setEditForm({ ...editForm, council_meeting_date: e.target.value })}
                      />
                    </label>
                    <label>
                      <div className="muted" style={{ fontSize: 12 }}>Enforcement Stage</div>
                      <select
                        className="input"
                        value={editForm.enforcement_stage}
                        onChange={(e) => setEditForm({ ...editForm, enforcement_stage: e.target.value })}
                      >
                        {ENFORCEMENT_STAGES.map((st) => (
                          <option key={st.value} value={st.value}>{st.label}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <div className="muted" style={{ fontSize: 12 }}>Next Reinspection Date</div>
                      <input
                        type="date"
                        className="input"
                        value={editForm.reinspection_date}
                        onChange={(e) => setEditForm({ ...editForm, reinspection_date: e.target.value })}
                      />
                    </label>
                    <label>
                      <div className="muted" style={{ fontSize: 12 }}>Citation / Fine Amount</div>
                      <input
                        className="input"
                        placeholder="e.g. $150.00"
                        value={editForm.citation_amount}
                        onChange={(e) => setEditForm({ ...editForm, citation_amount: e.target.value })}
                      />
                    </label>
                    {codeSections.length > 0 && (
                      <label style={{ gridColumn: '1 / -1' }}>
                        <div className="muted" style={{ fontSize: 12 }}>Link City Code Section (§)</div>
                        <select
                          className="input"
                          value={editForm.code_section_id || 0}
                          onChange={(e) => {
                            const cid = Number(e.target.value) || 0;
                            const sec = codeSections.find((s) => s.id === cid);
                            setEditForm({
                              ...editForm,
                              code_section_id: cid,
                              ordinance_section: sec ? sec.label : editForm.ordinance_section,
                            });
                          }}
                        >
                          <option value={0}>— Select Municipal Code Section (optional) —</option>
                          {codeSections.map((sec) => (
                            <option key={sec.id} value={sec.id}>{sec.label}</option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>
                  {selected.linked_code_section && (
                    <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: 8, fontSize: 12 }}>
                      <strong>Cited Code § {selected.linked_code_section.section_number} ({selected.linked_code_section.title}):</strong>{' '}
                      <span className="muted">{selected.linked_code_section.summary || 'See Municipal Code.'}</span>
                    </div>
                  )}

              <label>
                <div className="muted" style={{ fontSize: 12 }}>
                  Written Investigation Report (PUBLIC — omit confidential complainant data!)
                </div>
                <textarea
                  className="input"
                  rows={3}
                  value={editForm.investigation_report}
                  onChange={(e) => setEditForm({ ...editForm, investigation_report: e.target.value })}
                />
              </label>

              <label>
                <div className="muted" style={{ fontSize: 12 }}>
                  Internal Staff Notes (PRIVATE — staff only)
                </div>
                <textarea
                  className="input"
                  rows={2}
                  value={editForm.internal_notes}
                  onChange={(e) => setEditForm({ ...editForm, internal_notes: e.target.value })}
                />
              </label>

              <label>
                <div className="muted" style={{ fontSize: 12 }}>
                  Final Resolution (PUBLIC Log Book)
                </div>
                <textarea
                  className="input"
                  rows={2}
                  value={editForm.final_resolution}
                  onChange={(e) => setEditForm({ ...editForm, final_resolution: e.target.value })}
                />
              </label>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="submit" className="btn primary" disabled={saving}>
                    {saving ? 'Saving...' : 'Save Case'}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setShowNov((v) => !v)}
                  >
                    Issue Notice of Violation
                  </button>
                  <a
                    className="btn"
                    href={`/api/complaints/${selected.id}/nov-pdf`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    NOV / Citation PDF
                  </a>
                  <button
                    type="button"
                    className="btn"
                    onClick={async () => {
                      const wo = await api('/api/complaints/work-orders', {
                        method: 'POST',
                        body: JSON.stringify({
                          source_complaint_id: selected.id,
                          category: 'Other',
                          location: selected.subject_property_address || '',
                          description: `From ${selected.complaint_number}: ${selected.conduct_description}`,
                          assigned_crew: 'Public Works',
                        }),
                      });
                      setShowWo(true);
                      setWoList((prev) => [wo, ...prev]);
                      showToast(`Created Work Order ${wo.work_order_number}`, 'ok');
                    }}
                  >
                    Create Work Order
                  </button>
                </div>
                <button
                  type="button"
                  className="btn danger"
                  onClick={() => handleDeleteCase(selected)}
                >
                  Delete
                </button>
              </div>
            </form>

            {showNov && (
              <form
                onSubmit={handleIssueNov}
                style={{
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: 8,
                  padding: 10,
                  display: 'grid',
                  gap: 8,
                }}
              >
                <strong>Issue Notice of Violation</strong>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <label>
                    <div className="muted" style={{ fontSize: 12 }}>Issuing Official *</div>
                    <input
                      className="input"
                      required
                      value={novForm.issuing_official}
                      onChange={(e) => setNovForm({ ...novForm, issuing_official: e.target.value })}
                    />
                  </label>
                  <label>
                    <div className="muted" style={{ fontSize: 12 }}>Compliance Deadline (≤ 60 days) *</div>
                    <input
                      type="date"
                      className="input"
                      required
                      value={novForm.compliance_deadline}
                      onChange={(e) => setNovForm({ ...novForm, compliance_deadline: e.target.value })}
                    />
                  </label>
                </div>
                <label>
                  <div className="muted" style={{ fontSize: 12 }}>Required Compliance Action *</div>
                  <textarea
                    className="input"
                    rows={2}
                    required
                    value={novForm.required_action}
                    onChange={(e) => setNovForm({ ...novForm, required_action: e.target.value })}
                  />
                </label>
                <button type="submit" className="btn danger">
                  Confirm &amp; Issue Notice of Violation
                </button>
              </form>
            )}

            <details open={(selected.reinspections || []).length > 0} style={{ borderTop: '1px solid #e5e7eb', paddingTop: 10 }}>
              <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: 13, marginBottom: 8 }}>
                Field Inspections &amp; Reinspections ({(selected.reinspections || []).length})
              </summary>
              <div style={{ display: 'grid', gap: 8 }}>
              <form
                style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}
                onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    const updated = await api(`/api/complaints/${selected.id}/reinspections`, {
                      method: 'POST',
                      body: JSON.stringify(reinspForm),
                    });
                    setSelected(updated);
                    openCase(updated);
                    setReinspForm({ inspect_date: '', inspector: me?.username || '', outcome: 'scheduled', notes: '', resolve_if_compliant: false });
                    showToast('Reinspection recorded', 'ok');
                    await loadAll();
                  } catch (err) {
                    showToast(err.message || 'Failed to log reinspection', 'error');
                  }
                }}
              >
                <input
                  type="date"
                  className="input"
                  style={{ width: 'auto' }}
                  value={reinspForm.inspect_date}
                  onChange={(e) => setReinspForm({ ...reinspForm, inspect_date: e.target.value })}
                />
                <select
                  className="input"
                  style={{ width: 'auto' }}
                  value={reinspForm.outcome}
                  onChange={(e) => setReinspForm({ ...reinspForm, outcome: e.target.value })}
                >
                  <option value="scheduled">Scheduled Reinspection</option>
                  <option value="in_compliance">In Compliance</option>
                  <option value="non_compliant">Still Non-Compliant</option>
                  <option value="extended">Deadline Extended</option>
                </select>
                <input
                  className="input"
                  style={{ flex: '1 1 160px' }}
                  placeholder="Field observations / notes..."
                  value={reinspForm.notes}
                  onChange={(e) => setReinspForm({ ...reinspForm, notes: e.target.value })}
                />
                {reinspForm.outcome === 'in_compliance' && (
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                    <input
                      type="checkbox"
                      checked={reinspForm.resolve_if_compliant}
                      onChange={(e) => setReinspForm({ ...reinspForm, resolve_if_compliant: e.target.checked })}
                    />
                    <span>Resolve case</span>
                  </label>
                )}
                <button type="submit" className="btn sm primary">Log</button>
              </form>
              {(selected.reinspections || []).length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {selected.reinspections.map((ri) => (
                    <div key={ri.id} style={{ fontSize: 12, padding: '4px 8px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 4, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span>
                        <strong>{ri.inspect_date || 'TBD'}</strong> · <span className="badge draft">{ri.outcome.replace('_', ' ')}</span> ({ri.inspector})
                        {ri.notes ? ` — ${ri.notes}` : ''}
                      </span>
                      <button
                        type="button"
                        className="btn sm danger"
                        onClick={async () => {
                          const updated = await api(`/api/complaints/${selected.id}/reinspections/${ri.id}`, { method: 'DELETE' });
                          setSelected(updated);
                          await loadAll();
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
              </div>
            </details>

            <details open={(selected.documents || []).length > 0} style={{ borderTop: '1px solid #e5e7eb', paddingTop: 10 }}>
              <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: 13, marginBottom: 8 }}>
                Attachments ({(selected.documents || []).length})
              </summary>
              <div style={{ display: 'grid', gap: 8 }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <select
                  className="input"
                  style={{ width: 'auto' }}
                  value={docCategory}
                  onChange={(e) => setDocCategory(e.target.value)}
                >
                  <option value="investigation_report">Investigation Report</option>
                  <option value="notice_of_violation">Notice of Violation</option>
                  <option value="evidence">Evidence / Photo</option>
                  <option value="correspondence">Correspondence</option>
                  <option value="other">Other</option>
                </select>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    style={{ width: 'auto', flexShrink: 0 }}
                    checked={docConfidential}
                    onChange={(e) => setDocConfidential(e.target.checked)}
                  />
                  <span>Confidential (exclude from public log)</span>
                </label>
                <input
                  type="file"
                  multiple
                  disabled={uploading}
                  onChange={(e) => {
                    handleUploadDoc(e.target.files);
                    e.target.value = '';
                  }}
                />
              </div>
              {(selected.documents || []).map((d) => (
                <div key={d.id} style={{ fontSize: 13 }}>
                  <a href={`/api/complaints/documents/${d.id}/download`} target="_blank" rel="noreferrer">
                    {d.filename}
                  </a>{' '}
                  <span className="muted">
                    ({d.doc_category}, {formatSize(d.size_bytes)})
                  </span>
                  {d.is_confidential && (
                    <span className="badge" style={{ background: '#fee2e2', color: '#991b1b', marginLeft: 6 }}>
                      Confidential
                    </span>
                  )}
                </div>
              ))}
              </div>
            </details>

            <details open={(selected.messages || []).length > 0} style={{ borderTop: '1px solid #e5e7eb', paddingTop: 10 }}>
              <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: 13, marginBottom: 8 }}>
                Messages &amp; Resident Updates ({(selected.messages || []).length})
              </summary>
              <div style={{ display: 'grid', gap: 8 }}>
              {(selected.messages || []).map((m) => (
                <div
                  key={m.id}
                  style={{
                    background: m.is_internal ? '#fef3c7' : '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: 6,
                    padding: '6px 10px',
                    fontSize: 13,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                    <strong>{m.sender_username} {m.is_internal ? '(Internal Note)' : ''}</strong>
                    <span className="muted" style={{ fontSize: 11 }}>{formatDate(m.created_at)}</span>
                  </div>
                  <div style={{ whiteSpace: 'pre-wrap' }}>{m.body}</div>
                </div>
              ))}
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!msgText.trim()) return;
                  setSendingMsg(true);
                  try {
                    const updated = await api(`/api/complaints/${selected.id}/messages`, {
                      method: 'POST',
                      body: JSON.stringify({ body: msgText.trim(), is_internal: msgInternal }),
                    });
                    setSelected(updated);
                    setMsgText('');
                    setMsgInternal(false);
                    showToast(msgInternal ? 'Internal note added' : 'Message sent', 'ok');
                    await loadAll();
                  } catch (err) {
                    showToast(err.message || 'Failed to send message', 'error');
                  } finally {
                    setSendingMsg(false);
                  }
                }}
                style={{ display: 'grid', gap: 6 }}
              >
                <textarea
                  rows={2}
                  placeholder="Write an update for the complainant or an internal staff note..."
                  value={msgText}
                  onChange={(e) => setMsgText(e.target.value)}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                    <input
                      type="checkbox"
                      style={{ width: 'auto' }}
                      checked={msgInternal}
                      onChange={(e) => setMsgInternal(e.target.checked)}
                    />
                    <span>Internal note (hidden from resident &amp; public)</span>
                  </label>
                  <button type="submit" className="btn sm primary" disabled={sendingMsg}>
                    {sendingMsg ? 'Sending...' : 'Send Message'}
                  </button>
                </div>
              </form>
              </div>
            </details>
          </div>
        )}
      </div>
    </div>
  );
}
