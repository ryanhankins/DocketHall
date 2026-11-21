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
import { api, downloadBackupArchive } from './api.js';
import { useToast } from './toast.jsx';

export default function BackupRestorePage({ reminderDays, onRefreshBackupBanner, onRestored }) {
  const [tab, setTab] = useState('manual');
  const [days, setDays] = useState(String(reminderDays ?? 0));
  const [msg, setMsg] = useState({ text: '', isError: false });
  const [policy, setPolicy] = useState({
    enabled: false,
    schedule_frequency: 'daily',
    target_type: 'minio_offsite',
    s3_endpoint: '',
    s3_bucket: '',
    s3_prefix: 'backups/',
    s3_access_key: '',
    s3_secret_key: '',
    s3_secure: true,
    retain_backups_count: 30,
    retention_enabled: false,
    retention_complaints_years: 0,
    retention_foia_years: 0,
    retention_audit_years: 0,
    has_s3_secret: false,
    last_offsite_backup_at: null,
    last_retention_run_at: null,
  });
  const [snapshots, setSnapshots] = useState([]);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [runningOffsite, setRunningOffsite] = useState(false);
  const [runningRetention, setRunningRetention] = useState(false);
  const [readiness, setReadiness] = useState(null);
  const [readinessErr, setReadinessErr] = useState('');
  const [seedingDemo, setSeedingDemo] = useState(false);
  const fileRef = useRef(null);
  const showToast = useToast();

  const loadReadiness = useCallback(async () => {
    setReadinessErr('');
    try {
      const d = await api('/api/backup/readiness');
      setReadiness(d);
    } catch (err) {
      setReadinessErr(err.message || 'Unable to load readiness checks');
    }
  }, []);

  useEffect(() => { loadReadiness(); }, [loadReadiness]);

  useEffect(() => {
    setDays(String(reminderDays ?? 0));
  }, [reminderDays]);

  const loadPolicy = useCallback(async () => {
    try {
      const d = await api('/api/backup/policy');
      if (d?.policy) {
        setPolicy((prev) => ({ ...prev, ...d.policy, s3_secret_key: '' }));
      }
      setSnapshots(d?.snapshots || []);
    } catch {
      // Ignore if insufficient perms
    }
  }, []);

  useEffect(() => { loadPolicy(); }, [loadPolicy]);

  const handleReminderSave = async (e) => {
    e.preventDefault();
    const num = Number(days || 0);
    try {
      await api('/api/backup/settings', {
        method: 'PUT',
        body: JSON.stringify({ reminder_days: num }),
      });
      await onRefreshBackupBanner?.();
      showToast(num > 0 ? `Backup reminder set to every ${num} day(s)` : 'Backup reminder disabled', 'ok');
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleRestore = async (e) => {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    if (!confirm('Restore from this archive? This will replace current agendas, items, documents, and settings.')) return;
    setMsg({ text: 'Restoring archive…', isError: false });
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/backup/import', {
        method: 'POST',
        credentials: 'same-origin',
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || `Restore failed (${res.status})`);
      if (fileRef.current) fileRef.current.value = '';
      const totalRows = Object.values(data.row_counts || {}).reduce((a, b) => a + b, 0);
      setMsg({ text: `Restored ${totalRows} database rows and ${data.restored_files || 0} files.`, isError: false });
      showToast('Archive restored', 'ok');
      await onRestored?.();
    } catch (err) {
      setMsg({ text: err.message, isError: true });
    }
  };

  async function savePolicy(e) {
    e?.preventDefault?.();
    setSavingPolicy(true);
    try {
      const payload = {
        ...policy,
        retain_backups_count: Number(policy.retain_backups_count || 30),
        retention_complaints_years: Number(policy.retention_complaints_years || 0),
        retention_foia_years: Number(policy.retention_foia_years || 0),
        retention_audit_years: Number(policy.retention_audit_years || 0),
      };
      if (!payload.s3_secret_key) delete payload.s3_secret_key;
      await api('/api/backup/policy', { method: 'PUT', body: JSON.stringify(payload) });
      showToast('Backup & retention policy saved', 'ok');
      await loadPolicy();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSavingPolicy(false);
    }
  }

  async function runOffsiteNow() {
    setRunningOffsite(true);
    try {
      const res = await api('/api/backup/run-offsite', { method: 'POST' });
      showToast(`Uploaded offsite snapshot (${res.object_key})`, 'ok');
      await onRefreshBackupBanner?.();
      await loadPolicy();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setRunningOffsite(false);
    }
  }

  async function runRetentionNow() {
    if (!confirm('Run record retention cleanup now? Closed records older than the configured retention years will be permanently removed.')) return;
    setRunningRetention(true);
    try {
      const res = await api('/api/backup/run-retention', { method: 'POST' });
      showToast(`Retention cleanup complete (Complaints: ${res.complaints_pruned}, FOIA: ${res.foia_pruned}, Audit: ${res.audit_pruned})`, 'ok');
      await loadPolicy();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setRunningRetention(false);
    }
  }

  return (
    <section id="section-preferences-backup">
      <h1>Backup &amp; Restore</h1>
      <div className="tabs">
        <button type="button" className={`btn sm${tab === 'manual' ? ' active' : ''}`} onClick={() => setTab('manual')}>
          Manual Backup &amp; Restore
        </button>
        <button type="button" className={`btn sm${tab === 'offsite' ? ' active' : ''}`} onClick={() => setTab('offsite')}>
          Scheduled Offsite (S3)
        </button>
        <button type="button" className={`btn sm${tab === 'retention' ? ' active' : ''}`} onClick={() => setTab('retention')}>
          Record Retention
        </button>
        <button type="button" className={`btn sm${tab === 'onboarding' ? ' active' : ''}`} onClick={() => setTab('onboarding')}>
          Launch &amp; Demo Setup
        </button>
      </div>

      {tab === 'onboarding' && (
        <div style={{ display: 'grid', gap: '1rem' }}>
          <div className="card" style={{ marginBottom: 0 }}>
            <h2 style={{ marginTop: 0 }}>City Launch Readiness Checklist</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              Verify core configuration before sharing your public portal with residents.
            </p>
            {readinessErr ? (
              <p className="error-msg">{readinessErr}</p>
            ) : !readiness ? (
              <p className="muted">Loading readiness checks…</p>
            ) : (
              <div style={{ display: 'grid', gap: '.5rem' }}>
                {(readiness.checks || []).map((chk) => (
                  <div key={chk.id} className="between" style={{ padding: '.55rem .75rem', border: '1px solid #e2e8f0', borderRadius: 6, gap: '.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '.55rem' }}>
                      <span className={`badge ${chk.done ? 'active' : 'draft'}`}>{chk.done ? 'Done' : 'Pending'}</span>
                      <strong>{chk.label}</strong>
                    </div>
                    {!chk.done && (
                      <a className="btn sm" href={chk.route}>Configure &rarr;</a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card" style={{ marginBottom: 0 }}>
            <h2 style={{ marginTop: 0 }}>One-Click Demo / Sample City Data</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              Evaluating DocketHall? Populate sample council agendas, a city code chapter, a welcome blog post, and a sample utility bill without overwriting any existing records.
            </p>
            <button
              type="button"
              className="btn primary"
              disabled={seedingDemo}
              onClick={async () => {
                setSeedingDemo(true);
                try {
                  const res = await api('/api/backup/seed-demo', { method: 'POST' });
                  const total = Object.values(res.seeded || {}).reduce((a, b) => a + b, 0);
                  showToast(total > 0 ? `Loaded ${total} sample item group(s)` : 'Sample data already present (nothing overwritten)', 'ok');
                  await loadReadiness();
                } catch (err) {
                  showToast(err.message || 'Failed to seed demo data', 'error');
                } finally {
                  setSeedingDemo(false);
                }
              }}
            >
              {seedingDemo ? 'Loading Sample Data…' : 'Load Sample City Data'}
            </button>
          </div>
        </div>
      )}

      {tab === 'manual' && (
      <div className="card" style={{ marginBottom: '1rem' }}>
        <p className="muted" style={{ marginTop: 0 }}>
          Download a full archive (.zip) containing human-readable agendas, CSVs, database JSON, users, preferences, templates, and uploaded attachments, or restore onto an instance.
        </p>
        <div className="actions" style={{ marginBottom: '.75rem' }}>
          <button
            type="button"
            id="backup-export-btn"
            className="btn primary"
            onClick={() => downloadBackupArchive(onRefreshBackupBanner, showToast).catch(e => showToast(e.message, 'error'))}
          >
            Download Full Archive (.zip)
          </button>
        </div>
        <form id="backup-reminder-form" className="row" style={{ alignItems: 'flex-end', marginBottom: '.85rem' }} onSubmit={handleReminderSave}>
          <div className="field" style={{ maxWidth: '260px' }}>
            <label htmlFor="backup-days">Backup Reminder Interval (days, 0 = off)</label>
            <input
              id="backup-days"
              type="number"
              min="0"
              max="3650"
              required
              value={days}
              onChange={(e) => setDays(e.target.value)}
            />
          </div>
          <button type="submit" className="btn sm">Save Reminder</button>
        </form>
        <form id="backup-restore-form" className="row" style={{ alignItems: 'flex-end' }} onSubmit={handleRestore}>
          <div className="field" style={{ flex: 1, minWidth: '220px' }}>
            <label htmlFor="backup-import-file">Restore from Archive (.zip)</label>
            <input id="backup-import-file" ref={fileRef} type="file" accept=".zip" required />
          </div>
          <button type="submit" className="btn danger">Restore Archive</button>
        </form>
        {msg.text && (
          <div id="backup-msg" className={msg.isError ? 'error-msg' : 'ok-msg'} role="status">{msg.text}</div>
        )}
      </div>
      )}

      {tab === 'offsite' && (
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="between" style={{ marginBottom: '.65rem', flexWrap: 'wrap', gap: '.5rem' }}>
          <div>
            <h2 style={{ margin: 0 }}>Automated Scheduled Backups (S3 / Offsite Storage)</h2>
            <p className="muted" style={{ margin: '.2rem 0 0', fontSize: '.88rem' }}>
              Schedule automatic encrypted snapshots to MinIO or an external S3-compatible bucket.
            </p>
          </div>
          <button type="button" className="btn sm primary" onClick={runOffsiteNow} disabled={runningOffsite}>
            {runningOffsite ? 'Uploading…' : 'Run Offsite Backup Now'}
          </button>
        </div>
        <form onSubmit={savePolicy} style={{ display: 'grid', gap: '.75rem' }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem', fontWeight: 600 }}>
            <input
              type="checkbox"
              checked={!!policy.enabled}
              onChange={(e) => setPolicy((p) => ({ ...p, enabled: e.target.checked }))}
            />
            Enable Scheduled Offsite Backups
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '.65rem' }}>
            <div>
              <label className="muted" style={{ fontSize: '.8rem', display: 'block' }}>Schedule Frequency</label>
              <select
                value={policy.schedule_frequency}
                onChange={(e) => setPolicy((p) => ({ ...p, schedule_frequency: e.target.value }))}
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
              </select>
            </div>
            <div>
              <label className="muted" style={{ fontSize: '.8rem', display: 'block' }}>Destination</label>
              <select
                value={policy.target_type}
                onChange={(e) => setPolicy((p) => ({ ...p, target_type: e.target.value }))}
              >
                <option value="minio_offsite">Managed MinIO Object Bucket</option>
                <option value="s3_compatible">External S3-Compatible Endpoint</option>
              </select>
            </div>
            <div>
              <label className="muted" style={{ fontSize: '.8rem', display: 'block' }}>Object Prefix</label>
              <input
                value={policy.s3_prefix}
                onChange={(e) => setPolicy((p) => ({ ...p, s3_prefix: e.target.value }))}
              />
            </div>
            <div>
              <label className="muted" style={{ fontSize: '.8rem', display: 'block' }}>Snapshots to Retain</label>
              <input
                type="number"
                min={1}
                max={3650}
                value={policy.retain_backups_count}
                onChange={(e) => setPolicy((p) => ({ ...p, retain_backups_count: e.target.value }))}
              />
            </div>
          </div>

          {policy.target_type === 's3_compatible' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '.65rem' }}>
              <div>
                <label className="muted" style={{ fontSize: '.8rem', display: 'block' }}>S3 Endpoint Host</label>
                <input
                  placeholder="s3.amazonaws.com"
                  value={policy.s3_endpoint}
                  onChange={(e) => setPolicy((p) => ({ ...p, s3_endpoint: e.target.value }))}
                />
              </div>
              <div>
                <label className="muted" style={{ fontSize: '.8rem', display: 'block' }}>S3 Bucket</label>
                <input
                  placeholder="city-backups"
                  value={policy.s3_bucket}
                  onChange={(e) => setPolicy((p) => ({ ...p, s3_bucket: e.target.value }))}
                />
              </div>
              <div>
                <label className="muted" style={{ fontSize: '.8rem', display: 'block' }}>Access Key</label>
                <input
                  value={policy.s3_access_key}
                  onChange={(e) => setPolicy((p) => ({ ...p, s3_access_key: e.target.value }))}
                />
              </div>
              <div>
                <label className="muted" style={{ fontSize: '.8rem', display: 'block' }}>
                  Secret Key {policy.has_s3_secret ? '(saved)' : ''}
                </label>
                <input
                  type="password"
                  placeholder={policy.has_s3_secret ? '••••••••' : 'Enter secret key'}
                  value={policy.s3_secret_key}
                  onChange={(e) => setPolicy((p) => ({ ...p, s3_secret_key: e.target.value }))}
                />
              </div>
            </div>
          )}

          <div className="actions">
            <button type="submit" className="btn sm primary" disabled={savingPolicy}>
              {savingPolicy ? 'Saving…' : 'Save Offsite Policy'}
            </button>
            {policy.last_offsite_backup_at && (
              <span className="muted" style={{ fontSize: '.84rem' }}>
                Last snapshot: {policy.last_offsite_backup_at}
              </span>
            )}
          </div>
        </form>

        {snapshots.length > 0 && (
          <div style={{ marginTop: '.85rem' }}>
            <h3 style={{ fontSize: '.95rem', marginBottom: '.4rem' }}>Recent Offsite Snapshots ({snapshots.length})</h3>
            <table>
              <thead>
                <tr><th>Object Key</th><th>Size</th><th>Timestamp</th></tr>
              </thead>
              <tbody>
                {snapshots.map((s) => (
                  <tr key={s.object_key}>
                    <td><code>{s.object_key}</code></td>
                    <td>{((s.size_bytes || 0) / 1024).toFixed(1)} KB</td>
                    <td>{s.last_modified || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      )}

      {tab === 'retention' && (
      <div className="card">
        <div className="between" style={{ marginBottom: '.65rem', flexWrap: 'wrap', gap: '.5rem' }}>
          <div>
            <h2 style={{ margin: 0 }}>Record Retention &amp; Auto-Archival Policies</h2>
            <p className="muted" style={{ margin: '.2rem 0 0', fontSize: '.88rem' }}>
              Configure statutory retention windows (0 years = keep indefinitely). Applies only to closed/resolved records.
            </p>
          </div>
          <button type="button" className="btn sm" onClick={runRetentionNow} disabled={runningRetention}>
            {runningRetention ? 'Running…' : 'Run Retention Cleanup Now'}
          </button>
        </div>
        <form onSubmit={savePolicy} style={{ display: 'grid', gap: '.75rem' }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem', fontWeight: 600 }}>
            <input
              type="checkbox"
              checked={!!policy.retention_enabled}
              onChange={(e) => setPolicy((p) => ({ ...p, retention_enabled: e.target.checked }))}
            />
            Enable Automated Retention Policy Enforcement
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '.65rem' }}>
            <div>
              <label className="muted" style={{ fontSize: '.8rem', display: 'block' }}>Closed 311 / Complaints (Years)</label>
              <input
                type="number"
                min={0}
                max={100}
                value={policy.retention_complaints_years}
                onChange={(e) => setPolicy((p) => ({ ...p, retention_complaints_years: e.target.value }))}
              />
            </div>
            <div>
              <label className="muted" style={{ fontSize: '.8rem', display: 'block' }}>Fulfilled FOIA Requests (Years)</label>
              <input
                type="number"
                min={0}
                max={100}
                value={policy.retention_foia_years}
                onChange={(e) => setPolicy((p) => ({ ...p, retention_foia_years: e.target.value }))}
              />
            </div>
            <div>
              <label className="muted" style={{ fontSize: '.8rem', display: 'block' }}>Audit Log Entries (Years)</label>
              <input
                type="number"
                min={0}
                max={100}
                value={policy.retention_audit_years}
                onChange={(e) => setPolicy((p) => ({ ...p, retention_audit_years: e.target.value }))}
              />
            </div>
          </div>
          <div className="actions">
            <button type="submit" className="btn sm primary" disabled={savingPolicy}>
              {savingPolicy ? 'Saving…' : 'Save Retention Policies'}
            </button>
            {policy.last_retention_run_at && (
              <span className="muted" style={{ fontSize: '.84rem' }}>
                Last retention run: {policy.last_retention_run_at}
              </span>
            )}
          </div>
        </form>
      </div>
      )}
    </section>
  );
}
