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
import {
  ASSISTING_AGENCIES,
  COMPLAINT_STATUSES,
  ORDINANCE_PRESETS,
  StatusBadge,
} from './constants.jsx';

export default function ComplaintsManagePage({ me }) {
  const showToast = useToast();
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
          <h2 style={{ margin: 0 }}>Complaint Queue &amp; Investigations (Section 618)</h2>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Staff workbench for investigations, Notices of Violation (≤60 days), Council referrals, and Log Book resolutions.
          </p>
        </div>
        <button
          type="button"
          className="btn primary"
          onClick={() => setShowOralForm((v) => !v)}
        >
          {showOralForm ? 'Close Intake Form' : '+ Log Oral / Staff Complaint'}
        </button>
      </div>

      {showOralForm && (
        <form className="card" onSubmit={handleLogOral} style={{ display: 'grid', gap: 10 }}>
          <h3 style={{ margin: 0 }}>Log Oral, Anonymous, or Written Complaint (Section 618.020)</h3>
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
                      {c.complaint_number}
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
              <strong>Confidential Complainant Data (MN Stat. § 13.44 — Never in Public Log):</strong>
              {selected.is_anonymous ? (
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
                  <div className="muted" style={{ fontSize: 12 }}>Assisting Agency (618.030)</div>
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
                  <div className="muted" style={{ fontSize: 12 }}>Council Meeting Date (618.050)</div>
                  <input
                    type="date"
                    className="input"
                    value={editForm.council_meeting_date}
                    onChange={(e) => setEditForm({ ...editForm, council_meeting_date: e.target.value })}
                  />
                </label>
              </div>

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
                  Final Resolution (PUBLIC Log Book — Section 618.070)
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
                <strong>Issue Notice of Violation (Section 618.040)</strong>
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

            <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 10, display: 'grid', gap: 8 }}>
              <strong>Attachments</strong>
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
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                  <input
                    type="checkbox"
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
          </div>
        )}
      </div>
    </div>
  );
}
