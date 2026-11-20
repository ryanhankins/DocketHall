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

export default function IntegrationsPage() {
  const showToast = useToast();
  const [cfg, setCfg] = useState(null);
  const [apiKey, setApiKey] = useState('');
  const [projectId, setProjectId] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState({ text: '', isError: false });

  // Outgoing SMTP Email Server state
  const [emailCfg, setEmailCfg] = useState(null);
  const [smtpHost, setSmtpHost] = useState('smtp.gmail.com');
  const [smtpPort, setSmtpPort] = useState('587');
  const [senderEmail, setSenderEmail] = useState('');
  const [appPassword, setAppPassword] = useState('');
  const [testRecipient, setTestRecipient] = useState('');
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailMsg, setEmailMsg] = useState({ text: '', isError: false });
  const [subData, setSubData] = useState({ topics: [], counts: {}, subscribers: [] });

  const loadConfig = useCallback(async () => {
    const [data, em, subs] = await Promise.all([
      api('/api/integrations/google-cloud'),
      api('/api/integrations/email'),
      api('/api/subscriptions').catch(() => ({ topics: [], counts: {}, subscribers: [] })),
    ]);
    setCfg(data);
    setProjectId(data.project_id || '');
    setEnabled(data.has_api_key ? Boolean(data.enabled) : true);

    setEmailCfg(em);
    setSmtpHost(em.smtp_host || 'smtp.gmail.com');
    setSmtpPort(String(em.smtp_port || 587));
    setSenderEmail(em.sender_email || '');
    setEmailEnabled(em.has_password ? Boolean(em.enabled) : true);
    setSubData(subs || { topics: [], counts: {}, subscribers: [] });
  }, []);

  useEffect(() => {
    loadConfig().catch((e) => showToast(e.message, 'error'));
  }, [loadConfig, showToast]);

  async function handleSave(e) {
    e.preventDefault();
    setStatusMsg({ text: '', isError: false });
    if (!cfg?.has_api_key && !apiKey.trim()) {
      setStatusMsg({ text: 'Please enter a Google Cloud API key to link.', isError: true });
      return;
    }
    setBusy(true);
    try {
      const payload = {
        project_id: projectId.trim(),
        enabled,
        validate_key: true,
      };
      if (apiKey.trim()) {
        payload.api_key = apiKey.trim();
      }
      const updated = await api('/api/integrations/google-cloud', {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      setCfg(updated);
      setApiKey('');
      setStatusMsg({
        text: updated.last_status || 'Google Cloud configuration saved.',
        isError: false,
      });
      showToast('Google Cloud settings saved', 'ok');
    } catch (err) {
      setStatusMsg({ text: err.message, isError: true });
    } finally {
      setBusy(false);
    }
  }

  async function handleTest() {
    setStatusMsg({ text: 'Validating API key with Google Cloud…', isError: false });
    setBusy(true);
    try {
      const res = await api('/api/integrations/google-cloud/validate', {
        method: 'POST',
        body: JSON.stringify({ api_key: apiKey.trim() || null }),
      });
      if (res.config) setCfg(res.config);
      setStatusMsg({ text: res.message, isError: !res.valid });
      showToast(res.valid ? 'Google Cloud API key is valid' : 'Google Cloud API key validation failed', res.valid ? 'ok' : 'error');
    } catch (err) {
      setStatusMsg({ text: err.message, isError: true });
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    if (!window.confirm('Remove the stored Google Cloud API key and disable this integration?')) return;
    setBusy(true);
    setStatusMsg({ text: '', isError: false });
    try {
      const updated = await api('/api/integrations/google-cloud', { method: 'DELETE' });
      setCfg(updated);
      setApiKey('');
      setProjectId('');
      setEnabled(true);
      setStatusMsg({ text: 'Google Cloud account unlinked.', isError: false });
      showToast('Google Cloud API key removed', 'ok');
    } catch (err) {
      setStatusMsg({ text: err.message, isError: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="section-integrations">
      <h1>Integrations</h1>
      <div className="card">
        <div className="between" style={{ marginBottom: '.75rem' }}>
          <div>
            <h2 style={{ margin: 0 }}>Google Cloud Account (Optional)</h2>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              Optionally link a Google Cloud API key for future Google services. Keys are validated directly against the Google Cloud API before saving.
            </p>
          </div>
          {cfg && (
            <span className={`badge ${cfg.has_api_key && cfg.enabled ? 'active' : 'disabled'}`}>
              {cfg.has_api_key ? (cfg.enabled ? 'Linked & Enabled' : 'Linked (Disabled)') : 'Not Linked'}
            </span>
          )}
        </div>

        {cfg?.has_api_key && (
          <div
            style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: 6,
              padding: '.75rem',
              marginBottom: '1rem',
              fontSize: '.88rem',
              display: 'grid',
              gap: '.25rem',
            }}
          >
            <div><strong>Stored API Key:</strong> <code>{cfg.api_key_masked}</code></div>
            {cfg.project_id && <div><strong>Project ID:</strong> {cfg.project_id}</div>}
            <div><strong>Last Validated:</strong> {cfg.validated_at ? formatDate(cfg.validated_at) : 'Not yet validated'}</div>
            {cfg.last_status && <div><strong>Validation Status:</strong> {cfg.last_status}</div>}
          </div>
        )}

        <form onSubmit={handleSave} style={{ display: 'grid', gap: '.9rem', maxWidth: 560 }}>
          <div className="field">
            <label htmlFor="gc-api-key">
              {cfg?.has_api_key ? 'Replace Google Cloud API Key (leave blank to keep current key)' : 'Google Cloud API Key'}
            </label>
            <input
              id="gc-api-key"
              type="password"
              autoComplete="off"
              placeholder={cfg?.has_api_key ? 'Enter new key to replace existing…' : 'AIza…'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="gc-project-id">Google Cloud Project ID (optional)</label>
            <input
              id="gc-project-id"
              placeholder="e.g. my-city-civicdesk"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
            />
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', fontSize: '.9rem' }}>
            <input
              type="checkbox"
              style={{ width: 'auto' }}
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            <span>Enable Google Cloud integration</span>
          </label>

          <div className="actions">
            <button type="submit" className="btn primary" disabled={busy}>
              {busy ? 'Validating…' : 'Validate & Save'}
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy || (!apiKey.trim() && !cfg?.has_api_key)}
              onClick={handleTest}
            >
              Test Connection
            </button>
            {cfg?.has_api_key && (
              <button type="button" className="btn danger" disabled={busy} onClick={handleDisconnect}>
                Unlink Key
              </button>
            )}
          </div>

          {statusMsg.text && (
            <div className={statusMsg.isError ? 'error-msg' : 'ok-msg'} role="status">
              {statusMsg.text}
            </div>
          )}
        </form>
      </div>

      <div className="card">
        <div className="between" style={{ marginBottom: '.75rem' }}>
          <div>
            <h2 style={{ margin: 0 }}>Outgoing Email Server (SMTP)</h2>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              Configure the municipal or organization SMTP server used to send notifications (e.g., Microsoft 365, Google Workspace, SendGrid, or Gmail with an{' '}
              <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer">App Password</a>).
              Configure who receives each notification type inside each module&apos;s Preferences page.
            </p>
          </div>
          {emailCfg && (
            <span className={`badge ${emailCfg.has_password && emailCfg.enabled ? 'active' : 'disabled'}`}>
              {emailCfg.has_password ? (emailCfg.enabled ? 'Enabled' : 'Configured (Disabled)') : 'Not Configured'}
            </span>
          )}
        </div>

        {emailCfg?.has_password && (
          <div
            style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: 6,
              padding: '.75rem',
              marginBottom: '1rem',
              fontSize: '.88rem',
              display: 'grid',
              gap: '.25rem',
            }}
          >
            <div><strong>SMTP Server:</strong> <code>{emailCfg.smtp_host}:{emailCfg.smtp_port}</code></div>
            <div><strong>Sender Account:</strong> {emailCfg.sender_email}</div>
            <div><strong>Stored Password / App Password:</strong> <code>{emailCfg.password_masked}</code></div>
            <div><strong>Last Test Email:</strong> {emailCfg.validated_at ? formatDate(emailCfg.validated_at) : 'Not tested yet'}</div>
            {emailCfg.last_status && <div><strong>Status:</strong> {emailCfg.last_status}</div>}
          </div>
        )}

        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setEmailMsg({ text: '', isError: false });
            setEmailBusy(true);
            try {
              const payload = {
                smtp_host: smtpHost.trim() || 'smtp.gmail.com',
                smtp_port: Number(smtpPort) || 587,
                sender_email: senderEmail.trim(),
                enabled: emailEnabled,
              };
              if (appPassword.trim()) payload.app_password = appPassword.trim();
              const updated = await api('/api/integrations/email', {
                method: 'PUT',
                body: JSON.stringify(payload),
              });
              setEmailCfg(updated);
              setAppPassword('');
              setEmailMsg({ text: 'Outgoing SMTP settings saved.', isError: false });
              showToast('Email settings saved', 'ok');
            } catch (err) {
              setEmailMsg({ text: err.message, isError: true });
            } finally {
              setEmailBusy(false);
            }
          }}
          style={{ display: 'grid', gap: '.9rem', maxWidth: 560 }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: '.75rem' }}>
            <div className="field">
              <label htmlFor="em-host">SMTP Host</label>
              <input
                id="em-host"
                required
                placeholder="smtp.gmail.com"
                value={smtpHost}
                onChange={(e) => setSmtpHost(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="em-port">SMTP Port</label>
              <input
                id="em-port"
                type="number"
                required
                min={1}
                max={65535}
                value={smtpPort}
                onChange={(e) => setSmtpPort(e.target.value)}
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="em-sender">Sender Email / SMTP Username</label>
            <input
              id="em-sender"
              type="email"
              required
              placeholder="e.g. notifications@cityofexample.gov"
              value={senderEmail}
              onChange={(e) => setSenderEmail(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="em-pass">
              {emailCfg?.has_password ? 'Replace SMTP Password / App Password (leave blank to keep current)' : 'SMTP Password / App Password'}
            </label>
            <input
              id="em-pass"
              type="password"
              autoComplete="off"
              placeholder={emailCfg?.has_password ? 'Enter new password to replace…' : 'Enter SMTP password or App Password'}
              value={appPassword}
              onChange={(e) => setAppPassword(e.target.value)}
            />
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', fontSize: '.9rem' }}>
            <input
              type="checkbox"
              style={{ width: 'auto' }}
              checked={emailEnabled}
              onChange={(e) => setEmailEnabled(e.target.checked)}
            />
            <span>Enable outgoing email notifications</span>
          </label>

          <div className="field">
            <label htmlFor="em-test-to">Test Email Recipient</label>
            <input
              id="em-test-to"
              type="email"
              placeholder="Enter email address to send a test message"
              value={testRecipient}
              onChange={(e) => setTestRecipient(e.target.value)}
            />
          </div>

          <div className="actions">
            <button type="submit" className="btn primary" disabled={emailBusy}>
              {emailBusy ? 'Saving…' : 'Save Email Settings'}
            </button>
            <button
              type="button"
              className="btn"
              disabled={emailBusy || !emailCfg?.has_password || !testRecipient.trim()}
              onClick={async () => {
                setEmailMsg({ text: 'Sending test email…', isError: false });
                setEmailBusy(true);
                try {
                  const res = await api('/api/integrations/email/test', {
                    method: 'POST',
                    body: JSON.stringify({ to_email: testRecipient.trim() }),
                  });
                  if (res.config) setEmailCfg(res.config);
                  setEmailMsg({ text: res.message, isError: false });
                  showToast(res.message, 'ok');
                } catch (err) {
                  setEmailMsg({ text: err.message, isError: true });
                } finally {
                  setEmailBusy(false);
                }
              }}
            >
              Send Test Email
            </button>
            {emailCfg?.has_password && (
              <button
                type="button"
                className="btn danger"
                disabled={emailBusy}
                onClick={async () => {
                  if (!window.confirm('Remove stored SMTP password and disable email notifications?')) return;
                  setEmailBusy(true);
                  try {
                    const updated = await api('/api/integrations/email', { method: 'DELETE' });
                    setEmailCfg(updated);
                    setSmtpHost('smtp.gmail.com');
                    setSmtpPort('587');
                    setSenderEmail('');
                    setAppPassword('');
                    setTestRecipient('');
                    setEmailMsg({ text: 'Email configuration removed.', isError: false });
                    showToast('Email configuration removed', 'ok');
                  } catch (err) {
                    setEmailMsg({ text: err.message, isError: true });
                  } finally {
                    setEmailBusy(false);
                  }
                }}
              >
                Remove Email Config
              </button>
            )}
          </div>

          {emailMsg.text && (
            <div className={emailMsg.isError ? 'error-msg' : 'ok-msg'} role="status">
              {emailMsg.text}
            </div>
          )}
        </form>
      </div>

      <div className="card">
        <div className="between" style={{ marginBottom: '.75rem' }}>
          <div>
            <h2 style={{ margin: 0 }}>Public Alert Subscribers</h2>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              Residents subscribed on the Public Portal for automatic email alerts when agendas, City Code sections, or public records are published.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
            {(subData.topics || []).map((t) => (
              <span key={t.id} className="badge active">
                {t.label}: {subData.counts?.[t.id] ?? 0}
              </span>
            ))}
          </div>
        </div>

        {!(subData.subscribers || []).length ? (
          <p className="muted" style={{ margin: 0 }}>No public subscribers yet.</p>
        ) : (
          <table>
            <thead>
              <tr><th>Email</th><th>Topic</th><th>Status</th><th>Subscribed</th><th>Action</th></tr>
            </thead>
            <tbody>
              {subData.subscribers.map((s) => (
                <tr key={s.id}>
                  <td>{s.email}</td>
                  <td>{s.topic_label}</td>
                  <td>
                    <span className={`badge ${s.is_active ? 'active' : 'disabled'}`}>
                      {s.is_active ? 'Active' : 'Unsubscribed'}
                    </span>
                  </td>
                  <td className="muted">{s.created_at ? formatDate(s.created_at) : '—'}</td>
                  <td>
                    <button
                      type="button"
                      className="btn sm danger"
                      onClick={async () => {
                        await api(`/api/subscriptions/${s.id}`, { method: 'DELETE' });
                        setSubData((prev) => ({
                          ...prev,
                          subscribers: prev.subscribers.filter((x) => x.id !== s.id),
                        }));
                        showToast('Subscriber removed', 'ok');
                      }}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <StripePaymentsCard showToast={showToast} />
    </section>
  );
}

function StripePaymentsCard({ showToast }) {
  const [cfg, setCfg] = useState(null);
  const [secretKey, setSecretKey] = useState('');
  const [pubKey, setPubKey] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [currency, setCurrency] = useState('usd');
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ text: '', isError: false });

  useEffect(() => {
    api('/api/payments/admin/stripe')
      .then((d) => {
        setCfg(d);
        setPubKey(d.publishable_key || '');
        setCurrency(d.currency || 'usd');
        setEnabled(d.has_secret_key ? Boolean(d.enabled) : true);
      })
      .catch(() => {});
  }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    setBusy(true);
    setMsg({ text: '', isError: false });
    try {
      const payload = {
        publishable_key: pubKey.trim(),
        currency: currency.trim() || 'usd',
        enabled,
        validate_key: true,
      };
      if (secretKey.trim()) payload.secret_key = secretKey.trim();
      if (webhookSecret.trim()) payload.webhook_secret = webhookSecret.trim();
      const updated = await api('/api/payments/admin/stripe', {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      setCfg(updated);
      setSecretKey('');
      setWebhookSecret('');
      const okText = updated.last_status || 'Stripe settings saved';
      setMsg({ text: okText, isError: false });
      showToast(okText, 'ok');
    } catch (err) {
      setMsg({ text: err.message, isError: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <div className="between" style={{ marginBottom: '.6rem', flexWrap: 'wrap', gap: '.5rem' }}>
        <div>
          <h2 style={{ margin: 0 }}>Online Payments (Stripe Checkout)</h2>
          <p className="muted" style={{ margin: '.2rem 0 0', fontSize: '.88rem' }}>
            Allow applicants and residents to pay permit fees and hall rental fees online via Stripe.
          </p>
        </div>
        {cfg && (
          <span className={`badge ${cfg.enabled && cfg.has_secret_key ? 'active' : 'disabled'}`}>
            {cfg.enabled && cfg.has_secret_key ? 'Enabled' : 'Not Configured'}
          </span>
        )}
      </div>

      {cfg?.last_status && (
        <div className="muted" style={{ fontSize: '.82rem', marginBottom: '.65rem' }}>
          Status: {cfg.last_status}{cfg.secret_key_masked ? ` · Key: ${cfg.secret_key_masked}` : ''}
        </div>
      )}

      <form onSubmit={handleSave} style={{ display: 'grid', gap: '.7rem' }}>
        <div className="row">
          <div className="field" style={{ flex: 2, minWidth: 220 }}>
            <label htmlFor="stripe-sk">
              {cfg?.has_secret_key ? 'Replace Stripe Secret Key (leave blank to keep current)' : 'Stripe Secret Key (sk_test_... or sk_live_...)'}
            </label>
            <input
              id="stripe-sk"
              type="password"
              autoComplete="off"
              placeholder={cfg?.has_secret_key ? 'Enter new secret key to replace…' : 'sk_test_... or sk_live_...'}
              value={secretKey}
              onChange={(e) => setSecretKey(e.target.value)}
            />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 160 }}>
            <label htmlFor="stripe-cur">Currency</label>
            <select id="stripe-cur" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              <option value="usd">USD ($)</option>
              <option value="cad">CAD ($)</option>
            </select>
          </div>
        </div>

        <div className="row">
          <div className="field" style={{ flex: 1, minWidth: 220 }}>
            <label htmlFor="stripe-wh">
              {cfg?.has_webhook_secret ? 'Replace Webhook Secret (whsec_..., optional)' : 'Webhook Signing Secret (whsec_..., optional)'}
            </label>
            <input
              id="stripe-wh"
              type="password"
              autoComplete="off"
              placeholder={cfg?.has_webhook_secret ? 'Saved (enter to replace)' : 'whsec_...'}
              value={webhookSecret}
              onChange={(e) => setWebhookSecret(e.target.value)}
            />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 220 }}>
            <label>Webhook Endpoint URL (for Stripe Dashboard)</label>
            <input readOnly value={`${window.location.origin}/api/payments/webhook`} />
          </div>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', fontSize: '.9rem', cursor: 'pointer' }}>
          <input
            type="checkbox"
            style={{ width: 'auto', flexShrink: 0 }}
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          <span>Enable Stripe online payments for Permits and Facility Rentals</span>
        </label>

        <div>
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? 'Validating…' : 'Save & Validate Stripe'}
          </button>
        </div>
        {msg.text && (
          <div className={msg.isError ? 'error-msg' : 'ok-msg'} role="status">{msg.text}</div>
        )}
      </form>
    </div>
  );
}
