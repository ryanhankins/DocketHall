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

import React, { useEffect, useState } from 'react';
import { api, formatDate, formatSize } from '../../core/api.js';
import { useToast } from '../../core/toast.jsx';
import { permitStatusBadge } from './MyPermitsPage.jsx';

export default function PermitDetailWorkspace({ permit, isManager = false, onUpdated, onBack }) {
  const [tab, setTab] = useState('overview');
  const [status, setStatus] = useState(permit.status);
  const [fee, setFee] = useState(permit.fee_amount || '');
  const [payStatus, setPayStatus] = useState(permit.payment_status || 'unpaid');
  const [assignedTo, setAssignedTo] = useState(permit.assigned_to || '');
  const [notes, setNotes] = useState(permit.review_notes || '');

  // Workflow form
  const [wfName, setWfName] = useState('');
  const [wfDept, setWfDept] = useState('');
  const [wfAssign, setWfAssign] = useState('');

  // Inspection form
  const [inspType, setInspType] = useState('Final Inspection');
  const [inspDate, setInspDate] = useState('');
  const [inspInspector, setInspInspector] = useState('');
  const [inspNotes, setInspNotes] = useState('');

  // Message form
  const [msgText, setMsgText] = useState('');
  const [msgInternal, setMsgInternal] = useState(false);

  // Document upload
  const [docCat, setDocCat] = useState('Other');
  const [busy, setBusy] = useState(false);
  const showToast = useToast();

  useEffect(() => {
    setStatus(permit.status);
    setFee(permit.fee_amount || '');
    setPayStatus(permit.payment_status || 'unpaid');
    setAssignedTo(permit.assigned_to || '');
    setNotes(permit.review_notes || '');
  }, [permit]);

  const workflow = permit.workflow_steps || [];
  const inspections = permit.inspections || [];
  const messages = permit.messages || [];
  const docs = permit.documents || [];
  const logs = permit.activity_log || [];

  return (
    <div>
      <div className="between" style={{ marginBottom: '.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.65rem', flexWrap: 'wrap' }}>
          <button type="button" className="btn sm" onClick={onBack}>&larr; Back to List</button>
          <h2 style={{ margin: 0 }}>{permit.permit_number} — {permit.permit_type_name}: {permit.permit_use_name}</h2>
          <span className={permitStatusBadge(permit.status)}>{permit.status.replace('_', ' ')}</span>
        </div>
        <div className="actions">
          <a className="btn sm primary" href={`/api/permits/${permit.id}/pdf`} target="_blank" rel="noreferrer">Permit PDF</a>
        </div>
      </div>

      <div className="tabs">
        {[
          ['overview', 'Overview & Review'],
          ['workflow', `Workflow (${workflow.length})`],
          ['inspections', `Inspections (${inspections.length})`],
          ['messages', `Messages (${messages.length})`],
          ['documents', `Documents (${docs.length})`],
          ['activity', `Activity Log (${logs.length})`],
        ].map(([k, lbl]) => (
          <button key={k} type="button" className={`btn sm${tab === k ? ' active' : ''}`} onClick={() => setTab(k)}>
            {lbl}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="card">
          <div className="row" style={{ marginBottom: '.85rem', alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: '240px' }}>
              <h3 style={{ margin: '0 0 .4rem', fontSize: '.95rem' }}>Property &amp; Applicant</h3>
              <div style={{ fontSize: '.9rem', lineHeight: 1.55 }}>
                <div><strong>Applicant:</strong> {permit.applicant_name} ({permit.applicant_username || '—'})</div>
                <div><strong>Contact:</strong> {permit.applicant_email || '—'} · {permit.applicant_phone || '—'}</div>
                <div><strong>Location:</strong> {permit.property_address}</div>
                {(permit.building_name || permit.suite_name) && (
                  <div><strong>Building / Unit:</strong> {permit.building_name || '—'} / {permit.suite_name || '—'}</div>
                )}
                <div><strong>Parcel / Owner:</strong> {permit.parcel_id || '—'} / {permit.owner_name || '—'}</div>
                <div><strong>Contractor:</strong> {permit.contractor_name || '—'} (Lic: {permit.contractor_license || '—'})</div>
                <div><strong>Est. Value:</strong> {permit.estimated_value || '—'}</div>
                <div><strong>Submitted:</strong> {formatDate(permit.created_at)}</div>
                {permit.issued_at && <div><strong>Issued:</strong> {formatDate(permit.issued_at)}</div>}
                {permit.closed_at && <div><strong>Closed:</strong> {formatDate(permit.closed_at)}</div>}
              </div>
              {permit.project_description && (
                <div style={{ marginTop: '.65rem' }}>
                  <strong>Project Description:</strong>
                  <p className="muted" style={{ margin: '.25rem 0 0' }}>{permit.project_description}</p>
                </div>
              )}
            </div>

            <div style={{ flex: 1, minWidth: '260px' }}>
              <h3 style={{ margin: '0 0 .4rem', fontSize: '.95rem' }}>Review &amp; Fee Status</h3>
              {isManager ? (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setBusy(true);
                    try {
                      const updated = await api(`/api/permits/${permit.id}`, {
                        method: 'PATCH',
                        body: JSON.stringify({
                          status,
                          fee_amount: fee.trim(),
                          payment_status: payStatus,
                          assigned_to: assignedTo.trim(),
                          review_notes: notes.trim(),
                        }),
                      });
                      showToast(`Updated ${permit.permit_number}`, 'ok');
                      onUpdated(updated);
                    } catch (err) {
                      showToast(err.message, 'error');
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <div className="row" style={{ marginBottom: '.6rem' }}>
                    <div className="field" style={{ flex: 1 }}>
                      <label>Status</label>
                      <select value={status} onChange={(e) => setStatus(e.target.value)}>
                        <option value="submitted">Submitted</option>
                        <option value="under_review">Under Review</option>
                        <option value="needs_info">Needs Info</option>
                        <option value="approved">Approved</option>
                        <option value="issued">Issued</option>
                        <option value="denied">Denied</option>
                        <option value="closed">Closed</option>
                      </select>
                    </div>
                    <div className="field" style={{ flex: 1 }}>
                      <label>Assigned Reviewer</label>
                      <input placeholder="e.g. Building Official" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} />
                    </div>
                  </div>
                  <div className="row" style={{ marginBottom: '.6rem' }}>
                    <div className="field" style={{ flex: 1 }}>
                      <label>Assessed Fee</label>
                      <input placeholder="e.g. $150.00" value={fee} onChange={(e) => setFee(e.target.value)} />
                    </div>
                    <div className="field" style={{ flex: 1 }}>
                      <label>Payment Status</label>
                      <select value={payStatus} onChange={(e) => setPayStatus(e.target.value)}>
                        <option value="unpaid">Unpaid</option>
                        <option value="paid">Paid</option>
                        <option value="waived">Waived</option>
                      </select>
                    </div>
                  </div>
                  <div className="field" style={{ marginBottom: '.65rem' }}>
                    <label>Review Notes (visible to applicant)</label>
                    <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
                  </div>
                  <button type="submit" className="btn primary" disabled={busy}>Save Review</button>
                </form>
              ) : (
                <div style={{ fontSize: '.9rem', lineHeight: 1.6 }}>
                  <div><strong>Status:</strong> {permit.status.replace('_', ' ')}</div>
                  <div><strong>Fee:</strong> {permit.fee_amount || 'TBD'} ({permit.payment_status})</div>
                  <div><strong>Assigned Reviewer:</strong> {permit.assigned_to || 'Unassigned'}</div>
                  {permit.review_notes && (
                    <div style={{ marginTop: '.5rem', padding: '.5rem .65rem', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '6px' }}>
                      <strong>Staff Notes:</strong> {permit.review_notes}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === 'workflow' && (
        <div className="card">
          <h2>Department Review Workflow</h2>
          {isManager && (
            <form
              className="row"
              style={{ marginBottom: '1rem', alignItems: 'flex-end' }}
              onSubmit={async (e) => {
                e.preventDefault();
                if (!wfName.trim()) return;
                const updated = await api(`/api/permits/${permit.id}/workflow`, {
                  method: 'POST',
                  body: JSON.stringify({ step_name: wfName.trim(), department: wfDept.trim(), assigned_to: wfAssign.trim() }),
                });
                setWfName(''); setWfDept(''); setWfAssign('');
                onUpdated(updated);
              }}
            >
              <div className="field" style={{ flex: 2, minWidth: '180px' }}>
                <label>Review Step</label>
                <input placeholder="e.g. Zoning Review, Plan Check, Engineering" required value={wfName} onChange={(e) => setWfName(e.target.value)} />
              </div>
              <div className="field" style={{ flex: 1, minWidth: '140px' }}>
                <label>Department</label>
                <input placeholder="e.g. Planning" value={wfDept} onChange={(e) => setWfDept(e.target.value)} />
              </div>
              <div className="field" style={{ flex: 1, minWidth: '140px' }}>
                <label>Assignee</label>
                <input placeholder="e.g. City Engineer" value={wfAssign} onChange={(e) => setWfAssign(e.target.value)} />
              </div>
              <button type="submit" className="btn sm primary">Add Step</button>
            </form>
          )}
          {!workflow.length ? (
            <p className="muted">No workflow steps recorded yet.</p>
          ) : (
            <table>
              <thead>
                <tr><th>Step</th><th>Department</th><th>Assignee</th><th>Status</th><th>Notes</th>{isManager && <th>Actions</th>}</tr>
              </thead>
              <tbody>
                {workflow.map(w => (
                  <tr key={w.id}>
                    <td><strong>{w.step_name}</strong></td>
                    <td>{w.department || '—'}</td>
                    <td>{w.assigned_to || '—'}</td>
                    <td>
                      {isManager ? (
                        <select
                          className="btn sm"
                          style={{ width: 'auto' }}
                          value={w.status}
                          onChange={async (e) => {
                            onUpdated(await api(`/api/permits/${permit.id}/workflow/${w.id}`, {
                              method: 'PATCH', body: JSON.stringify({ status: e.target.value }),
                            }));
                          }}
                        >
                          <option value="pending">Pending</option>
                          <option value="in_progress">In Progress</option>
                          <option value="approved">Approved</option>
                          <option value="revisions_required">Revisions Required</option>
                          <option value="na">N/A</option>
                        </select>
                      ) : (
                        <span className={`badge ${w.status === 'approved' ? 'active' : (w.status === 'revisions_required' ? 'disabled' : 'draft')}`}>
                          {w.status.replace('_', ' ')}
                        </span>
                      )}
                    </td>
                    <td className="muted">{w.notes || '—'}</td>
                    {isManager && (
                      <td>
                        <button
                          type="button"
                          className="btn sm danger"
                          onClick={async () => onUpdated(await api(`/api/permits/${permit.id}/workflow/${w.id}`, { method: 'DELETE' }))}
                        >
                          Remove
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'inspections' && (
        <div className="card">
          <h2>Inspections</h2>
          <form
            className="row"
            style={{ marginBottom: '1rem', alignItems: 'flex-end' }}
            onSubmit={async (e) => {
              e.preventDefault();
              const updated = await api(`/api/permits/${permit.id}/inspections`, {
                method: 'POST',
                body: JSON.stringify({
                  inspection_type: inspType.trim(),
                  scheduled_date: inspDate,
                  inspector: inspInspector.trim(),
                  notes: inspNotes.trim(),
                }),
              });
              setInspDate(''); setInspNotes('');
              showToast('Inspection scheduled', 'ok');
              onUpdated(updated);
            }}
          >
            <div className="field" style={{ flex: 2, minWidth: '180px' }}>
              <label>Inspection Type</label>
              <input required placeholder="e.g. Footing, Framing, Final Inspection" value={inspType} onChange={(e) => setInspType(e.target.value)} />
            </div>
            <div className="field">
              <label>Requested / Scheduled Date</label>
              <input type="date" value={inspDate} onChange={(e) => setInspDate(e.target.value)} />
            </div>
            {isManager && (
              <div className="field" style={{ flex: 1, minWidth: '140px' }}>
                <label>Inspector</label>
                <input placeholder="Inspector name" value={inspInspector} onChange={(e) => setInspInspector(e.target.value)} />
              </div>
            )}
            <div className="field" style={{ flex: 2, minWidth: '180px' }}>
              <label>Notes</label>
              <input placeholder="Access instructions or notes" value={inspNotes} onChange={(e) => setInspNotes(e.target.value)} />
            </div>
            <button type="submit" className="btn sm primary">{isManager ? 'Schedule Inspection' : 'Request Inspection'}</button>
          </form>

          {!inspections.length ? (
            <p className="muted">No inspections scheduled yet.</p>
          ) : (
            <table>
              <thead>
                <tr><th>Inspection</th><th>Date</th><th>Inspector</th><th>Result</th><th>Notes</th>{isManager && <th>Actions</th>}</tr>
              </thead>
              <tbody>
                {inspections.map(ins => (
                  <tr key={ins.id}>
                    <td><strong>{ins.inspection_type}</strong></td>
                    <td>{ins.scheduled_date || 'TBD'}</td>
                    <td>{ins.inspector || '—'}</td>
                    <td>
                      {isManager ? (
                        <select
                          className="btn sm"
                          style={{ width: 'auto' }}
                          value={ins.result}
                          onChange={async (e) => {
                            onUpdated(await api(`/api/permits/${permit.id}/inspections/${ins.id}`, {
                              method: 'PATCH', body: JSON.stringify({ result: e.target.value }),
                            }));
                          }}
                        >
                          <option value="scheduled">Scheduled</option>
                          <option value="passed">Passed</option>
                          <option value="failed">Failed</option>
                          <option value="partial">Partial</option>
                          <option value="cancelled">Cancelled</option>
                        </select>
                      ) : (
                        <span className={`badge ${ins.result === 'passed' ? 'active' : (ins.result === 'failed' ? 'disabled' : 'draft')}`}>
                          {ins.result}
                        </span>
                      )}
                    </td>
                    <td className="muted">{ins.notes || '—'}</td>
                    {isManager && (
                      <td>
                        <button
                          type="button"
                          className="btn sm danger"
                          onClick={async () => onUpdated(await api(`/api/permits/${permit.id}/inspections/${ins.id}`, { method: 'DELETE' }))}
                        >
                          Remove
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'messages' && (
        <div className="card">
          <h2>Communications</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem', marginBottom: '1rem' }}>
            {!messages.length ? (
              <p className="muted">No messages yet.</p>
            ) : messages.map(m => (
              <div
                key={m.id}
                style={{
                  padding: '.6rem .8rem',
                  borderRadius: '6px',
                  border: '1px solid #e2e8f0',
                  background: m.is_internal ? '#fef3c7' : '#f8fafc',
                }}
              >
                <div className="between" style={{ marginBottom: '.25rem', fontSize: '.82rem' }}>
                  <span>
                    <strong>{m.sender_username}</strong> ({m.sender_role})
                    {m.is_internal && <span className="badge draft" style={{ marginLeft: '.4rem' }}>Internal Staff Note</span>}
                  </span>
                  <span className="muted">{formatDate(m.created_at)}</span>
                </div>
                <div style={{ fontSize: '.9rem', whiteSpace: 'pre-wrap' }}>{m.body}</div>
              </div>
            ))}
          </div>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!msgText.trim()) return;
              const updated = await api(`/api/permits/${permit.id}/messages`, {
                method: 'POST',
                body: JSON.stringify({ body: msgText.trim(), is_internal: isManager && msgInternal }),
              });
              setMsgText(''); setMsgInternal(false);
              onUpdated(updated);
            }}
          >
            <div className="field" style={{ marginBottom: '.55rem' }}>
              <textarea rows={2} required placeholder="Write a message..." value={msgText} onChange={(e) => setMsgText(e.target.value)} />
            </div>
            <div className="between">
              {isManager ? (
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem', fontSize: '.86rem', cursor: 'pointer' }}>
                  <input type="checkbox" style={{ width: 'auto' }} checked={msgInternal} onChange={(e) => setMsgInternal(e.target.checked)} />
                  <span>Internal staff-only note (hidden from applicant)</span>
                </label>
              ) : <span />}
              <button type="submit" className="btn sm primary">Send Message</button>
            </div>
          </form>
        </div>
      )}

      {tab === 'documents' && (
        <div className="card">
          <h2>Documents</h2>
          {docs.length > 0 ? (
            <ul className="doc-list">
              {docs.map(d => (
                <li key={d.id}>
                  <span>
                    <span className="badge text">{d.doc_category}</span>{' '}
                    {d.title} <span className="muted">({formatSize(d.size_bytes)}, by {d.uploaded_by})</span>
                  </span>
                  <div className="actions">
                    <a className="btn sm" href={`/api/permits/${permit.id}/documents/${d.id}/download`} target="_blank" rel="noreferrer">View</a>
                    {(isManager || permit.status === 'submitted' || permit.status === 'needs_info') && (
                      <button
                        type="button"
                        className="btn sm danger"
                        onClick={async () => onUpdated(await api(`/api/permits/${permit.id}/documents/${d.id}`, { method: 'DELETE' }))}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No documents uploaded yet.</p>
          )}
          <div className="row" style={{ alignItems: 'center', marginTop: '.5rem' }}>
            <select value={docCat} onChange={(e) => setDocCat(e.target.value)} style={{ width: 'auto' }}>
              <option value="Certificate of Insurance">Certificate of Insurance</option>
              <option value="Design Plans">Design Plans</option>
              <option value="Land Survey / Photos">Land Survey / Photos</option>
              <option value="Inspection Report">Inspection Report</option>
              <option value="Other">Other</option>
            </select>
            <input
              id={`ws-doc-file-${permit.id}`}
              type="file"
              multiple
              hidden
              onChange={async (e) => {
                for (const file of Array.from(e.target.files || [])) {
                  const fd = new FormData();
                  fd.append('file', file);
                  fd.append('doc_category', docCat);
                  onUpdated(await api(`/api/permits/${permit.id}/documents`, { method: 'POST', body: fd }));
                }
                e.target.value = '';
                showToast('Document(s) uploaded', 'ok');
              }}
            />
            <button type="button" className="btn sm" onClick={() => document.getElementById(`ws-doc-file-${permit.id}`)?.click()}>
              + Upload Document
            </button>
          </div>
        </div>
      )}

      {tab === 'activity' && (
        <div className="card">
          <h2>Activity Log</h2>
          {!logs.length ? (
            <p className="muted">No activity recorded yet.</p>
          ) : (
            <table>
              <thead>
                <tr><th>Time</th><th>Action</th><th>User</th><th>Details</th></tr>
              </thead>
              <tbody>
                {logs.map(l => (
                  <tr key={l.id}>
                    <td className="muted">{formatDate(l.created_at)}</td>
                    <td><strong>{l.action}</strong></td>
                    <td>{l.actor || '—'}</td>
                    <td className="muted">{l.note || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
