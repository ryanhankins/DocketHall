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
import { api } from './api.js';
import { useToast } from './toast.jsx';

export default function SlaEscalationPage({ onNavigate }) {
  const [rules, setRules] = useState([]);
  const [alertsData, setAlertsData] = useState({ summary: { total: 0, overdue: 0, warning: 0, by_rule: {} }, alerts: [] });
  const [filterSeverity, setFilterSeverity] = useState('all');
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState('');
  const [runningDigest, setRunningDigest] = useState(false);
  const toast = useToast();

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [rRes, aRes] = await Promise.all([
        api('/api/sla/rules'),
        api('/api/sla/alerts'),
      ]);
      setRules(rRes.rules || []);
      setAlertsData(aRes || { summary: { total: 0, overdue: 0, warning: 0, by_rule: {} }, alerts: [] });
    } catch (e) {
      toast(e.message || 'Failed to load SLA rules', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { loadAll(); }, [loadAll]);

  function updateLocalRule(ruleKey, patch) {
    setRules((prev) => prev.map((r) => (r.rule_key === ruleKey ? { ...r, ...patch } : r)));
  }

  async function saveRule(rule) {
    setSavingKey(rule.rule_key);
    try {
      const updated = await api(`/api/sla/rules/${rule.rule_key}`, {
        method: 'PATCH',
        body: JSON.stringify({
          target_days: Number(rule.target_days),
          warning_days: Number(rule.warning_days),
          escalation_email: rule.escalation_email || '',
          auto_escalate: !!rule.auto_escalate,
          enabled: !!rule.enabled,
        }),
      });
      updateLocalRule(rule.rule_key, updated);
      toast(`Saved ${rule.label}`);
      const aRes = await api('/api/sla/alerts');
      setAlertsData(aRes);
    } catch (e) {
      toast(e.message || 'Save failed', 'error');
    } finally {
      setSavingKey('');
    }
  }

  async function runDigestNow() {
    setRunningDigest(true);
    try {
      const res = await api('/api/sla/run-digest', { method: 'POST' });
      if (res.sent) {
        toast(`Escalation digest sent (${res.overdue_count} overdue, ${res.warning_count} approaching)`);
      } else {
        toast('No active SLA alerts to escalate');
      }
    } catch (e) {
      toast(e.message || 'Digest failed', 'error');
    } finally {
      setRunningDigest(false);
    }
  }

  const summary = alertsData.summary || { total: 0, overdue: 0, warning: 0 };
  const filteredAlerts = (alertsData.alerts || []).filter((a) => (
    filterSeverity === 'all' ? true : a.severity === filterSeverity
  ));

  return (
    <section id="section-sla-rules">
      <div className="between" style={{ marginBottom: '1rem', flexWrap: 'wrap', gap: '.5rem' }}>
        <div>
          <h1 style={{ margin: 0 }}>SLA Thresholds &amp; Overdue Escalations</h1>
          <p className="muted" style={{ margin: '.2rem 0 0' }}>
            Configure statutory &amp; target resolution clocks for FOIA requests, 311/complaints, and permit reviews.
          </p>
        </div>
        <div className="actions">
          <button type="button" className="btn sm" onClick={loadAll} disabled={loading}>Refresh</button>
          <button type="button" className="btn sm primary" onClick={runDigestNow} disabled={runningDigest}>
            {runningDigest ? 'Sending…' : 'Send Escalation Digest Now'}
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))', gap: '.75rem', marginBottom: '1rem' }}>
        <div className="card" style={{ margin: 0 }}>
          <div className="muted" style={{ fontSize: '.8rem' }}>Total Flagged Items</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 700 }}>{summary.total}</div>
        </div>
        <div className="card" style={{ margin: 0, borderColor: summary.overdue > 0 ? '#fca5a5' : undefined }}>
          <div className="muted" style={{ fontSize: '.8rem' }}>Overdue</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 700, color: summary.overdue > 0 ? '#dc2626' : undefined }}>
            {summary.overdue}
          </div>
        </div>
        <div className="card" style={{ margin: 0, borderColor: summary.warning > 0 ? '#fcd34d' : undefined }}>
          <div className="muted" style={{ fontSize: '.8rem' }}>Approaching Deadline</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 700, color: summary.warning > 0 ? '#b45309' : undefined }}>
            {summary.warning}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <h2 style={{ marginTop: 0 }}>Configured SLA Rules</h2>
        {loading ? (
          <p className="muted">Loading SLA rules…</p>
        ) : (
          <div style={{ display: 'grid', gap: '.85rem' }}>
            {rules.map((r) => (
              <div key={r.rule_key} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '.85rem', background: '#f8fafc' }}>
                <div className="between" style={{ marginBottom: '.6rem', flexWrap: 'wrap', gap: '.5rem' }}>
                  <div>
                    <strong>{r.label}</strong>
                    <span className="badge" style={{ marginLeft: '.5rem' }}>{r.module_id}</span>
                  </div>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem', fontSize: '.88rem' }}>
                    <input
                      type="checkbox"
                      checked={!!r.enabled}
                      onChange={(e) => updateLocalRule(r.rule_key, { enabled: e.target.checked })}
                    />
                    Enabled
                  </label>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '.65rem', alignItems: 'end' }}>
                  <div>
                    <label className="muted" style={{ fontSize: '.8rem', display: 'block' }}>Target Days (SLA)</label>
                    <input
                      type="number"
                      min={1}
                      max={365}
                      value={r.target_days}
                      onChange={(e) => updateLocalRule(r.rule_key, { target_days: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="muted" style={{ fontSize: '.8rem', display: 'block' }}>Warning Window (Days Before)</label>
                    <input
                      type="number"
                      min={0}
                      max={90}
                      value={r.warning_days}
                      onChange={(e) => updateLocalRule(r.rule_key, { warning_days: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="muted" style={{ fontSize: '.8rem', display: 'block' }}>Manager Escalation Email(s)</label>
                    <input
                      type="text"
                      placeholder="clerk@city.gov, manager@city.gov"
                      value={r.escalation_email}
                      onChange={(e) => updateLocalRule(r.rule_key, { escalation_email: e.target.value })}
                    />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.5rem' }}>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem', fontSize: '.85rem' }}>
                      <input
                        type="checkbox"
                        checked={!!r.auto_escalate}
                        onChange={(e) => updateLocalRule(r.rule_key, { auto_escalate: e.target.checked })}
                      />
                      Auto-escalate
                    </label>
                    <button
                      type="button"
                      className="btn sm primary"
                      disabled={savingKey === r.rule_key}
                      onClick={() => saveRule(r)}
                    >
                      {savingKey === r.rule_key ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <div className="between" style={{ marginBottom: '.75rem', flexWrap: 'wrap', gap: '.5rem' }}>
          <h2 style={{ margin: 0 }}>Active Overdue &amp; Approaching Items ({filteredAlerts.length})</h2>
          <select
            aria-label="Filter SLA alerts"
            value={filterSeverity}
            onChange={(e) => setFilterSeverity(e.target.value)}
            style={{ width: 'auto' }}
          >
            <option value="all">All Flagged ({summary.total})</option>
            <option value="overdue">Overdue Only ({summary.overdue})</option>
            <option value="warning">Approaching Only ({summary.warning})</option>
          </select>
        </div>
        {!filteredAlerts.length ? (
          <p className="muted" style={{ margin: 0 }}>All open items are currently within SLA thresholds.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Reference</th>
                <th>Module</th>
                <th>Subject / Property</th>
                <th>Status</th>
                <th>Due Date</th>
                <th>SLA State</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredAlerts.map((a) => (
                <tr key={`${a.rule_key}-${a.record_id}`}>
                  <td><strong>{a.reference}</strong></td>
                  <td>{a.module_id}</td>
                  <td>
                    <div>{a.title}</div>
                    <div className="muted" style={{ fontSize: '.8rem' }}>{a.detail}</div>
                  </td>
                  <td><span className="badge">{a.status}</span></td>
                  <td>{a.due_date}</td>
                  <td>
                    {a.severity === 'overdue' ? (
                      <span className="badge disabled">Overdue ({Math.abs(a.days_remaining)}d)</span>
                    ) : (
                      <span className="badge draft">Due in {a.days_remaining}d</span>
                    )}
                  </td>
                  <td>
                    <button type="button" className="btn sm" onClick={() => onNavigate?.(a.link_hash)}>
                      Open
                    </button>
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
