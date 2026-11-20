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

export default function RenewalsPage() {
  const [days, setDays] = useState(60);
  const [licenseFee, setLicenseFee] = useState('100.00');
  const [complianceFee, setComplianceFee] = useState('75.00');
  const [contractorFee, setContractorFee] = useState('100.00');
  const [sendEmails, setSendEmails] = useState(true);
  const [data, setData] = useState({
    summary: { total: 0, business_licenses: 0, compliance_programs: 0, contractors: 0 },
    items: [],
  });
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api(`/api/permits/renewals/upcoming?days=${days}`);
      setData(res || { summary: { total: 0, business_licenses: 0, compliance_programs: 0, contractors: 0 }, items: [] });
    } catch (err) {
      toast(err.message || 'Failed to load upcoming renewals', 'error');
    } finally {
      setLoading(false);
    }
  }, [days, toast]);

  useEffect(() => { load(); }, [load]);

  async function handleGenerate() {
    setGenerating(true);
    try {
      const res = await api('/api/permits/renewals/generate', {
        method: 'POST',
        body: JSON.stringify({
          days_ahead: Number(days),
          default_license_fee: licenseFee,
          default_compliance_fee: complianceFee,
          default_contractor_fee: contractorFee,
          send_emails: sendEmails,
        }),
      });
      toast(`Generated ${res.created_bills} renewal bill(s) and sent ${res.emailed} notice(s)`);
      await load();
    } catch (err) {
      toast(err.message || 'Failed to generate renewals', 'error');
    } finally {
      setGenerating(false);
    }
  }

  const s = data.summary || { total: 0, business_licenses: 0, compliance_programs: 0, contractors: 0 };

  return (
    <section id="section-renewals">
      <div className="between" style={{ marginBottom: '1rem', flexWrap: 'wrap', gap: '.5rem' }}>
        <div>
          <h1 style={{ margin: 0 }}>Automated Recurring Renewals</h1>
          <p className="muted" style={{ margin: '.2rem 0 0' }}>
            Auto-generate renewal notices &amp; online Stripe payment bills 30/60 days before expiration across Business Licenses, Rental/Fire Inspections, and Contractor Registrations.
          </p>
        </div>
        <div className="actions">
          <button type="button" className="btn sm" onClick={load} disabled={loading}>Refresh</button>
          <button type="button" className="btn sm primary" onClick={handleGenerate} disabled={generating}>
            {generating ? 'Generating…' : 'Generate Renewal Bills & Notices'}
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))', gap: '.75rem', marginBottom: '1rem' }}>
        <div className="card" style={{ margin: 0 }}>
          <div className="muted" style={{ fontSize: '.8rem' }}>Total Upcoming ({days}d)</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 700 }}>{s.total}</div>
        </div>
        <div className="card" style={{ margin: 0 }}>
          <div className="muted" style={{ fontSize: '.8rem' }}>Business Licenses</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 700 }}>{s.business_licenses}</div>
        </div>
        <div className="card" style={{ margin: 0 }}>
          <div className="muted" style={{ fontSize: '.8rem' }}>Rental / Fire Inspections</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 700 }}>{s.compliance_programs}</div>
        </div>
        <div className="card" style={{ margin: 0 }}>
          <div className="muted" style={{ fontSize: '.8rem' }}>Contractor Registrations</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 700 }}>{s.contractors}</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <h3 style={{ marginTop: 0 }}>Renewal Generation Settings</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '.75rem', alignItems: 'end' }}>
          <div>
            <label className="muted" style={{ fontSize: '.8rem', display: 'block' }}>Lookahead Window</label>
            <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
              <option value={30}>Next 30 Days (incl. expired)</option>
              <option value={60}>Next 60 Days (incl. expired)</option>
              <option value={90}>Next 90 Days (incl. expired)</option>
            </select>
          </div>
          <div>
            <label className="muted" style={{ fontSize: '.8rem', display: 'block' }}>Default License Fee ($)</label>
            <input value={licenseFee} onChange={(e) => setLicenseFee(e.target.value)} />
          </div>
          <div>
            <label className="muted" style={{ fontSize: '.8rem', display: 'block' }}>Default Inspection Fee ($)</label>
            <input value={complianceFee} onChange={(e) => setComplianceFee(e.target.value)} />
          </div>
          <div>
            <label className="muted" style={{ fontSize: '.8rem', display: 'block' }}>Default Contractor Fee ($)</label>
            <input value={contractorFee} onChange={(e) => setContractorFee(e.target.value)} />
          </div>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem', paddingBottom: '.35rem' }}>
            <input type="checkbox" checked={sendEmails} onChange={(e) => setSendEmails(e.target.checked)} />
            Send Email Notices
          </label>
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Upcoming &amp; Expired Renewals</h2>
        {loading ? (
          <p className="muted">Loading upcoming renewals…</p>
        ) : !(data.items || []).length ? (
          <p className="muted" style={{ margin: 0 }}>No licenses, inspections, or contractor registrations expiring within {days} days.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Category</th>
                <th>Reference</th>
                <th>Entity / Address</th>
                <th>Expires / Due</th>
                <th>Window</th>
                <th>Renewal Bill</th>
              </tr>
            </thead>
            <tbody>
              {(data.items || []).map((it) => (
                <tr key={it.bill_reference}>
                  <td>{it.category_label}</td>
                  <td><strong>{it.reference}</strong></td>
                  <td>
                    <div>{it.entity_name}</div>
                    <div className="muted" style={{ fontSize: '.8rem' }}>{it.address || it.email || '—'}</div>
                  </td>
                  <td>{it.expires_at || '—'}</td>
                  <td>
                    {it.days_remaining < 0 ? (
                      <span className="badge disabled">Expired ({Math.abs(it.days_remaining)}d)</span>
                    ) : (
                      <span className="badge draft">In {it.days_remaining}d</span>
                    )}
                  </td>
                  <td>
                    {it.bill_exists ? (
                      <span className={`badge ${it.payment_status === 'paid' ? 'final' : ''}`}>
                        {it.bill_reference} ({it.payment_status || 'unpaid'})
                      </span>
                    ) : (
                      <span className="muted" style={{ fontSize: '.82rem' }}>Not generated</span>
                    )}
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
