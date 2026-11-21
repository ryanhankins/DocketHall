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
import { api, formatDate } from './api.js';
import { useToast } from './toast.jsx';

const BILL_TYPE_LABELS = {
  utility: 'Utility Bill',
  citation: 'Municipal Citation',
  license: 'License Renewal',
  misc: 'Misc. Fee',
};

const EMPTY_FORM = {
  bill_type: 'utility',
  reference_number: '',
  account_number: '',
  payer_name: '',
  payer_email: '',
  service_address: '',
  description: '',
  amount_due: '',
  due_date: '',
  notes: '',
};

export default function BillingManagePage({ fixedBillType = '', pageTitle = '', pageSubtitle = '' }) {
  const showToast = useToast();
  const [bills, setBills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState(fixedBillType || '');
  const [statusFilter, setStatusFilter] = useState('');
  const [q, setQ] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM, bill_type: fixedBillType || 'utility' });
  const [lineItemsText, setLineItemsText] = useState('');
  const [saving, setSaving] = useState(false);
  const [sendImportEmails, setSendImportEmails] = useState(false);
  const [importing, setImporting] = useState(false);
  const [lateFeeFlat, setLateFeeFlat] = useState('10.00');
  const [lateFeeEmails, setLateFeeEmails] = useState(false);
  const [applyingLateFees, setApplyingLateFees] = useState(false);
  const [paymentBill, setPaymentBill] = useState(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('check');
  const [payRef, setPayRef] = useState('');
  const [recordingPayment, setRecordingPayment] = useState(false);
  const csvRef = useRef(null);

  const loadBills = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (typeFilter) params.set('bill_type', typeFilter);
      if (statusFilter) params.set('payment_status', statusFilter);
      if (q.trim()) params.set('q', q.trim());
      const qs = params.toString() ? `?${params.toString()}` : '';
      const data = await api(`/api/payments/bills${qs}`);
      setBills(Array.isArray(data) ? data : []);
    } catch (err) {
      showToast(err.message || 'Failed to load bills', 'error');
    } finally {
      setLoading(false);
    }
  }, [typeFilter, statusFilter, q, showToast]);

  useEffect(() => {
    loadBills();
  }, [loadBills]);

  const handleCreate = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const line_items = lineItemsText
        .split('\n')
        .map(l => l.trim())
        .filter(Boolean)
        .map(line => {
          const idx = line.lastIndexOf(':');
          if (idx > 0) {
            return { label: line.slice(0, idx).trim(), amount: line.slice(idx + 1).trim() };
          }
          return { label: line, amount: '' };
        });
      const created = await api('/api/payments/bills', {
        method: 'POST',
        body: JSON.stringify({ ...form, line_items }),
      });
      showToast(`Created ${created.reference_number}`, 'ok');
      setForm({ ...EMPTY_FORM });
      setLineItemsText('');
      setShowForm(false);
      await loadBills();
    } catch (err) {
      showToast(err.message || 'Failed to create bill', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleImportCsv = async (e) => {
    e.preventDefault();
    const file = csvRef.current?.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('send_emails', String(sendImportEmails));
      const res = await api('/api/payments/bills/import-csv', { method: 'POST', body: fd });
      showToast(`Imported CSV: ${res.created} created, ${res.updated} updated, ${res.emailed} emailed`, 'ok');
      if (csvRef.current) csvRef.current.value = '';
      await loadBills();
    } catch (err) {
      showToast(err.message || 'CSV import failed', 'error');
    } finally {
      setImporting(false);
    }
  };

  const handleApplyLateFees = async () => {
    setApplyingLateFees(true);
    try {
      const res = await api('/api/payments/bills/apply-late-fees', {
        method: 'POST',
        body: JSON.stringify({ flat_fee: lateFeeFlat, send_emails: lateFeeEmails }),
      });
      showToast(`Applied late fees to ${res.applied} overdue bill(s) (${res.emailed} emailed)`, 'ok');
      await loadBills();
    } catch (err) {
      showToast(err.message || 'Failed to apply late fees', 'error');
    } finally {
      setApplyingLateFees(false);
    }
  };

  const handleRecordPayment = (bill) => {
    setPaymentBill(bill);
    setPayAmount((bill.amount_due || '').replace('$', ''));
    setPayMethod('check');
    setPayRef('');
  };

  const submitRecordPayment = async (e) => {
    e.preventDefault();
    if (!paymentBill || !payAmount.trim()) return;
    setRecordingPayment(true);
    try {
      await api(`/api/payments/bills/${paymentBill.id}/record-payment`, {
        method: 'POST',
        body: JSON.stringify({ payment_amount: payAmount.trim(), payment_method: payMethod, payment_ref: payRef.trim() }),
      });
      showToast(`Recorded payment on ${paymentBill.reference_number}`, 'ok');
      setPaymentBill(null);
      await loadBills();
    } catch (err) {
      showToast(err.message || 'Failed to record payment', 'error');
    } finally {
      setRecordingPayment(false);
    }
  };

  const handleSetStatus = async (bill, payment_status) => {
    try {
      await api(`/api/payments/bills/${bill.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          payment_status,
          payment_method: payment_status === 'paid' ? 'cash_or_check' : '',
        }),
      });
      showToast(`${bill.reference_number} marked ${payment_status}`, 'ok');
      await loadBills();
    } catch (err) {
      showToast(err.message || 'Failed to update status', 'error');
    }
  };

  const handleDelete = async (bill) => {
    if (!window.confirm(`Delete ${bill.reference_number}?`)) return;
    try {
      await api(`/api/payments/bills/${bill.id}`, { method: 'DELETE' });
      showToast(`Deleted ${bill.reference_number}`, 'ok');
      await loadBills();
    } catch (err) {
      showToast(err.message || 'Failed to delete bill', 'error');
    }
  };

  return (
    <section id="section-billing">
      <div className="between" style={{ marginBottom: '1rem', flexWrap: 'wrap', gap: '.5rem' }}>
        <div>
          <h1 style={{ margin: 0 }}>{pageTitle || 'Utility Bills, Citations & Misc. Fees'}</h1>
          <p className="muted" style={{ margin: '.25rem 0 0' }}>
            {pageSubtitle || <>Manage utility statements, municipal citations, batch CSV imports, late-fee aging, and PDF invoices for <code>/#pay</code>.</>}
          </p>
        </div>
        <div className="actions">
          <button type="button" className="btn" onClick={() => setShowTools(v => !v)}>
            {showTools ? 'Hide Batch Tools' : 'Batch CSV & Late Fees'}
          </button>
          <button type="button" className="btn primary" onClick={() => setShowForm(v => !v)}>
            {showForm ? 'Close Form' : '+ New Bill / Citation'}
          </button>
        </div>
      </div>

      {showTools && (
        <div className="card" style={{ display: 'grid', gap: '1rem' }}>
          <form onSubmit={handleImportCsv} className="row" style={{ alignItems: 'flex-end', gap: '.65rem', flexWrap: 'wrap' }}>
            <div className="field" style={{ flex: 1, minWidth: 240 }}>
              <label htmlFor="bill-csv-file">Batch Import Utility Bills / Citations (.csv)</label>
              <input id="bill-csv-file" ref={csvRef} type="file" accept=".csv" required />
            </div>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem', paddingBottom: '.45rem' }}>
              <input type="checkbox" checked={sendImportEmails} onChange={e => setSendImportEmails(e.target.checked)} />
              Email notices
            </label>
            <a className="btn sm" href="/api/payments/bills/import-template.csv" download="dockethall-bills-import-template.csv">
              Download Template CSV
            </a>
            <button type="submit" className="btn sm primary" disabled={importing}>
              {importing ? 'Importing…' : 'Import CSV'}
            </button>
          </form>

          <div className="row" style={{ alignItems: 'flex-end', gap: '.65rem', flexWrap: 'wrap', borderTop: '1px solid #e2e8f0', paddingTop: '.85rem' }}>
            <div className="field" style={{ maxWidth: 200 }}>
              <label htmlFor="late-fee-flat">Overdue Late Fee ($)</label>
              <input id="late-fee-flat" value={lateFeeFlat} onChange={e => setLateFeeFlat(e.target.value)} />
            </div>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem', paddingBottom: '.45rem' }}>
              <input type="checkbox" checked={lateFeeEmails} onChange={e => setLateFeeEmails(e.target.checked)} />
              Email past-due notices
            </label>
            <button type="button" className="btn sm" onClick={handleApplyLateFees} disabled={applyingLateFees}>
              {applyingLateFees ? 'Applying…' : 'Apply Late Fees to Overdue Bills'}
            </button>
          </div>
        </div>
      )}

      {showForm && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Create Bill, Citation, or Fee</h2>
          <form onSubmit={handleCreate}>
            <div className="row" style={{ marginBottom: '.75rem' }}>
              <div className="field" style={{ flex: 1, minWidth: 160 }}>
                <label htmlFor="bill-type">Type *</label>
                <select id="bill-type" value={form.bill_type} onChange={e => setForm(f => ({ ...f, bill_type: e.target.value }))}>
                  <option value="utility">Utility Bill (Water / Sewer / Trash)</option>
                  <option value="citation">Municipal / Parking Citation</option>
                  <option value="license">License Renewal (Pet / Business)</option>
                  <option value="misc">Misc. City Fee</option>
                </select>
              </div>
              <div className="field" style={{ flex: 1, minWidth: 160 }}>
                <label htmlFor="bill-ref">Reference / Citation # (optional)</label>
                <input id="bill-ref" placeholder="Auto-generated if blank" value={form.reference_number} onChange={e => setForm(f => ({ ...f, reference_number: e.target.value }))} />
              </div>
              <div className="field" style={{ flex: 1, minWidth: 160 }}>
                <label htmlFor="bill-acct">Utility Account # (optional)</label>
                <input id="bill-acct" placeholder="e.g. ACCT-1042" value={form.account_number} onChange={e => setForm(f => ({ ...f, account_number: e.target.value }))} />
              </div>
            </div>
            <div className="row" style={{ marginBottom: '.75rem' }}>
              <div className="field" style={{ flex: 1, minWidth: 160 }}>
                <label htmlFor="bill-amt">Total Amount Due *</label>
                <input id="bill-amt" required placeholder="e.g. $65.00" value={form.amount_due} onChange={e => setForm(f => ({ ...f, amount_due: e.target.value }))} />
              </div>
              <div className="field" style={{ flex: 1, minWidth: 150 }}>
                <label htmlFor="bill-due">Due Date</label>
                <input id="bill-due" type="date" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} />
              </div>
              <div className="field" style={{ flex: 2, minWidth: 200 }}>
                <label htmlFor="bill-desc">Description</label>
                <input id="bill-desc" placeholder="e.g. November Water/Sewer Statement" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
              </div>
            </div>
            <div className="row" style={{ marginBottom: '.75rem' }}>
              <div className="field" style={{ flex: 1, minWidth: 160 }}>
                <label htmlFor="bill-name">Payer Name</label>
                <input id="bill-name" value={form.payer_name} onChange={e => setForm(f => ({ ...f, payer_name: e.target.value }))} />
              </div>
              <div className="field" style={{ flex: 1, minWidth: 180 }}>
                <label htmlFor="bill-email">Payer Email (links to My Civic Account)</label>
                <input id="bill-email" type="email" value={form.payer_email} onChange={e => setForm(f => ({ ...f, payer_email: e.target.value }))} />
              </div>
              <div className="field" style={{ flex: 1, minWidth: 180 }}>
                <label htmlFor="bill-addr">Service / Property Address</label>
                <input id="bill-addr" value={form.service_address} onChange={e => setForm(f => ({ ...f, service_address: e.target.value }))} />
              </div>
            </div>
            <div className="field" style={{ marginBottom: '.75rem' }}>
              <label htmlFor="bill-lines">Line Items (optional, one per line as <code>Label: $Amount</code>)</label>
              <textarea
                id="bill-lines"
                rows={2}
                placeholder={'Water Base & Usage: $42.00\nSewer Service: $23.00'}
                value={lineItemsText}
                onChange={e => setLineItemsText(e.target.value)}
              />
            </div>
            <button type="submit" className="btn primary" disabled={saving}>
              {saving ? 'Saving…' : 'Create Bill / Citation'}
            </button>
          </form>
        </div>
      )}

      <div className="card">
        <div className="row" style={{ marginBottom: '.85rem' }}>
          <input
            aria-label="Search bills and citations"
            placeholder="Search reference #, account #, payer, address…"
            value={q}
            onChange={e => setQ(e.target.value)}
            style={{ flex: 2, minWidth: 220 }}
          />
          {!fixedBillType && (
            <select aria-label="Filter by bill type" value={typeFilter} onChange={e => setTypeFilter(e.target.value)} style={{ width: 'auto' }}>
              <option value="">All Types</option>
              {Object.entries(BILL_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          )}
          <select aria-label="Filter by payment status" value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ width: 'auto' }}>
            <option value="">All Statuses</option>
            <option value="unpaid">Unpaid</option>
            <option value="paid">Paid</option>
            <option value="waived">Waived</option>
          </select>
        </div>

        {loading ? (
          <p className="muted">Loading bills…</p>
        ) : bills.length === 0 ? (
          <p className="muted">No utility bills, citations, or fees found.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Reference #</th>
                  <th>Type / Account</th>
                  <th>Payer &amp; Address</th>
                  <th>Description</th>
                  <th>Amount</th>
                  <th>Due</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {bills.map(b => (
                  <tr key={b.id}>
                    <td>
                      <strong>{b.reference_number}</strong>
                      {b.late_fee_applied && <div><span className="badge draft">Late Fee</span></div>}
                      {b.dispute_status === 'contested' && <div><span className="badge draft">Contested</span></div>}
                    </td>
                    <td>
                      <div>{BILL_TYPE_LABELS[b.bill_type] || b.bill_type}</div>
                      {b.account_number && <div className="muted" style={{ fontSize: '.78rem' }}>Acct: {b.account_number}</div>}
                    </td>
                    <td>
                      <div>{b.payer_name || '—'}</div>
                      <div className="muted" style={{ fontSize: '.78rem' }}>{b.service_address || b.payer_email || ''}</div>
                    </td>
                    <td>{b.description || '—'}</td>
                    <td>
                      <strong>{b.amount_due}</strong>
                      {b.amount_paid && <div className="muted" style={{ fontSize: '.78rem' }}>Paid: {b.amount_paid}</div>}
                    </td>
                    <td>{b.due_date ? formatDate(b.due_date) : '—'}</td>
                    <td>
                      <span className={`badge ${b.payment_status === 'paid' ? 'active' : (b.payment_status === 'waived' ? 'draft' : 'disabled')}`}>
                        {b.payment_status}
                      </span>
                    </td>
                    <td>
                      <div className="actions">
                        <a className="btn sm" href={`/api/payments/bills/${b.id}/receipt.pdf`} target="_blank" rel="noreferrer">
                          PDF
                        </a>
                        {b.payment_status !== 'paid' && (
                          <>
                            <button type="button" className="btn sm" onClick={() => handleRecordPayment(b)}>
                              Payment
                            </button>
                            <button type="button" className="btn sm" onClick={() => handleSetStatus(b, 'paid')}>
                              Mark Paid
                            </button>
                          </>
                        )}
                        {b.payment_status === 'unpaid' && (
                          <button type="button" className="btn sm" onClick={() => handleSetStatus(b, 'waived')}>
                            Waive
                          </button>
                        )}
                        <button type="button" className="btn sm danger" onClick={() => handleDelete(b)}>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {paymentBill && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="record-payment-title"
          style={{
            position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', zIndex: 1000,
          }}
          onClick={(e) => { if (e.target === e.currentTarget && !recordingPayment) setPaymentBill(null); }}
        >
          <div className="card" style={{ width: '100%', maxWidth: '440px', margin: 0 }}>
            <h2 id="record-payment-title" style={{ marginTop: 0 }}>
              Record Payment — {paymentBill.reference_number}
            </h2>
            <p className="muted" style={{ marginTop: 0, fontSize: '.88rem' }}>
              Amount Due: <strong>{paymentBill.amount_due}</strong>
            </p>
            <form onSubmit={submitRecordPayment} style={{ display: 'grid', gap: '.75rem' }}>
              <div className="field">
                <label htmlFor="pay-modal-amount">Payment Amount *</label>
                <input id="pay-modal-amount" required value={payAmount} onChange={(e) => setPayAmount(e.target.value)} placeholder="e.g. 75.00" />
              </div>
              <div className="field">
                <label htmlFor="pay-modal-method">Payment Method</label>
                <select id="pay-modal-method" value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
                  <option value="check">Check</option>
                  <option value="cash">Cash</option>
                  <option value="ach">ACH / Bank Transfer</option>
                  <option value="card">Card</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="pay-modal-ref">Check # or Receipt Reference (optional)</label>
                <input id="pay-modal-ref" value={payRef} onChange={(e) => setPayRef(e.target.value)} placeholder="e.g. CHK-1042" />
              </div>
              <div className="actions" style={{ justifyContent: 'flex-end', marginTop: '.25rem' }}>
                <button type="button" className="btn" disabled={recordingPayment} onClick={() => setPaymentBill(null)}>Cancel</button>
                <button type="submit" className="btn primary" disabled={recordingPayment}>
                  {recordingPayment ? 'Recording…' : 'Record Payment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
