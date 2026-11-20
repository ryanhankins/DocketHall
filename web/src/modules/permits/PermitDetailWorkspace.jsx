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
import { permitExpiryInfo, permitStatusBadge } from './MyPermitsPage.jsx';
import CustomFieldsRenderer from './CustomFieldsRenderer.jsx';

export default function PermitDetailWorkspace({ permit, isManager = false, onUpdated, onBack }) {
  const [tab, setTab] = useState('overview');
  const [status, setStatus] = useState(permit.status);
  const [fee, setFee] = useState(permit.fee_amount || '');
  const [payStatus, setPayStatus] = useState(permit.payment_status || 'unpaid');
  const [assignedTo, setAssignedTo] = useState(permit.assigned_to || '');
  const [expiresAt, setExpiresAt] = useState(permit.expires_at || '');
  const [notes, setNotes] = useState(permit.review_notes || '');
  const [contractorCheck, setContractorCheck] = useState(null);
  const [editingDetails, setEditingDetails] = useState(false);
  const [details, setDetails] = useState({
    applicant_name: permit.applicant_name || '',
    applicant_email: permit.applicant_email || '',
    applicant_phone: permit.applicant_phone || '',
    property_address: permit.property_address || '',
    building_name: permit.building_name || '',
    suite_name: permit.suite_name || '',
    parcel_id: permit.parcel_id || '',
    owner_name: permit.owner_name || '',
    contractor_name: permit.contractor_name || '',
    contractor_license: permit.contractor_license || '',
    estimated_value: permit.estimated_value || '',
    project_description: permit.project_description || '',
    project_name: permit.project_name || '',
  });
  const [customData, setCustomData] = useState(permit.custom_data || {});
  const [customFieldDefs, setCustomFieldDefs] = useState([]);
  const [linkCandidates, setLinkCandidates] = useState([]);
  const [linkTargetId, setLinkTargetId] = useState('');
  const [linkRel, setLinkRel] = useState('enabled_by');
  const [paymentsEnabled, setPaymentsEnabled] = useState(false);

  // Workflow form
  const [wfName, setWfName] = useState('');
  const [wfDept, setWfDept] = useState('');
  const [wfAssign, setWfAssign] = useState('');

  // Inspection form
  const [inspType, setInspType] = useState('Final Inspection');
  const [inspDate, setInspDate] = useState('');
  const [inspWindow, setInspWindow] = useState('');
  const [inspInspector, setInspInspector] = useState('');
  const [inspNotes, setInspNotes] = useState('');
  const [openChecklistId, setOpenChecklistId] = useState(null);
  const [newCheckItem, setNewCheckItem] = useState('');

  // Fee ledger form
  const [feeType, setFeeType] = useState('fee');
  const [feeDesc, setFeeDesc] = useState('');
  const [feeAmt, setFeeAmt] = useState('');
  const [feeMethod, setFeeMethod] = useState('');
  const [feeRef, setFeeRef] = useState('');

  // Planning & Zoning state
  const [planForm, setPlanForm] = useState({
    complete_date: permit.planning_data?.complete_date || '',
    extended_60_days: Boolean(permit.planning_data?.extended_60_days),
    extension_notice_date: permit.planning_data?.extension_notice_date || '',
    zoning_district: permit.planning_data?.zoning_district || '',
    neighbor_notice_sent_date: permit.planning_data?.neighbor_notice_sent_date || '',
    planning_commission_date: permit.planning_data?.planning_commission_date || '',
    public_hearing_date: permit.planning_data?.public_hearing_date || '',
    council_hearing_date: permit.planning_data?.council_hearing_date || '',
    conditions_of_approval: permit.planning_data?.conditions_of_approval || '',
  });

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
    setExpiresAt(permit.expires_at || '');
    setNotes(permit.review_notes || '');
    setDetails({
      applicant_name: permit.applicant_name || '',
      applicant_email: permit.applicant_email || '',
      applicant_phone: permit.applicant_phone || '',
      property_address: permit.property_address || '',
      building_name: permit.building_name || '',
      suite_name: permit.suite_name || '',
      parcel_id: permit.parcel_id || '',
      owner_name: permit.owner_name || '',
      contractor_name: permit.contractor_name || '',
      contractor_license: permit.contractor_license || '',
      estimated_value: permit.estimated_value || '',
      project_description: permit.project_description || '',
      project_name: permit.project_name || '',
    });
    setCustomData(permit.custom_data || {});
    setPlanForm({
      complete_date: permit.planning_data?.complete_date || '',
      extended_60_days: Boolean(permit.planning_data?.extended_60_days),
      extension_notice_date: permit.planning_data?.extension_notice_date || '',
      zoning_district: permit.planning_data?.zoning_district || '',
      neighbor_notice_sent_date: permit.planning_data?.neighbor_notice_sent_date || '',
      planning_commission_date: permit.planning_data?.planning_commission_date || '',
      public_hearing_date: permit.planning_data?.public_hearing_date || '',
      council_hearing_date: permit.planning_data?.council_hearing_date || '',
      conditions_of_approval: permit.planning_data?.conditions_of_approval || '',
    });
    setEditingDetails(false);
    if ((permit.contractor_license || '').trim()) {
      api(`/api/permits/contractors/check?license=${encodeURIComponent(permit.contractor_license.trim())}`)
        .then(setContractorCheck)
        .catch(() => setContractorCheck(null));
    } else {
      setContractorCheck(null);
    }
  }, [permit]);

  useEffect(() => {
    api('/api/permits/public/catalog')
      .then((cat) => {
        const t = (cat.types || []).find((x) => x.id === permit.permit_type_id);
        setCustomFieldDefs(Array.isArray(t?.custom_fields) ? t.custom_fields : []);
      })
      .catch(() => {});
    api('/api/permits/link-candidates')
      .then((rows) => {
        setLinkCandidates((Array.isArray(rows) ? rows : []).filter((r) => r.id !== permit.id));
      })
      .catch(() => {});
    api('/api/payments/config')
      .then((cfg) => setPaymentsEnabled(Boolean(cfg?.enabled)))
      .catch(() => {});
  }, [permit.id, permit.permit_type_id]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sid = params.get('session_id');
    if (params.get('payment') === 'success' && sid) {
      api('/api/payments/verify-session', {
        method: 'POST',
        body: JSON.stringify({ session_id: sid }),
      })
        .then((res) => {
          if (res?.paid && res?.item_type === 'permit' && res?.item_id === permit.id) {
            showToast('Payment confirmed!', 'ok');
            api(`/api/permits/${permit.id}`).then((u) => onUpdated?.(u)).catch(() => {});
          }
          window.history.replaceState({}, '', window.location.pathname + window.location.hash);
        })
        .catch(() => {});
    }
  }, [permit.id, onUpdated, showToast]);

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
          <button
            type="button"
            className="btn sm"
            onClick={() => {
              try {
                sessionStorage.setItem('civicdesk_permit_prefill', JSON.stringify({
                  project_name: permit.project_name || `${permit.property_address || permit.permit_number} Project`,
                  property_address: permit.property_address || '',
                  parcel_id: permit.parcel_id || '',
                  owner_name: permit.owner_name || '',
                  applicant_name: permit.applicant_name || '',
                  applicant_email: permit.applicant_email || '',
                  applicant_phone: permit.applicant_phone || '',
                  prerequisite_permit_id: permit.id,
                }));
              } catch {}
              window.location.hash = '#permits-apply';
            }}
          >
            + Create Follow-Up Permit
          </button>
          <a className="btn sm primary" href={`/api/permits/${permit.id}/pdf`} target="_blank" rel="noreferrer">Permit PDF</a>
          <a className="btn sm" href={`/api/permits/${permit.id}/receipt`} target="_blank" rel="noreferrer">Receipt PDF</a>
          {(permit.status === 'issued' || permit.status === 'closed') && (
            <a
              className="btn sm"
              href={`/api/permits/${permit.id}/certificate-of-occupancy`}
              target="_blank"
              rel="noreferrer"
              title="Download Certificate of Occupancy / Completion (requires all active inspections passed)"
            >
              Certificate of Occupancy PDF
            </a>
          )}
        </div>
      </div>

      {(permit.unmet_prerequisites || []).length > 0 && (
        <div
          role="alert"
          style={{
            background: '#fffbeb',
            border: '1px solid #f59e0b',
            color: '#92400e',
            borderRadius: 8,
            padding: '.65rem .85rem',
            marginBottom: '.75rem',
            fontSize: '.88rem',
          }}
        >
          <strong>Prerequisite Permit Pending:</strong>{' '}
          {permit.unmet_prerequisites.map((p) => `${p.permit_number} (${p.permit_type_name} — ${p.status})`).join(', ')}.
          {' '}This permit depends on prerequisite approval before final issuance.
        </div>
      )}

      <div className="tabs">
        {[
          ['overview', 'Overview & Review'],
          ['planning', 'Planning & Zoning'],
          ['fees', `Fees & Escrow (${(permit.fee_entries || []).length})`],
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
              <div className="between" style={{ marginBottom: '.4rem' }}>
                <h3 style={{ margin: 0, fontSize: '.95rem' }}>
                  {permit.permit_kind === 'annual_license' ? 'License & Applicant Details' : 'Property & Applicant'}
                </h3>
                {isManager && (
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => setEditingDetails(v => !v)}
                  >
                    {editingDetails ? 'Cancel' : 'Edit Details'}
                  </button>
                )}
              </div>

              {editingDetails && isManager ? (
                <form
                  style={{ display: 'grid', gap: '.55rem' }}
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setBusy(true);
                    try {
                      const updated = await api(`/api/permits/${permit.id}`, {
                        method: 'PATCH',
                        body: JSON.stringify(details),
                      });
                      showToast(`Saved details for ${permit.permit_number}`, 'ok');
                      setEditingDetails(false);
                      onUpdated(updated);
                    } catch (err) {
                      showToast(err.message, 'error');
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <div className="field">
                    <label>Applicant Name *</label>
                    <input required value={details.applicant_name} onChange={(e) => setDetails(d => ({ ...d, applicant_name: e.target.value }))} />
                  </div>
                  <div className="row">
                    <div className="field" style={{ flex: 1 }}>
                      <label>Email</label>
                      <input type="email" value={details.applicant_email} onChange={(e) => setDetails(d => ({ ...d, applicant_email: e.target.value }))} />
                    </div>
                    <div className="field" style={{ flex: 1 }}>
                      <label>Phone</label>
                      <input value={details.applicant_phone} onChange={(e) => setDetails(d => ({ ...d, applicant_phone: e.target.value }))} />
                    </div>
                  </div>
                  <div className="field">
                    <label>{permit.permit_kind === 'annual_license' ? 'Location / Rack / Resident Address' : 'Land Address'}</label>
                    <input value={details.property_address} onChange={(e) => setDetails(d => ({ ...d, property_address: e.target.value }))} />
                  </div>
                  <div className="row">
                    <div className="field" style={{ flex: 1 }}>
                      <label>{permit.permit_kind === 'annual_license' ? 'Beach / Zone' : 'Building Name'}</label>
                      <input value={details.building_name} onChange={(e) => setDetails(d => ({ ...d, building_name: e.target.value }))} />
                    </div>
                    <div className="field" style={{ flex: 1 }}>
                      <label>{permit.permit_kind === 'annual_license' ? 'Rack / Slot / Tag #' : 'Suite / Unit ID'}</label>
                      <input value={details.suite_name} onChange={(e) => setDetails(d => ({ ...d, suite_name: e.target.value }))} />
                    </div>
                  </div>
                  {permit.permit_kind !== 'annual_license' && (
                    <>
                      <div className="row">
                        <div className="field" style={{ flex: 1 }}>
                          <label>Parcel ID</label>
                          <input value={details.parcel_id} onChange={(e) => setDetails(d => ({ ...d, parcel_id: e.target.value }))} />
                        </div>
                        <div className="field" style={{ flex: 1 }}>
                          <label>Owner Name</label>
                          <input value={details.owner_name} onChange={(e) => setDetails(d => ({ ...d, owner_name: e.target.value }))} />
                        </div>
                      </div>
                      <div className="row">
                        <div className="field" style={{ flex: 1 }}>
                          <label>Contractor Name</label>
                          <input value={details.contractor_name} onChange={(e) => setDetails(d => ({ ...d, contractor_name: e.target.value }))} />
                        </div>
                        <div className="field" style={{ flex: 1 }}>
                          <label>Contractor License #</label>
                          <input value={details.contractor_license} onChange={(e) => setDetails(d => ({ ...d, contractor_license: e.target.value }))} />
                        </div>
                      </div>
                      <div className="field">
                        <label>Estimated Value</label>
                        <input value={details.estimated_value} onChange={(e) => setDetails(d => ({ ...d, estimated_value: e.target.value }))} />
                      </div>
                    </>
                  )}
                  <div className="field">
                    <label>Project Name</label>
                    <input value={details.project_name} onChange={(e) => setDetails(d => ({ ...d, project_name: e.target.value }))} />
                  </div>
                  <div className="field">
                    <label>{permit.permit_kind === 'annual_license' ? 'Vessel / Item Details' : 'Project Description'}</label>
                    <textarea rows={3} value={details.project_description} onChange={(e) => setDetails(d => ({ ...d, project_description: e.target.value }))} />
                  </div>
                  <div className="actions">
                    <button type="submit" className="btn sm primary" disabled={busy}>Save Details</button>
                  </div>
                </form>
              ) : (
                <>
                  <div style={{ fontSize: '.9rem', lineHeight: 1.55 }}>
                    {permit.project_name && <div><strong>Project:</strong> {permit.project_name}</div>}
                    <div><strong>Applicant:</strong> {permit.applicant_name} ({permit.applicant_username || '—'})</div>
                    <div><strong>Contact:</strong> {permit.applicant_email || '—'} · {permit.applicant_phone || '—'}</div>
                    <div><strong>{permit.permit_kind === 'annual_license' ? 'Location:' : 'Location:'}</strong> {permit.property_address || '—'}</div>
                    {(permit.building_name || permit.suite_name) && (
                      <div>
                        <strong>{permit.permit_kind === 'annual_license' ? 'Beach / Rack / Tag:' : 'Building / Unit:'}</strong>{' '}
                        {permit.building_name || '—'} / {permit.suite_name || '—'}
                      </div>
                    )}
                    {permit.permit_kind !== 'annual_license' && (
                      <>
                        <div>
                          <strong>Parcel / Owner:</strong> {permit.parcel_id || '—'} / {permit.owner_name || '—'}
                          {isManager && (permit.parcel_id || permit.property_address) && (
                            <a
                              href={`#properties?parcel=${encodeURIComponent(permit.parcel_id || '')}&address=${encodeURIComponent(permit.property_address || '')}`}
                              style={{ marginLeft: '.5rem', fontSize: '.82rem' }}
                            >
                              Property 360° &rarr;
                            </a>
                          )}
                        </div>
                        <div>
                          <strong>Contractor:</strong> {permit.contractor_name || '—'} (Lic: {permit.contractor_license || '—'})
                          {contractorCheck?.matched && (
                            <span
                              className={`badge ${contractorCheck.compliant ? 'active' : 'disabled'}`}
                              style={{ marginLeft: '.45rem' }}
                              title={contractorCheck.issues?.join('; ') || 'Compliant'}
                            >
                              {contractorCheck.compliant ? 'Licensed & Insured' : `Compliance Blocked: ${contractorCheck.issues.join('; ')}`}
                            </span>
                          )}
                        </div>
                        <div><strong>Est. Value:</strong> {permit.estimated_value || '—'}</div>
                      </>
                    )}
                    <div><strong>Submitted:</strong> {formatDate(permit.created_at)}</div>
                    {permit.issued_at && <div><strong>Issued:</strong> {formatDate(permit.issued_at)}</div>}
                    {permit.closed_at && <div><strong>Closed:</strong> {formatDate(permit.closed_at)}</div>}
                  </div>
                  {permit.project_description && (
                    <div style={{ marginTop: '.65rem' }}>
                      <strong>{permit.permit_kind === 'annual_license' ? 'Vessel / Item Details:' : 'Project Description:'}</strong>
                      <p className="muted" style={{ margin: '.25rem 0 0' }}>{permit.project_description}</p>
                    </div>
                  )}
                </>
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
                          expires_at: expiresAt,
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
                  <div className="row" style={{ marginBottom: '.6rem' }}>
                    <div className="field" style={{ flex: 1 }}>
                      <label>Expiration Date (optional)</label>
                      <input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
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
                  {paymentsEnabled && permit.payment_status === 'unpaid' && /\d/.test(permit.fee_amount || '') && (
                    <div style={{ margin: '.45rem 0' }}>
                      <button
                        type="button"
                        className="btn sm primary"
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true);
                          try {
                            const res = await api('/api/payments/checkout', {
                              method: 'POST',
                              body: JSON.stringify({ item_type: 'permit', item_id: permit.id }),
                            });
                            if (res.checkout_url) window.location.href = res.checkout_url;
                          } catch (err) {
                            showToast(err.message, 'error');
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        Pay Fee Online ({permit.fee_amount})
                      </button>
                    </div>
                  )}
                  <div><strong>Assigned Reviewer:</strong> {permit.assigned_to || 'Unassigned'}</div>
                  {permit.expires_at && (() => {
                    const exp = permitExpiryInfo(permit.expires_at);
                    return (
                      <div>
                        <strong>Expires:</strong>{' '}
                        {exp && exp.cls !== 'muted'
                          ? <span className={exp.cls}>{exp.label}</span>
                          : permit.expires_at}
                      </div>
                    );
                  })()}
                  {permit.review_notes && (
                    <div style={{ marginTop: '.5rem', padding: '.5rem .65rem', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '6px' }}>
                      <strong>Staff Notes:</strong> {permit.review_notes}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {(customFieldDefs.length > 0 || Object.keys(customData || {}).length > 0) && (
            <div style={{ marginTop: '1.25rem', borderTop: '1px solid #e2e8f0', paddingTop: '1rem' }}>
              <div className="between" style={{ marginBottom: '.65rem' }}>
                <h3 style={{ margin: 0, fontSize: '1rem' }}>Supplemental Application Form</h3>
                {isManager && (
                  <button
                    type="button"
                    className="btn sm primary"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        const updated = await api(`/api/permits/${permit.id}`, {
                          method: 'PATCH',
                          body: JSON.stringify({ custom_data: customData }),
                        });
                        onUpdated?.(updated);
                        showToast('Application form responses saved', 'ok');
                      } catch (err) {
                        showToast(err.message, 'error');
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Save Form Responses
                  </button>
                )}
              </div>
              <CustomFieldsRenderer
                fields={
                  customFieldDefs.length > 0
                    ? customFieldDefs
                    : Object.keys(customData).map((k) => ({
                        key: k,
                        label: k.replace(/_/g, ' '),
                        type: typeof customData[k] === 'object' && customData[k] !== null && 'answer' in customData[k] ? 'yes_no_explain' : 'text',
                      }))
                }
                value={customData}
                onChange={setCustomData}
                readOnly={!isManager}
              />
            </div>
          )}

          <div style={{ marginTop: '1.25rem', borderTop: '1px solid #e2e8f0', paddingTop: '1rem' }}>
            <h3 style={{ margin: '0 0 .5rem', fontSize: '1rem' }}>Linked &amp; Prerequisite Permits</h3>
            {(permit.linked_permits || []).length === 0 ? (
              <p className="muted" style={{ margin: '0 0 .65rem', fontSize: '.88rem' }}>
                No linked permits yet. Link a prerequisite (e.g., Variance) or a follow-up permit for this project.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '.4rem', marginBottom: '.75rem' }}>
                {(permit.linked_permits || []).map((lp) => {
                  const dirLabel = lp.direction === 'prerequisite'
                    ? 'Prerequisite (Must Approve First)'
                    : lp.direction === 'enables'
                      ? 'Enables Follow-Up Permit'
                      : 'Related Project Permit';
                  return (
                    <div
                      key={lp.link_id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: '.5rem',
                        padding: '.45rem .65rem',
                        background: '#f8fafc',
                        border: '1px solid #e2e8f0',
                        borderRadius: 6,
                        fontSize: '.86rem',
                      }}
                    >
                      <div>
                        <span className="badge draft" style={{ marginRight: '.4rem' }}>{dirLabel}</span>
                        <strong>{lp.permit_number}</strong> — {lp.permit_type_name} ({lp.permit_use_name}){' '}
                        <span className={permitStatusBadge(lp.status)}>{lp.status.replace('_', ' ')}</span>
                        {lp.project_name && <span className="muted"> · {lp.project_name}</span>}
                      </div>
                      <button
                        type="button"
                        className="btn sm danger"
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true);
                          try {
                            const updated = await api(`/api/permits/${permit.id}/links/${lp.link_id}`, { method: 'DELETE' });
                            onUpdated?.(updated);
                            showToast('Link removed', 'ok');
                          } catch (err) {
                            showToast(err.message, 'error');
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        Unlink
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            <form
              className="row"
              style={{ alignItems: 'flex-end', gap: '.5rem' }}
              onSubmit={async (e) => {
                e.preventDefault();
                if (!linkTargetId) return;
                setBusy(true);
                try {
                  const updated = await api(`/api/permits/${permit.id}/links`, {
                    method: 'POST',
                    body: JSON.stringify({
                      related_permit_id: Number(linkTargetId),
                      relationship: linkRel,
                    }),
                  });
                  setLinkTargetId('');
                  onUpdated?.(updated);
                  showToast('Permits linked', 'ok');
                } catch (err) {
                  showToast(err.message, 'error');
                } finally {
                  setBusy(false);
                }
              }}
            >
              <div className="field" style={{ flex: 1, minWidth: 180 }}>
                <label>Relationship</label>
                <select value={linkRel} onChange={(e) => setLinkRel(e.target.value)}>
                  <option value="enabled_by">Requires Prerequisite Permit (e.g. Variance)</option>
                  <option value="enables">Enables Follow-Up Permit (e.g. Building Permit)</option>
                  <option value="related">Related Project Permit</option>
                </select>
              </div>
              <div className="field" style={{ flex: 2, minWidth: 220 }}>
                <label>Select Permit</label>
                <select value={linkTargetId} onChange={(e) => setLinkTargetId(e.target.value)}>
                  <option value="">Choose a permit...</option>
                  {linkCandidates.map((c) => (
                    <option key={c.id} value={String(c.id)}>
                      {c.permit_number} — {c.permit_type_name} ({c.status}){c.property_address ? ` @ ${c.property_address}` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <button type="submit" className="btn sm primary" disabled={busy || !linkTargetId}>
                + Link Permit
              </button>
            </form>
          </div>
        </div>
      )}

      {tab === 'planning' && (() => {
        const sc = permit.statutory_clock || {};
        const badgeBg = sc.urgency === 'overdue' ? '#fef2f2' : (sc.urgency === 'warning' ? '#fffbeb' : (sc.urgency === 'completed' || sc.urgency === 'ok' ? '#f0fdf4' : '#f8fafc'));
        const badgeBorder = sc.urgency === 'overdue' ? '#fca5a5' : (sc.urgency === 'warning' ? '#fcd34d' : '#cbd5e1');
        return (
          <div className="card">
            <div className="between" style={{ marginBottom: '.85rem', flexWrap: 'wrap', gap: '.5rem' }}>
              <h2 style={{ margin: 0 }}>Planning &amp; Zoning Case Tracking</h2>
              {isManager && (
                <button
                  type="button"
                  className="btn sm"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const updated = await api(`/api/permits/${permit.id}/push-to-agenda`, { method: 'POST' });
                      onUpdated(updated);
                      showToast('Hearing item added to Agenda Backlog', 'ok');
                    } catch (err) {
                      showToast(err.message, 'error');
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {permit.planning_data?.agenda_backlog_id
                    ? `In Agenda Backlog (#${permit.planning_data.agenda_backlog_id}) — Push Again`
                    : 'Send Hearing to Agenda Backlog'}
                </button>
              )}
            </div>

            <div style={{ padding: '.75rem 1rem', borderRadius: 8, border: `1px solid ${badgeBorder}`, background: badgeBg, marginBottom: '1rem' }}>
              <strong>Statutory Review Clock: </strong>
              {!sc.started ? (
                <span className="muted">Not started — set the Application Complete Date below to start the 60-day statutory review clock.</span>
              ) : (
                <span>
                  <strong>{sc.statutory_days}-Day Rule</strong> · Due <strong>{sc.deadline_date}</strong> ·{' '}
                  {sc.urgency === 'completed'
                    ? 'Decision Completed'
                    : sc.days_remaining < 0
                      ? <span style={{ color: '#b91c1c', fontWeight: 700 }}>OVERDUE by {Math.abs(sc.days_remaining)} day(s)</span>
                      : `${sc.days_remaining} day(s) remaining`}
                </span>
              )}
            </div>

            {isManager ? (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setBusy(true);
                  try {
                    const updated = await api(`/api/permits/${permit.id}`, {
                      method: 'PATCH',
                      body: JSON.stringify({
                        planning_data: {
                          ...planForm,
                          agenda_backlog_id: permit.planning_data?.agenda_backlog_id || undefined,
                        },
                      }),
                    });
                    onUpdated(updated);
                    showToast('Planning & Zoning details saved', 'ok');
                  } catch (err) {
                    showToast(err.message, 'error');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <div className="row" style={{ marginBottom: '.75rem' }}>
                  <div className="field" style={{ flex: 1, minWidth: 160 }}>
                    <label>Application Complete Date (Starts 60-Day Clock)</label>
                    <input type="date" value={planForm.complete_date} onChange={(e) => setPlanForm((f) => ({ ...f, complete_date: e.target.value }))} />
                  </div>
                  <div className="field" style={{ flex: 1, minWidth: 180 }}>
                    <label>Zoning District</label>
                    <input placeholder="e.g. R-1 Shoreland Residential" value={planForm.zoning_district} onChange={(e) => setPlanForm((f) => ({ ...f, zoning_district: e.target.value }))} />
                  </div>
                  <div className="field" style={{ flex: 1, minWidth: 160 }}>
                    <label>Abutting Neighbor Notice Sent</label>
                    <input type="date" value={planForm.neighbor_notice_sent_date} onChange={(e) => setPlanForm((f) => ({ ...f, neighbor_notice_sent_date: e.target.value }))} />
                  </div>
                </div>

                <div className="row" style={{ marginBottom: '.75rem' }}>
                  <div className="field" style={{ flex: 1, minWidth: 160 }}>
                    <label>Planning Commission Date</label>
                    <input type="date" value={planForm.planning_commission_date} onChange={(e) => setPlanForm((f) => ({ ...f, planning_commission_date: e.target.value }))} />
                  </div>
                  <div className="field" style={{ flex: 1, minWidth: 160 }}>
                    <label>Public Hearing Date</label>
                    <input type="date" value={planForm.public_hearing_date} onChange={(e) => setPlanForm((f) => ({ ...f, public_hearing_date: e.target.value }))} />
                  </div>
                  <div className="field" style={{ flex: 1, minWidth: 160 }}>
                    <label>City Council Action Date</label>
                    <input type="date" value={planForm.council_hearing_date} onChange={(e) => setPlanForm((f) => ({ ...f, council_hearing_date: e.target.value }))} />
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '.75rem' }}>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem', cursor: 'pointer', fontSize: '.9rem' }}>
                    <input
                      type="checkbox"
                      style={{ width: 'auto', flexShrink: 0 }}
                      checked={planForm.extended_60_days}
                      onChange={(e) => setPlanForm((f) => ({ ...f, extended_60_days: e.target.checked }))}
                    />
                    <span>60-Day Statutory Extension Notice Sent (120-Day Total)</span>
                  </label>
                  {planForm.extended_60_days && (
                    <div className="field" style={{ width: 170 }}>
                      <label>Extension Notice Date</label>
                      <input type="date" value={planForm.extension_notice_date} onChange={(e) => setPlanForm((f) => ({ ...f, extension_notice_date: e.target.value }))} />
                    </div>
                  )}
                </div>

                <div className="field" style={{ marginBottom: '.75rem' }}>
                  <label>Conditions of Approval / Findings</label>
                  <textarea
                    rows={3}
                    placeholder="Record conditions attached to Variance, CUP, or Site Plan approval..."
                    value={planForm.conditions_of_approval}
                    onChange={(e) => setPlanForm((f) => ({ ...f, conditions_of_approval: e.target.value }))}
                  />
                </div>

                <button type="submit" className="btn primary" disabled={busy}>Save Planning &amp; Zoning</button>
              </form>
            ) : (
              <div style={{ fontSize: '.9rem', lineHeight: 1.6 }}>
                <div><strong>Zoning District:</strong> {planForm.zoning_district || '—'}</div>
                <div><strong>Application Complete Date:</strong> {planForm.complete_date || '—'}</div>
                <div><strong>Planning Commission Date:</strong> {planForm.planning_commission_date || '—'}</div>
                <div><strong>Public Hearing Date:</strong> {planForm.public_hearing_date || '—'}</div>
                <div><strong>City Council Date:</strong> {planForm.council_hearing_date || '—'}</div>
                {planForm.conditions_of_approval && (
                  <div style={{ marginTop: '.5rem' }}>
                    <strong>Conditions of Approval:</strong>
                    <p className="muted" style={{ margin: '.25rem 0 0' }}>{planForm.conditions_of_approval}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {tab === 'fees' && (() => {
        const fs = permit.fee_summary || {};
        const entries = permit.fee_entries || [];
        const fmt = (c) => `$${((Number(c) || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        return (
          <div className="card">
            <div className="between" style={{ marginBottom: '.85rem', flexWrap: 'wrap', gap: '.5rem' }}>
              <h2 style={{ margin: 0 }}>Itemized Fee &amp; Escrow Ledger</h2>
              <a className="btn sm" href={`/api/permits/${permit.id}/receipt`} target="_blank" rel="noreferrer">
                Download Receipt PDF
              </a>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '.65rem', marginBottom: '1rem' }}>
              <div style={{ padding: '.65rem .8rem', border: '1px solid #e2e8f0', borderRadius: 8, background: '#f8fafc' }}>
                <div className="muted" style={{ fontSize: '.78rem' }}>Fees Assessed</div>
                <strong style={{ fontSize: '1.1rem' }}>{fmt(fs.fees_assessed_cents)}</strong>
              </div>
              <div style={{ padding: '.65rem .8rem', border: '1px solid #e2e8f0', borderRadius: 8, background: '#f8fafc' }}>
                <div className="muted" style={{ fontSize: '.78rem' }}>Payments &amp; Waivers</div>
                <strong style={{ fontSize: '1.1rem' }}>{fmt((fs.payments_cents || 0) + (fs.waivers_cents || 0))}</strong>
              </div>
              <div style={{ padding: '.65rem .8rem', border: '1px solid #e2e8f0', borderRadius: 8, background: (fs.balance_due_cents || 0) > 0 ? '#fffbeb' : '#f0fdf4' }}>
                <div className="muted" style={{ fontSize: '.78rem' }}>Balance Due</div>
                <strong style={{ fontSize: '1.1rem' }}>{fmt(fs.balance_due_cents)}</strong>
              </div>
              <div style={{ padding: '.65rem .8rem', border: '1px solid #e2e8f0', borderRadius: 8, background: '#eff6ff' }}>
                <div className="muted" style={{ fontSize: '.78rem' }}>Escrow Held</div>
                <strong style={{ fontSize: '1.1rem' }}>{fmt(fs.escrow_held_cents)}</strong>
              </div>
            </div>

            {isManager && (
              <form
                className="row"
                style={{ marginBottom: '1rem', alignItems: 'flex-end' }}
                onSubmit={async (e) => {
                  e.preventDefault();
                  const amt = parseFloat(feeAmt);
                  if (!feeDesc.trim() || Number.isNaN(amt) || amt <= 0) return;
                  setBusy(true);
                  try {
                    const updated = await api(`/api/permits/${permit.id}/fees`, {
                      method: 'POST',
                      body: JSON.stringify({
                        entry_type: feeType,
                        description: feeDesc.trim(),
                        amount_dollars: amt,
                        payment_method: feeMethod.trim(),
                        reference_number: feeRef.trim(),
                      }),
                    });
                    setFeeDesc(''); setFeeAmt(''); setFeeMethod(''); setFeeRef('');
                    onUpdated(updated);
                    showToast('Ledger entry recorded', 'ok');
                  } catch (err) {
                    showToast(err.message, 'error');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <div className="field" style={{ minWidth: 150 }}>
                  <label>Entry Type</label>
                  <select value={feeType} onChange={(e) => setFeeType(e.target.value)}>
                    <option value="fee">Fee Assessed</option>
                    <option value="payment">Payment Received</option>
                    <option value="escrow_deposit">Escrow Deposit</option>
                    <option value="escrow_refund">Escrow Refund / Release</option>
                    <option value="waiver">Fee Waiver / Credit</option>
                  </select>
                </div>
                <div className="field" style={{ flex: 2, minWidth: 180 }}>
                  <label>Description</label>
                  <input required placeholder="e.g. Application Fee, Escrow Deposit, Check Payment" value={feeDesc} onChange={(e) => setFeeDesc(e.target.value)} />
                </div>
                <div className="field" style={{ width: 110 }}>
                  <label>Amount ($)</label>
                  <input required type="number" step="0.01" min="0.01" placeholder="150.00" value={feeAmt} onChange={(e) => setFeeAmt(e.target.value)} />
                </div>
                <div className="field" style={{ minWidth: 120 }}>
                  <label>Method</label>
                  <input placeholder="Check / Card" value={feeMethod} onChange={(e) => setFeeMethod(e.target.value)} />
                </div>
                <div className="field" style={{ minWidth: 120 }}>
                  <label>Ref / Check #</label>
                  <input placeholder="Ref #" value={feeRef} onChange={(e) => setFeeRef(e.target.value)} />
                </div>
                <button type="submit" className="btn sm primary" disabled={busy}>+ Add Entry</button>
              </form>
            )}

            {!entries.length ? (
              <p className="muted">No itemized fee or escrow entries recorded yet.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Description</th>
                    <th>Method / Ref</th>
                    <th style={{ textAlign: 'right' }}>Amount</th>
                    {isManager && <th>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {entries.map((fe) => (
                    <tr key={fe.id}>
                      <td>{formatDate(fe.created_at)}</td>
                      <td><span className="badge draft">{fe.entry_type.replace('_', ' ')}</span></td>
                      <td>{fe.description}</td>
                      <td className="muted">{[fe.payment_method, fe.reference_number].filter(Boolean).join(' · ') || '—'}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmt(fe.amount_cents)}</td>
                      {isManager && (
                        <td>
                          <button
                            type="button"
                            className="btn sm danger"
                            onClick={async () => onUpdated(await api(`/api/permits/${permit.id}/fees/${fe.id}`, { method: 'DELETE' }))}
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
        );
      })()}

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
          <h2>Inspections &amp; Field Checklists</h2>
          {!isManager && permit.status !== 'approved' && permit.status !== 'issued' ? (
            <p className="muted" style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '.6rem .8rem', marginBottom: '1rem' }}>
              Self-service inspection scheduling opens once your permit is <strong>Approved</strong> or <strong>Issued</strong>.
            </p>
          ) : (
            <form
              className="row"
              style={{ marginBottom: '1rem', alignItems: 'flex-end' }}
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  const updated = await api(`/api/permits/${permit.id}/inspections`, {
                    method: 'POST',
                    body: JSON.stringify({
                      inspection_type: inspType.trim(),
                      scheduled_date: inspDate,
                      requested_window: inspWindow,
                      inspector: inspInspector.trim(),
                      notes: inspNotes.trim(),
                    }),
                  });
                  setInspDate(''); setInspWindow(''); setInspNotes('');
                  showToast('Inspection scheduled with field checklist', 'ok');
                  onUpdated(updated);
                } catch (err) {
                  showToast(err.message, 'error');
                }
              }}
            >
              <div className="field" style={{ flex: 2, minWidth: '180px' }}>
                <label>Inspection Type</label>
                <input
                  list="civicdesk-insp-types"
                  required
                  placeholder="e.g. Footing, Framing, Electrical, Final Inspection"
                  value={inspType}
                  onChange={(e) => setInspType(e.target.value)}
                />
                <datalist id="civicdesk-insp-types">
                  <option value="Footing Inspection" />
                  <option value="Framing Inspection" />
                  <option value="Electrical Rough / Final" />
                  <option value="Plumbing Rough / Final" />
                  <option value="Erosion Control Inspection" />
                  <option value="Final Inspection" />
                </datalist>
              </div>
              <div className="field">
                <label>Requested / Scheduled Date</label>
                <input type="date" value={inspDate} onChange={(e) => setInspDate(e.target.value)} />
              </div>
              <div className="field">
                <label>Preferred Window</label>
                <select value={inspWindow} onChange={(e) => setInspWindow(e.target.value)}>
                  <option value="">Anytime</option>
                  <option value="AM (8am–12pm)">AM (8am–12pm)</option>
                  <option value="PM (12pm–4pm)">PM (12pm–4pm)</option>
                </select>
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
          )}

          {!inspections.length ? (
            <p className="muted">No inspections scheduled yet.</p>
          ) : (
            <table>
              <thead>
                <tr><th>Inspection</th><th>Date &amp; Window</th><th>Inspector</th><th>Checklist</th><th>Result</th><th>Notes</th>{isManager && <th>Actions</th>}</tr>
              </thead>
              <tbody>
                {inspections.map((ins) => {
                  const cl = Array.isArray(ins.checklist) ? ins.checklist : [];
                  const passedCount = cl.filter((c) => c.status === 'pass' || c.status === 'na').length;
                  const failedCount = cl.filter((c) => c.status === 'fail').length;
                  const isOpen = openChecklistId === ins.id;
                  return (
                    <React.Fragment key={ins.id}>
                      <tr>
                        <td><strong>{ins.inspection_type}</strong></td>
                        <td>
                          <div>{ins.scheduled_date || 'TBD'}</div>
                          {ins.requested_window && <div className="muted" style={{ fontSize: '.78rem' }}>{ins.requested_window}</div>}
                        </td>
                        <td>{ins.inspector || '—'}</td>
                        <td>
                          <button
                            type="button"
                            className="btn sm"
                            onClick={() => setOpenChecklistId(isOpen ? null : ins.id)}
                          >
                            {isOpen ? 'Hide' : 'Checklist'} ({passedCount}/{cl.length}{failedCount > 0 ? `, ${failedCount} fail` : ''})
                          </button>
                        </td>
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
                      {isOpen && (
                        <tr>
                          <td colSpan={isManager ? 7 : 6} style={{ background: '#f8fafc', padding: '.75rem 1rem' }}>
                            <strong style={{ display: 'block', marginBottom: '.4rem', fontSize: '.88rem' }}>
                              Field Checklist — {ins.inspection_type}
                            </strong>
                            {cl.length === 0 ? (
                              <p className="muted" style={{ margin: '0 0 .5rem' }}>No checklist items yet.</p>
                            ) : (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '.4rem', marginBottom: '.65rem' }}>
                                {cl.map((ci, idx) => (
                                  <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap', fontSize: '.86rem' }}>
                                    <span style={{ flex: 2, minWidth: 220 }}>{ci.item}</span>
                                    {isManager ? (
                                      <>
                                        <select
                                          className="btn sm"
                                          style={{ width: 'auto' }}
                                          value={ci.status || 'pending'}
                                          onChange={async (e) => {
                                            const next = cl.map((x, j) => (j === idx ? { ...x, status: e.target.value } : x));
                                            onUpdated(await api(`/api/permits/${permit.id}/inspections/${ins.id}`, {
                                              method: 'PATCH',
                                              body: JSON.stringify({ checklist: next }),
                                            }));
                                          }}
                                        >
                                          <option value="pending">Pending</option>
                                          <option value="pass">Pass</option>
                                          <option value="fail">Fail</option>
                                          <option value="na">N/A</option>
                                        </select>
                                        <input
                                          style={{ flex: 1, minWidth: 140 }}
                                          placeholder="Field note (optional)"
                                          defaultValue={ci.note || ''}
                                          onBlur={async (e) => {
                                            if ((e.target.value || '') === (ci.note || '')) return;
                                            const next = cl.map((x, j) => (j === idx ? { ...x, note: e.target.value } : x));
                                            onUpdated(await api(`/api/permits/${permit.id}/inspections/${ins.id}`, {
                                              method: 'PATCH',
                                              body: JSON.stringify({ checklist: next }),
                                            }));
                                          }}
                                        />
                                      </>
                                    ) : (
                                      <span className={`badge ${ci.status === 'pass' ? 'active' : (ci.status === 'fail' ? 'disabled' : 'draft')}`}>
                                        {ci.status || 'pending'}
                                      </span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                            {isManager && (
                              <form
                                style={{ display: 'flex', gap: '.4rem', alignItems: 'center' }}
                                onSubmit={async (e) => {
                                  e.preventDefault();
                                  if (!newCheckItem.trim()) return;
                                  const next = [...cl, { item: newCheckItem.trim(), status: 'pending', note: '' }];
                                  setNewCheckItem('');
                                  onUpdated(await api(`/api/permits/${permit.id}/inspections/${ins.id}`, {
                                    method: 'PATCH',
                                    body: JSON.stringify({ checklist: next }),
                                  }));
                                }}
                              >
                                <input
                                  placeholder="Add custom checklist item…"
                                  value={newCheckItem}
                                  onChange={(e) => setNewCheckItem(e.target.value)}
                                  style={{ flex: 1 }}
                                />
                                <button type="submit" className="btn sm">+ Add Item</button>
                              </form>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
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
