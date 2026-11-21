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

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ROLE_LABELS, api, formatDate, formatTime12h } from './api.js';
import { useToast } from './toast.jsx';

const TOPIC_LABELS = {
  agendas: 'Meeting Agendas & Minutes',
  notices: 'Public Notices & News',
  bids: 'Bids, RFPs & Solicitations',
  jobs: 'Job Postings',
  calendar: 'City Calendar & Events',
  permits: 'Permits & Code Updates',
  records: 'Public Records',
};

function statusBadge(status) {
  const s = String(status || '').toLowerCase();
  let cls = 'badge';
  if (['approved', 'issued', 'completed', 'fulfilled', 'resolved', 'closed', 'passed', 'paid'].includes(s)) {
    cls = 'badge published';
  } else if (['denied', 'rejected', 'cancelled', 'failed', 'expired', 'dismissed'].includes(s)) {
    cls = 'badge';
  } else if (['pending', 'submitted', 'under_review', 'in_progress', 'scheduled', 'new', 'draft'].includes(s)) {
    cls = 'badge draft';
  }
  return <span className={cls}>{status || '—'}</span>;
}

function hasPayableFee(feeText) {
  const m = String(feeText || '').replace(/,/g, '').match(/([0-9]+(?:\.[0-9]{1,2})?)/);
  return !!(m && parseFloat(m[1]) > 0);
}

