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

export default function BillingManagePage() {
  const showToast = useToast();
  const [bills, setBills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [q, setQ] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);

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
      const created = await api('/api/payments/bills', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      showToast(`Created ${created.reference_number}`, 'ok');
      setForm({ ...EMPTY_FORM });
      setShowForm(false);
      await loadBills();
    } catch (err) {
      showToast(err.message || 'Failed to create bill', 'error');
    } finally {
      setSaving(false);
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
      <div className="between" style={{ marginBottom: '1rem' }}>
        <div>
          <h1 style={{ margin: 0 }}>Utility Bills, Citations &amp; Misc. Fees</h1>
          <p className="muted" style={{ margin: '.25rem 0 0' }}>
            Create utility bills, municipal citations, license renewals, or fees for online lookup &amp; Stripe payment at <code>/#pay</code>.
          </p>
        </div>
        <button type="button" className="btn primary" onClick={() => setShowForm(v => !v)}>
          {showForm ? 'Close Form' : '+ New Bill / Citation'}
        </button>
      </div>

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
                <label htmlFor="bill-amt">Amount Due *</label>
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
          <select aria-label="Filter by bill type" value={typeFilter} onChange={e => setTypeFilter(e.target.value)} style={{ width: 'auto' }}>
            <option value="">All Types</option>
            {Object.entries(BILL_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
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
                    <td><strong>{b.reference_number}</strong></td>
                    <td>
                      <div>{BILL_TYPE_LABELS[b.bill_type] || b.bill_type}</div>
                      {b.account_number && <div className="muted" style={{ fontSize: '.78rem' }}>Acct: {b.account_number}</div>}
                    </td>
                    <td>
                      <div>{b.payer_name || '—'}</div>
                      <div className="muted" style={{ fontSize: '.78rem' }}>{b.service_address || b.payer_email || ''}</div>
                    </td>
                    <td>{b.description || '—'}</td>
                    <td><strong>{b.amount_due}</strong></td>
                    <td>{b.due_date ? formatDate(b.due_date) : '—'}</td>
                    <td>
                      <span className={`badge ${b.payment_status === 'paid' ? 'active' : (b.payment_status === 'waived' ? 'draft' : 'disabled')}`}>
                        {b.payment_status}
                      </span>
                    </td>
                    <td>
                      <div className="actions">
                        {b.payment_status !== 'paid' && (
                          <button type="button" className="btn sm" onClick={() => handleSetStatus(b, 'paid')}>
                            Mark Paid
                          </button>
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
    </section>
  );
}
