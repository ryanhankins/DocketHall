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

const LICENSE_TYPES = [
  'General Contractor',
  'Electrical',
  'Plumbing',
  'Mechanical / HVAC',
  'Excavation / Grading',
  'Roofing / Siding',
  'Tree & Landscaping',
  'Business License',
  'Other Trade',
];

const EMPTY_FORM = {
  license_number: '',
  business_name: '',
  license_type: 'General Contractor',
  contact_name: '',
  email: '',
  phone: '',
  address: '',
  license_expires_at: '',
  insurance_carrier: '',
  insurance_policy_no: '',
  insurance_expires_at: '',
  bond_amount: '',
  bond_expires_at: '',
  status: 'active',
  notes: '',
};

export default function ContractorsManagePage() {
  const [items, setItems] = useState([]);
  const [tab, setTab] = useState('directory');
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [editId, setEditId] = useState(null);
  const [busy, setBusy] = useState(false);
  const showToast = useToast();

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (statusFilter) params.set('status', statusFilter);
    const qs = params.toString() ? `?${params.toString()}` : '';
    const rows = await api(`/api/permits/contractors${qs}`);
    setItems(Array.isArray(rows) ? rows : []);
  }, [q, statusFilter]);

  useEffect(() => {
    load().catch((e) => showToast(e.message, 'error'));
  }, [load, showToast]);

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.license_number.trim() || !form.business_name.trim()) return;
    setBusy(true);
    try {
      const payload = {
        ...form,
        license_number: form.license_number.trim(),
        business_name: form.business_name.trim(),
        contact_name: form.contact_name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        address: form.address.trim(),
        insurance_carrier: form.insurance_carrier.trim(),
        insurance_policy_no: form.insurance_policy_no.trim(),
        bond_amount: form.bond_amount.trim(),
        notes: form.notes.trim(),
      };
      if (editId) {
        await api(`/api/permits/contractors/${editId}`, { method: 'PATCH', body: JSON.stringify(payload) });
        showToast('Contractor license updated', 'ok');
      } else {
        await api('/api/permits/contractors', { method: 'POST', body: JSON.stringify(payload) });
        showToast('Contractor license added', 'ok');
      }
      setForm({ ...EMPTY_FORM });
      setEditId(null);
      setTab('directory');
      await load();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const compliantCount = items.filter((i) => i.compliant).length;
  const nonCompliantCount = items.filter((i) => !i.compliant).length;
  const expiringCount = items.filter((i) => i.expiring_soon).length;

  return (
    <section id="section-contractors">
      <div className="between" style={{ marginBottom: '1rem', flexWrap: 'wrap', gap: '.5rem' }}>
        <div>
          <h1 style={{ margin: 0 }}>Contractor &amp; Business Licensing</h1>
          <p className="muted" style={{ margin: '.2rem 0 0' }}>
            Track contractor licenses, liability insurance, and surety bonds. Non-compliant licenses are automatically blocked at permit submission and issuance.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="badge active">Compliant: {compliantCount}</span>
          {expiringCount > 0 && <span className="badge draft">Expiring &le; 30d: {expiringCount}</span>}
          {nonCompliantCount > 0 && <span className="badge disabled">Blocked / Non-Compliant: {nonCompliantCount}</span>}
          <button
            type="button"
            className="btn sm"
            onClick={async () => {
              try {
                const res = await api('/api/permits/contractors/send-reminders', { method: 'POST' });
                showToast(`Sent ${res.sent_count} reminder(s)${res.skipped_count ? ` (${res.skipped_count} missing email)` : ''}`, 'ok');
              } catch (err) {
                showToast(err.message, 'error');
              }
            }}
          >
            Send 30-Day Renewal Reminders
          </button>
        </div>
      </div>

      <div className="tabs">
        <button type="button" className={`btn sm${tab === 'directory' ? ' active' : ''}`} onClick={() => setTab('directory')}>
          Registered Directory ({items.length})
        </button>
        <button type="button" className={`btn sm${tab === 'add' ? ' active' : ''}`} onClick={() => setTab('add')}>
          {editId ? 'Edit Contractor / Business' : '+ Register Contractor'}
        </button>
      </div>

      {tab === 'add' && (
      <div className="card">
        <h2>{editId ? 'Edit Contractor / Business License' : 'Register Contractor or Business License'}</h2>
        <form onSubmit={handleSave}>
          <div className="row" style={{ marginBottom: '.75rem' }}>
            <div className="field" style={{ flex: 1, minWidth: 160 }}>
              <label htmlFor="ctr-lic">License Number *</label>
              <input id="ctr-lic" required placeholder="e.g. MN-GC-40821" value={form.license_number} onChange={(e) => setForm((f) => ({ ...f, license_number: e.target.value }))} />
            </div>
            <div className="field" style={{ flex: 2, minWidth: 200 }}>
              <label htmlFor="ctr-biz">Business / Contractor Name *</label>
              <input id="ctr-biz" required placeholder="e.g. Northshore Builders LLC" value={form.business_name} onChange={(e) => setForm((f) => ({ ...f, business_name: e.target.value }))} />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 160 }}>
              <label htmlFor="ctr-type">License Type</label>
              <select id="ctr-type" value={form.license_type} onChange={(e) => setForm((f) => ({ ...f, license_type: e.target.value }))}>
                {LICENSE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="field" style={{ flex: 1, minWidth: 130 }}>
              <label htmlFor="ctr-status">Status</label>
              <select id="ctr-status" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
                <option value="active">Active</option>
                <option value="pending">Pending</option>
                <option value="suspended">Suspended</option>
                <option value="expired">Expired</option>
              </select>
            </div>
          </div>

          <div className="row" style={{ marginBottom: '.75rem' }}>
            <div className="field" style={{ flex: 1, minWidth: 160 }}>
              <label htmlFor="ctr-contact">Primary Contact</label>
              <input id="ctr-contact" value={form.contact_name} onChange={(e) => setForm((f) => ({ ...f, contact_name: e.target.value }))} />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 180 }}>
              <label htmlFor="ctr-email">Email</label>
              <input id="ctr-email" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 140 }}>
              <label htmlFor="ctr-phone">Phone</label>
              <input id="ctr-phone" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 180 }}>
              <label htmlFor="ctr-addr">Address</label>
              <input id="ctr-addr" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
            </div>
          </div>

          <div className="row" style={{ marginBottom: '.75rem' }}>
            <div className="field" style={{ flex: 1, minWidth: 150 }}>
              <label htmlFor="ctr-lic-exp">License Expiration</label>
              <input id="ctr-lic-exp" type="date" value={form.license_expires_at} onChange={(e) => setForm((f) => ({ ...f, license_expires_at: e.target.value }))} />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 170 }}>
              <label htmlFor="ctr-ins-co">Insurance Carrier</label>
              <input id="ctr-ins-co" value={form.insurance_carrier} onChange={(e) => setForm((f) => ({ ...f, insurance_carrier: e.target.value }))} />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 140 }}>
              <label htmlFor="ctr-ins-pol">Policy #</label>
              <input id="ctr-ins-pol" value={form.insurance_policy_no} onChange={(e) => setForm((f) => ({ ...f, insurance_policy_no: e.target.value }))} />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 150 }}>
              <label htmlFor="ctr-ins-exp">COI / Insurance Exp.</label>
              <input id="ctr-ins-exp" type="date" value={form.insurance_expires_at} onChange={(e) => setForm((f) => ({ ...f, insurance_expires_at: e.target.value }))} />
            </div>
          </div>

          <div className="row" style={{ marginBottom: '.75rem' }}>
            <div className="field" style={{ flex: 1, minWidth: 140 }}>
              <label htmlFor="ctr-bond-amt">Bond Amount</label>
              <input id="ctr-bond-amt" placeholder="e.g. $50,000" value={form.bond_amount} onChange={(e) => setForm((f) => ({ ...f, bond_amount: e.target.value }))} />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 150 }}>
              <label htmlFor="ctr-bond-exp">Bond Expiration</label>
              <input id="ctr-bond-exp" type="date" value={form.bond_expires_at} onChange={(e) => setForm((f) => ({ ...f, bond_expires_at: e.target.value }))} />
            </div>
            <div className="field" style={{ flex: 2, minWidth: 220 }}>
              <label htmlFor="ctr-notes">Notes</label>
              <input id="ctr-notes" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>

          <div className="actions">
            <button type="submit" className="btn primary" disabled={busy}>
              {busy ? 'Saving…' : (editId ? 'Save License' : 'Add Contractor License')}
            </button>
            {editId && (
              <button type="button" className="btn" onClick={() => { setEditId(null); setForm({ ...EMPTY_FORM }); setTab('directory'); }}>
                Cancel
              </button>
            )}
          </div>
        </form>
      </div>
      )}

      {tab === 'directory' && (
      <div className="card">
        <div className="between" style={{ marginBottom: '.75rem', flexWrap: 'wrap', gap: '.5rem' }}>
          <h2 style={{ margin: 0 }}>Registered Contractors &amp; Businesses ({items.length})</h2>
          <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
            <input
              placeholder="Search license #, business, contact…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{ minWidth: 220 }}
            />
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All Statuses</option>
              <option value="active">Active</option>
              <option value="pending">Pending</option>
              <option value="suspended">Suspended</option>
              <option value="expired">Expired</option>
            </select>
          </div>
        </div>

        {items.length === 0 ? (
          <p className="muted">No contractor or business licenses match your filter.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>License # &amp; Business</th>
                <th>Type</th>
                <th>Credentials &amp; Expirations</th>
                <th>Compliance Gate</th>
                <th style={{ width: 140 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id}>
                  <td>
                    <div><code>{c.license_number}</code> <strong>{c.business_name}</strong></div>
                    {(c.contact_name || c.phone || c.email) && (
                      <div className="muted" style={{ fontSize: '.82rem' }}>
                        {[c.contact_name, c.phone, c.email].filter(Boolean).join(' · ')}
                      </div>
                    )}
                  </td>
                  <td><span className="badge draft">{c.license_type}</span></td>
                  <td style={{ fontSize: '.82rem' }}>
                    <div>License Exp: {c.license_expires_at || '—'}</div>
                    <div>COI Exp: {c.insurance_expires_at || '—'} {c.insurance_carrier ? `(${c.insurance_carrier})` : ''}</div>
                    {c.bond_expires_at && <div>Bond Exp: {c.bond_expires_at} {c.bond_amount ? `(${c.bond_amount})` : ''}</div>}
                  </td>
                  <td>
                    {c.compliant ? (
                      <span className="badge active">{c.expiring_soon ? 'Compliant (Expiring Soon)' : 'Compliant'}</span>
                    ) : (
                      <div>
                        <span className="badge disabled">Blocked</span>
                        <div style={{ fontSize: '.78rem', color: '#b91c1c', marginTop: 3 }}>
                          {c.compliance_issues.join('; ')}
                        </div>
                      </div>
                    )}
                  </td>
                  <td>
                    <div className="actions">
                      <button
                        type="button"
                        className="btn sm"
                        onClick={() => {
                          setEditId(c.id);
                          setTab('add');
                          setForm({
                            license_number: c.license_number || '',
                            business_name: c.business_name || '',
                            license_type: c.license_type || 'General Contractor',
                            contact_name: c.contact_name || '',
                            email: c.email || '',
                            phone: c.phone || '',
                            address: c.address || '',
                            license_expires_at: c.license_expires_at || '',
                            insurance_carrier: c.insurance_carrier || '',
                            insurance_policy_no: c.insurance_policy_no || '',
                            insurance_expires_at: c.insurance_expires_at || '',
                            bond_amount: c.bond_amount || '',
                            bond_expires_at: c.bond_expires_at || '',
                            status: c.status || 'active',
                            notes: c.notes || '',
                          });
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn sm danger"
                        onClick={async () => {
                          if (!window.confirm(`Delete license "${c.license_number}"?`)) return;
                          await api(`/api/permits/contractors/${c.id}`, { method: 'DELETE' });
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
      )}
    </section>
  );
}