export default function MyAccountPage({ me, onNavigate }) {
  const showToast = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('all');
  const [emailInput, setEmailInput] = useState('');
  const [editingEmail, setEditingEmail] = useState(false);
  const [savingEmail, setSavingEmail] = useState(false);
  const [payingKey, setPayingKey] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api('/api/my-account/summary');
      setData(res);
      setEmailInput(res?.user?.email || '');
    } catch (err) {
      showToast(err.message || 'Failed to load account summary', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    load();
  }, [load]);

  const unpaidItems = useMemo(() => {
    if (!data) return [];
    const items = [];
    for (const p of (data.permits || [])) {
      if (p.payment_status !== 'paid' && hasPayableFee(p.fee_amount)) {
        items.push({
          key: `permit-${p.id}`,
          item_type: 'permit',
          item_id: p.id,
          label: `Permit ${p.permit_number}`,
          detail: `${p.permit_type_name}${p.property_address ? ` — ${p.property_address}` : ''}`,
          fee_amount: p.fee_amount,
        });
      }
    }
    for (const r of (data.reservations || [])) {
      if (r.payment_status !== 'paid' && r.status !== 'cancelled' && hasPayableFee(r.fee_amount)) {
        items.push({
          key: `reservation-${r.id}`,
          item_type: 'reservation',
          item_id: r.id,
          label: `Reservation ${r.reservation_number}`,
          detail: `${r.facility_name} on ${formatDate(r.event_date)}`,
          fee_amount: r.fee_amount,
        });
      }
    }
    for (const b of (data.bills || [])) {
      if (b.payment_status === 'unpaid' && hasPayableFee(b.amount_due)) {
        items.push({
          key: `bill-${b.id}`,
          item_type: 'bill',
          item_id: b.id,
          label: `${b.bill_type.toUpperCase()} ${b.reference_number}`,
          detail: b.description || b.service_address || (b.account_number ? `Account ${b.account_number}` : ''),
          fee_amount: b.amount_due,
        });
      }
    }
    return items;
  }, [data]);

  const handlePayOnline = async (item) => {
    setPayingKey(item.key);
    try {
      const res = await api('/api/payments/checkout', {
        method: 'POST',
        body: JSON.stringify({ item_type: item.item_type, item_id: item.item_id }),
      });
      if (res?.checkout_url) {
        window.location.href = res.checkout_url;
      } else {
        showToast('Unable to start online checkout', 'error');
      }
    } catch (err) {
      showToast(err.message || 'Payment checkout failed', 'error');
    } finally {
      setPayingKey('');
    }
  };

  const handleSaveEmail = async (e) => {
    e.preventDefault();
    setSavingEmail(true);
    try {
      await api('/api/my-account/profile', {
        method: 'PUT',
        body: JSON.stringify({ email: emailInput.trim() }),
      });
      showToast('Profile email updated', 'success');
      setEditingEmail(false);
      await load();
    } catch (err) {
      showToast(err.message || 'Failed to update email', 'error');
    } finally {
      setSavingEmail(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="card">
        <h1>My Civic Account</h1>
        <p className="muted">Loading your activity…</p>
      </div>
    );
  }

  const user = data?.user || me || {};
  const counts = data?.counts || {};
  const enabled = new Set(data?.enabled_modules || []);
  const permits = data?.permits || [];
  const inspections = data?.inspections || [];
  const complaints = data?.complaints || [];
  const reservations = data?.reservations || [];
  const recordsRequests = data?.records_requests || [];
  const formSubmissions = data?.form_submissions || [];
  const subscriptions = data?.subscriptions || [];
  const bills = data?.bills || [];

  return (
    <div>
      <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ marginBottom: '.25rem' }}>My Civic Account</h1>
          <div className="muted" style={{ fontSize: '.9rem' }}>
            Signed in as <strong>{user.username}</strong> ({ROLE_LABELS[user.role] || user.role})
            {user.email ? <> &middot; <span>{user.email}</span></> : <> &middot; <em>No email on file</em></>}
          </div>
          {!user.email && (
            <div style={{ marginTop: '.4rem', fontSize: '.85rem', color: '#92400e', background: '#fef3c7', padding: '.35rem .6rem', borderRadius: '6px', display: 'inline-block' }}>
              Add your email address to automatically link your facility reservations, FOIA requests, form submissions, and alert subscriptions.
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" className="btn sm" onClick={() => setEditingEmail(v => !v)}>
            {editingEmail ? 'Cancel' : (user.email ? 'Update Email' : 'Add Email')}
          </button>
          <button type="button" className="btn sm" onClick={load} disabled={loading}>
            Refresh
          </button>
        </div>
      </div>

      {editingEmail && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Account Contact Email</h2>
          <form onSubmit={handleSaveEmail} className="row" style={{ gap: '.5rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div className="field" style={{ flex: 1, minWidth: 240, marginBottom: 0 }}>
              <label htmlFor="my-account-email">Email address</label>
              <input
                id="my-account-email"
                type="email"
                value={emailInput}
                onChange={e => setEmailInput(e.target.value)}
                placeholder="you@example.com"
              />
            </div>
            <button type="submit" className="btn primary" disabled={savingEmail}>
              {savingEmail ? 'Saving…' : 'Save Email'}
            </button>
          </form>
        </div>
      )}

      {unpaidItems.length > 0 && (
        <div className="card" style={{ borderLeft: '4px solid #d97706', background: '#fffbeb' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '.5rem', marginBottom: '.5rem' }}>
            <h2 style={{ margin: 0, color: '#92400e' }}>Action Required: Unpaid Fees ({unpaidItems.length})</h2>
          </div>
          <div style={{ display: 'grid', gap: '.5rem' }}>
            {unpaidItems.map(item => (
              <div
                key={item.key}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '.5rem',
                  background: '#fff',
                  padding: '.6rem .8rem',
                  borderRadius: '6px',
                  border: '1px solid #fde68a',
                }}
              >
                <div>
                  <strong>{item.label}</strong> &middot; <span className="muted">{item.detail}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem' }}>
                  <strong>{item.fee_amount}</strong>
                  {data?.stripe_enabled ? (
                    <button
                      type="button"
                      className="btn sm primary"
                      disabled={payingKey === item.key}
                      onClick={() => handlePayOnline(item)}
                    >
                      {payingKey === item.key ? 'Redirecting…' : 'Pay Online'}
                    </button>
                  ) : (
                    <span className="muted" style={{ fontSize: '.82rem' }}>Pay at City Hall</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(155px, 1fr))',
          gap: '.75rem',
          marginBottom: '1rem',
        }}
      >
        {enabled.has('permits') && (
          <button type="button" className="card" style={{ marginBottom: 0, cursor: 'pointer', textAlign: 'left', width: '100%' }} onClick={() => setTab('permits')}>
            <div className="muted" style={{ fontSize: '.8rem' }}>Open Permits</div>
            <div style={{ fontSize: '1.6rem', fontWeight: 700 }}>{counts.open_permits ?? 0}</div>
            <div className="muted" style={{ fontSize: '.78rem' }}>{counts.total_permits ?? 0} total</div>
          </button>
        )}
        {enabled.has('permits') && (
          <button type="button" className="card" style={{ marginBottom: 0, cursor: 'pointer', textAlign: 'left', width: '100%' }} onClick={() => setTab('permits')}>
            <div className="muted" style={{ fontSize: '.8rem' }}>Upcoming Inspections</div>
            <div style={{ fontSize: '1.6rem', fontWeight: 700 }}>{counts.upcoming_inspections ?? 0}</div>
            <div className="muted" style={{ fontSize: '.78rem' }}>{inspections.length} total</div>
          </button>
        )}
        {enabled.has('complaints') && (
          <button type="button" className="card" style={{ marginBottom: 0, cursor: 'pointer', textAlign: 'left', width: '100%' }} onClick={() => setTab('complaints')}>
            <div className="muted" style={{ fontSize: '.8rem' }}>Open 311 Requests</div>
            <div style={{ fontSize: '1.6rem', fontWeight: 700 }}>{counts.open_complaints ?? 0}</div>
            <div className="muted" style={{ fontSize: '.78rem' }}>{counts.total_complaints ?? 0} total</div>
          </button>
        )}
        {enabled.has('calendar') && (
          <button type="button" className="card" style={{ marginBottom: 0, cursor: 'pointer', textAlign: 'left', width: '100%' }} onClick={() => setTab('reservations')}>
            <div className="muted" style={{ fontSize: '.8rem' }}>Facility Bookings</div>
            <div style={{ fontSize: '1.6rem', fontWeight: 700 }}>{counts.reservations ?? 0}</div>
            <div className="muted" style={{ fontSize: '.78rem' }}>By account email</div>
          </button>
        )}
        {enabled.has('records') && (
          <button type="button" className="card" style={{ marginBottom: 0, cursor: 'pointer', textAlign: 'left', width: '100%' }} onClick={() => setTab('records')}>
            <div className="muted" style={{ fontSize: '.8rem' }}>FOIA Requests</div>
            <div style={{ fontSize: '1.6rem', fontWeight: 700 }}>{counts.records_requests ?? 0}</div>
            <div className="muted" style={{ fontSize: '.78rem' }}>By account email</div>
          </button>
        )}
        <button type="button" className="card" style={{ marginBottom: 0, cursor: 'pointer', textAlign: 'left', width: '100%' }} onClick={() => setTab('bills')}>
          <div className="muted" style={{ fontSize: '.8rem' }}>Bills &amp; Citations</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 700 }}>{counts.bills ?? 0}</div>
          <div className="muted" style={{ fontSize: '.78rem' }}>By account email</div>
        </button>
        <button type="button" className="card" style={{ marginBottom: 0, cursor: 'pointer', textAlign: 'left', width: '100%' }} onClick={() => setTab('forms')}>
          <div className="muted" style={{ fontSize: '.8rem' }}>Forms &amp; Alerts</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 700 }}>
            {(counts.form_submissions ?? 0) + (counts.subscriptions ?? 0)}
          </div>
          <div className="muted" style={{ fontSize: '.78rem' }}>
            {counts.form_submissions ?? 0} forms &middot; {counts.subscriptions ?? 0} alerts
          </div>
        </button>
      </div>

      <div className="card" style={{ padding: '.6rem .8rem' }}>
        <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
            {[
              ['all', 'All Activity'],
              ...(enabled.has('permits') ? [['permits', `Permits & Inspections (${permits.length})`]] : []),
              ...(enabled.has('complaints') ? [['complaints', `311 & Complaints (${complaints.length})`]] : []),
              ...(enabled.has('calendar') ? [['reservations', `Reservations (${reservations.length})`]] : []),
              ...(enabled.has('records') ? [['records', `FOIA Requests (${recordsRequests.length})`]] : []),
              ['bills', `Bills & Citations (${bills.length})`],
              ['forms', `Forms & Alerts (${formSubmissions.length + subscriptions.length})`],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`btn sm${tab === id ? ' primary' : ''}`}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
            {enabled.has('permits') && (
              <button type="button" className="btn sm" onClick={() => onNavigate('permits-apply')}>
                + Apply for Permit
              </button>
            )}
            {enabled.has('complaints') && (
              <a className="btn sm" href="/complaints">+ File 311 Request</a>
            )}
            {enabled.has('calendar') && (
              <a className="btn sm" href="/calendar">Reserve Facility</a>
            )}
          </div>
        </div>
      </div>

      {(tab === 'all' || tab === 'permits') && enabled.has('permits') && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '.5rem' }}>
            <h2 style={{ marginTop: 0 }}>My Permits ({permits.length})</h2>
            <button type="button" className="btn sm" onClick={() => onNavigate('my-permits')}>
              Open Full Permits View →
            </button>
          </div>
          {permits.length === 0 ? (
            <p className="muted">No permit applications found for your account.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>Permit #</th>
                    <th>Type</th>
                    <th>Address</th>
                    <th>Status</th>
                    <th>Fee</th>
                    <th>Submitted</th>
                  </tr>
                </thead>
                <tbody>
                  {permits.map(p => (
                    <tr key={p.id}>
                      <td><strong>{p.permit_number}</strong></td>
                      <td>{p.permit_type_name}{p.permit_use_name ? ` — ${p.permit_use_name}` : ''}</td>
                      <td>{p.property_address || '—'}</td>
                      <td>{statusBadge(p.status)}</td>
                      <td>
                        {p.fee_amount || '—'}{' '}
                        {hasPayableFee(p.fee_amount) && statusBadge(p.payment_status)}
                      </td>
                      <td>{formatDate(p.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {inspections.length > 0 && (
            <div style={{ marginTop: '1rem' }}>
              <h3>Scheduled &amp; Recent Inspections ({inspections.length})</h3>
              <div style={{ overflowX: 'auto' }}>
                <table>
                  <thead>
                    <tr>
                      <th>Permit #</th>
                      <th>Inspection</th>
                      <th>Date / Time</th>
                      <th>Inspector</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inspections.map(ins => (
                      <tr key={ins.id}>
                        <td><strong>{ins.permit_number}</strong></td>
                        <td>{ins.inspection_type}</td>
                        <td>
                          {ins.scheduled_date ? formatDate(ins.scheduled_date) : 'TBD'}
                          {ins.scheduled_time ? ` (${ins.scheduled_time})` : ''}
                        </td>
                        <td>{ins.inspector_name || '—'}</td>
                        <td>{statusBadge(ins.status)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {(tab === 'all' || tab === 'complaints') && enabled.has('complaints') && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '.5rem' }}>
            <h2 style={{ marginTop: 0 }}>My 311 &amp; Code Complaints ({complaints.length})</h2>
            <button type="button" className="btn sm" onClick={() => onNavigate('my-complaints')}>
              Open Full Complaints View →
            </button>
          </div>
          {complaints.length === 0 ? (
            <p className="muted">No complaints submitted under your account.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>Ticket #</th>
                    <th>Category</th>
                    <th>Address</th>
                    <th>Status</th>
                    <th>Filed</th>
                  </tr>
                </thead>
                <tbody>
                  {complaints.map(c => (
                    <tr key={c.id}>
                      <td><strong>{c.complaint_number}</strong></td>
                      <td>{c.category || '—'}</td>
                      <td>{c.property_address || '—'}</td>
                      <td>{statusBadge(c.status)}</td>
                      <td>{formatDate(c.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {(tab === 'all' || tab === 'reservations') && enabled.has('calendar') && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '.5rem' }}>
            <h2 style={{ marginTop: 0 }}>My Facility Reservations ({reservations.length})</h2>
            <a className="btn sm" href="/calendar">Browse City Calendar →</a>
          </div>
          {reservations.length === 0 ? (
            <p className="muted">
              {user.email
                ? `No facility reservations found for ${user.email}.`
                : 'Add an email address above to see facility reservations matched to your email.'}
            </p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>Confirmation #</th>
                    <th>Facility</th>
                    <th>Event</th>
                    <th>Date &amp; Time</th>
                    <th>Status</th>
                    <th>Fee</th>
                  </tr>
                </thead>
                <tbody>
                  {reservations.map(r => (
                    <tr key={r.id}>
                      <td><strong>{r.reservation_number}</strong></td>
                      <td>{r.facility_name}</td>
                      <td>{r.event_title || '—'}</td>
                      <td>
                        {formatDate(r.event_date)}
                        {r.rental_mode === 'hourly' && r.start_time ? ` (${formatTime12h(r.start_time)}–${formatTime12h(r.end_time)})` : ' (Full Day)'}
                      </td>
                      <td>{statusBadge(r.status)}</td>
                      <td>
                        {r.fee_amount || 'Free'}{' '}
                        {hasPayableFee(r.fee_amount) && statusBadge(r.payment_status)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {(tab === 'all' || tab === 'records') && enabled.has('records') && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '.5rem' }}>
            <h2 style={{ marginTop: 0 }}>My FOIA / Public Records Requests ({recordsRequests.length})</h2>
            <a className="btn sm" href="/records">Submit New Request →</a>
          </div>
          {recordsRequests.length === 0 ? (
            <p className="muted">
              {user.email
                ? `No FOIA / public records requests found for ${user.email}.`
                : 'Add an email address above to see FOIA requests matched to your email.'}
            </p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>Request #</th>
                    <th>Subject</th>
                    <th>Department</th>
                    <th>Status</th>
                    <th>Due Date</th>
                    <th>Response File</th>
                  </tr>
                </thead>
                <tbody>
                  {recordsRequests.map(req => (
                    <tr key={req.id}>
                      <td><strong>{req.request_number}</strong></td>
                      <td>{req.subject}</td>
                      <td>{req.department}</td>
                      <td>{statusBadge(req.status)}</td>
                      <td>{req.due_date ? formatDate(req.due_date) : '—'}</td>
                      <td>
                        {req.fulfillment_filename ? (
                          <a
                            className="btn sm"
                            href={`/api/records/requests/public-download/${encodeURIComponent(req.request_number)}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Download ({req.fulfillment_filename})
                          </a>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {(tab === 'all' || tab === 'bills') && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '.5rem' }}>
            <h2 style={{ marginTop: 0 }}>My Utility Bills, Citations &amp; Fees ({bills.length})</h2>
            <a className="btn sm" href="/pay">Look Up by Account / Citation # →</a>
          </div>
          {bills.length === 0 ? (
            <p className="muted">
              {user.email
                ? `No utility bills or citations matched to ${user.email}.`
                : 'Add an email address above to link utility bills and citations, or look up by account/citation # on the public portal.'}
            </p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>Reference #</th>
                    <th>Type</th>
                    <th>Account / Address</th>
                    <th>Description</th>
                    <th>Amount</th>
                    <th>Due Date</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {bills.map(b => (
                    <tr key={b.id}>
                      <td><strong>{b.reference_number}</strong></td>
                      <td>{b.bill_type}</td>
                      <td>{b.account_number || b.service_address || '—'}</td>
                      <td>{b.description || '—'}</td>
                      <td><strong>{b.amount_due}</strong></td>
                      <td>{b.due_date ? formatDate(b.due_date) : '—'}</td>
                      <td>{statusBadge(b.payment_status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {(tab === 'all' || tab === 'forms') && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Form Submissions &amp; Alert Subscriptions</h2>
          {enabled.has('forms') && (
            <div style={{ marginBottom: '1rem' }}>
              <h3>Submitted Forms ({formSubmissions.length})</h3>
              {formSubmissions.length === 0 ? (
                <p className="muted">
                  {user.email
                    ? `No form submissions found for ${user.email}.`
                    : 'Add an email address above to see form submissions matched to your email.'}
                </p>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Form</th>
                        <th>Type</th>
                        <th>Status</th>
                        <th>Submitted</th>
                      </tr>
                    </thead>
                    <tbody>
                      {formSubmissions.map(f => (
                        <tr key={f.id}>
                          <td><strong>{f.form_title}</strong></td>
                          <td>{f.form_kind}</td>
                          <td>{statusBadge(f.status)}</td>
                          <td>{formatDate(f.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          <div>
            <h3>Email Alert Subscriptions ({subscriptions.length})</h3>
            {subscriptions.length === 0 ? (
              <p className="muted">
                No active email subscriptions{user.email ? ` for ${user.email}` : ''}.{' '}
                <a href="/notices">Subscribe to city alerts →</a>
              </p>
            ) : (
              <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
                {subscriptions.map(sub => (
                  <span key={sub.topic} className="badge published">
                    {TOPIC_LABELS[sub.topic] || sub.topic}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
