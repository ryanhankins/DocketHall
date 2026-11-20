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

const fmtMoney = (cents) =>
  `$${((Number(cents) || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function PermitsReportsPage({ onNavigate }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const showToast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api('/api/permits/reports/summary'));
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  if (loading || !data) {
    return (
      <section id="section-permits-reports">
        <div className="card"><p className="muted">Loading operational &amp; revenue dashboard…</p></div>
      </section>
    );
  }

  const { permits: p, revenue: rv, inspections: ins, contractors: ct, compliance_programs: cp, code_enforcement: ce } = data;
  const maxMonth = Math.max(1, ...(p.by_month || []).map((m) => m.count));

  return (
    <section id="section-permits-reports">
      <div className="between" style={{ marginBottom: '1rem', flexWrap: 'wrap', gap: '.5rem' }}>
        <div>
          <h1 style={{ margin: 0 }}>Operational Reporting &amp; Revenue Dashboard</h1>
          <p className="muted" style={{ margin: '.2rem 0 0' }}>
            Real-time metrics across Permitting, Fee &amp; Escrow Revenue, Inspections, Contractor Licensing, Recurring Compliance, and Code Enforcement.
          </p>
        </div>
        <div className="actions">
          <button type="button" className="btn sm" onClick={load}>Refresh</button>
          <a className="btn sm primary" href="/api/permits/reports/summary.csv" download="civicdesk-operational-report.csv">
            Export Report CSV
          </a>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))', gap: '.75rem', marginBottom: '1rem' }}>
        <div className="card" style={{ margin: 0 }}>
          <div className="muted" style={{ fontSize: '.8rem' }}>Total Permits</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 700 }}>{p.total}</div>
          <div className="muted" style={{ fontSize: '.78rem' }}>{p.open} open · {p.issued} issued/closed</div>
        </div>
        <div className="card" style={{ margin: 0 }}>
          <div className="muted" style={{ fontSize: '.8rem' }}>Avg. Review Turnaround</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 700 }}>{p.avg_turnaround_days != null ? `${p.avg_turnaround_days}d` : '—'}</div>
          <div className="muted" style={{ fontSize: '.78rem' }}>Est. Value: ${Number(p.total_estimated_value || 0).toLocaleString()}</div>
        </div>
        <div className="card" style={{ margin: 0 }}>
          <div className="muted" style={{ fontSize: '.8rem' }}>Fees Collected</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 700, color: '#15803d' }}>{fmtMoney(rv.payments_cents)}</div>
          <div className="muted" style={{ fontSize: '.78rem' }}>Assessed: {fmtMoney(rv.fees_assessed_cents)}</div>
        </div>
        <div className="card" style={{ margin: 0 }}>
          <div className="muted" style={{ fontSize: '.8rem' }}>Outstanding Balance</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 700, color: rv.balance_due_cents > 0 ? '#b45309' : undefined }}>
            {fmtMoney(rv.balance_due_cents)}
          </div>
          <div className="muted" style={{ fontSize: '.78rem' }}>Escrow Held: {fmtMoney(rv.escrow_held_cents)}</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
        <div className="card" style={{ margin: 0 }}>
          <h2 style={{ marginTop: 0 }}>Monthly Permit Volume</h2>
          {!(p.by_month || []).length ? (
            <p className="muted">No permit applications recorded yet.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.45rem' }}>
              {p.by_month.map((m) => (
                <div key={m.month} style={{ display: 'flex', alignItems: 'center', gap: '.6rem', fontSize: '.85rem' }}>
                  <span style={{ width: 70, fontVariantNumeric: 'tabular-nums' }}>{m.month}</span>
                  <div style={{ flex: 1, background: '#f1f5f9', borderRadius: 4, height: 18, overflow: 'hidden' }}>
                    <div
                      style={{
                        width: `${Math.max(6, Math.round((m.count / maxMonth) * 100))}%`,
                        background: '#2563eb',
                        height: '100%',
                      }}
                    />
                  </div>
                  <strong style={{ width: 28, textAlign: 'right' }}>{m.count}</strong>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card" style={{ margin: 0 }}>
          <h2 style={{ marginTop: 0 }}>Permits by Type</h2>
          {!(p.by_type || []).length ? (
            <p className="muted">No permits recorded yet.</p>
          ) : (
            <table>
              <thead><tr><th>Permit Type</th><th style={{ textAlign: 'right' }}>Count</th></tr></thead>
              <tbody>
                {p.by_type.map((t) => (
                  <tr key={t.type}><td>{t.type}</td><td style={{ textAlign: 'right', fontWeight: 600 }}>{t.count}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '1rem' }}>
        <div className="card" style={{ margin: 0 }}>
          <h3 style={{ marginTop: 0 }}>Inspections</h3>
          <div style={{ fontSize: '.9rem', lineHeight: 1.7 }}>
            <div>Scheduled: <strong>{ins.scheduled}</strong></div>
            <div>Passed: <strong style={{ color: '#15803d' }}>{ins.passed}</strong></div>
            <div>Failed / Partial: <strong style={{ color: '#b91c1c' }}>{ins.failed + ins.partial}</strong></div>
          </div>
          <button type="button" className="btn sm" style={{ marginTop: '.5rem' }} onClick={() => onNavigate('#permits-review')}>
            Open Review Queue
          </button>
        </div>

        <div className="card" style={{ margin: 0 }}>
          <h3 style={{ marginTop: 0 }}>Contractor Licensing</h3>
          <div style={{ fontSize: '.9rem', lineHeight: 1.7 }}>
            <div>Compliant: <strong style={{ color: '#15803d' }}>{ct.compliant}</strong></div>
            <div>Blocked / Expired: <strong style={{ color: '#b91c1c' }}>{ct.blocked}</strong></div>
            <div>Expiring &le; 30d: <strong>{ct.expiring_soon}</strong></div>
          </div>
          <button type="button" className="btn sm" style={{ marginTop: '.5rem' }} onClick={() => onNavigate('#contractors')}>
            Manage Contractors
          </button>
        </div>

        <div className="card" style={{ margin: 0 }}>
          <h3 style={{ marginTop: 0 }}>Rental &amp; Fire Compliance</h3>
          <div style={{ fontSize: '.9rem', lineHeight: 1.7 }}>
            <div>On Schedule: <strong style={{ color: '#15803d' }}>{cp.ok}</strong></div>
            <div>Due &le; 30d: <strong style={{ color: '#b45309' }}>{cp.due_soon}</strong></div>
            <div>Overdue: <strong style={{ color: '#b91c1c' }}>{cp.overdue}</strong></div>
          </div>
          <button type="button" className="btn sm" style={{ marginTop: '.5rem' }} onClick={() => onNavigate('#compliance-programs')}>
            View Compliance Programs
          </button>
        </div>

        <div className="card" style={{ margin: 0 }}>
          <h3 style={{ marginTop: 0 }}>Code Enforcement</h3>
          <div style={{ fontSize: '.9rem', lineHeight: 1.7 }}>
            <div>Total Cases: <strong>{ce.total}</strong></div>
            <div>Open Cases: <strong>{ce.open}</strong></div>
            <div>Overdue Deadlines: <strong style={{ color: '#b91c1c' }}>{ce.overdue}</strong></div>
          </div>
          <button type="button" className="btn sm" style={{ marginTop: '.5rem' }} onClick={() => onNavigate('#complaints-manage')}>
            Open Code Enforcement
          </button>
        </div>
      </div>
    </section>
  );
}
