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
import { api } from './api.js';
import { DEFAULT_THEME, THEME_PRESETS, applyTheme, getThemeContrastWarnings } from './theme.js';
import RichTextEditor from './RichTextEditor.jsx';

const COLOR_FIELDS = [
  { key: 'theme_primary', label: 'Primary Accent (buttons, links, active tabs)' },
  { key: 'theme_secondary', label: 'Secondary Accent (borders, focus rings)' },
  { key: 'theme_tint', label: 'Soft Highlight (active sidebar item)' },
  { key: 'theme_bg', label: 'Page Background' },
  { key: 'theme_surface', label: 'Card & Sidebar Surface' },
  { key: 'theme_header_bg', label: 'Header Background' },
];

export default function GeneralPrefsPage({ onBrandingChange }) {
  const [cityTitle, setCityTitle] = useState('');
  const [alertEnabled, setAlertEnabled] = useState(false);
  const [alertLevel, setAlertLevel] = useState('danger');
  const [alertTitle, setAlertTitle] = useState('');
  const [alertMessage, setAlertMessage] = useState('');
  const [alertLinkUrl, setAlertLinkUrl] = useState('');
  const [alertLinkLabel, setAlertLinkLabel] = useState('');
  const [footerText, setFooterText] = useState('');
  const [cityWebsiteUrl, setCityWebsiteUrl] = useState('');
  const [cityWebsiteLabel, setCityWebsiteLabel] = useState('');
  const [directoryUrl, setDirectoryUrl] = useState('');
  const [directoryLabel, setDirectoryLabel] = useState('');
  const [homeHeading, setHomeHeading] = useState('');
  const [homeIntroBody, setHomeIntroBody] = useState('');
  const [tab, setTab] = useState('identity');
  const [themeColors, setThemeColors] = useState(() => ({ ...DEFAULT_THEME }));
  const [hasLogo, setHasLogo] = useState(false);
  const [logoVer, setLogoVer] = useState(() => Date.now());
  const [dragOver, setDragOver] = useState(false);
  const [msg, setMsg] = useState({ text: '', isError: false });

  useEffect(() => {
    api('/api/branding')
      .then((b) => {
        setCityTitle(b.city_title || '');
        setAlertEnabled(!!b.alert_enabled);
        setAlertLevel(b.alert_level || 'danger');
        setAlertTitle(b.alert_title || '');
        setAlertMessage(b.alert_message || '');
        setAlertLinkUrl(b.alert_link_url || '');
        setAlertLinkLabel(b.alert_link_label || '');
        setFooterText(b.footer_text || '');
        setCityWebsiteUrl(b.city_website_url || '');
        setCityWebsiteLabel(b.city_website_label || '');
        setDirectoryUrl(b.directory_url || '');
        setDirectoryLabel(b.directory_label || '');
        setHomeHeading(b.home_heading || '');
        setHomeIntroBody(b.home_intro_body || '');
        setThemeColors({
          theme_primary: b.theme_primary || DEFAULT_THEME.theme_primary,
          theme_secondary: b.theme_secondary || DEFAULT_THEME.theme_secondary,
          theme_tint: b.theme_tint || DEFAULT_THEME.theme_tint,
          theme_bg: b.theme_bg || DEFAULT_THEME.theme_bg,
          theme_surface: b.theme_surface || DEFAULT_THEME.theme_surface,
          theme_header_bg: b.theme_header_bg || DEFAULT_THEME.theme_header_bg,
        });
        setHasLogo(!!b.has_city_logo);
      })
      .catch(() => {});
  }, []);

  const uploadLogoFile = async (file) => {
    if (!file) return;
    setMsg({ text: 'Uploading logo...', isError: false });
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/branding/logo', {
        method: 'POST',
        body: fd,
        credentials: 'same-origin',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
      const ver = Date.now();
      setHasLogo(!!data.has_city_logo);
      setLogoVer(ver);
      setMsg({ text: 'City logo uploaded.', isError: false });
      onBrandingChange?.({ cityTitle: data.city_title ?? cityTitle, hasLogo: !!data.has_city_logo, logoVer: ver });
    } catch (err) {
      setMsg({ text: err.message, isError: true });
    }
  };

  const handleRemoveLogo = async () => {
    setMsg({ text: '', isError: false });
    try {
      const saved = await api('/api/branding/logo', { method: 'DELETE' });
      const ver = Date.now();
      setHasLogo(!!saved.has_city_logo);
      setLogoVer(ver);
      setMsg({ text: 'City logo removed.', isError: false });
      onBrandingChange?.({ cityTitle: saved.city_title ?? cityTitle, hasLogo: !!saved.has_city_logo, logoVer: ver });
    } catch (err) {
      setMsg({ text: err.message, isError: true });
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setMsg({ text: '', isError: false });
    try {
      const saved = await api('/api/branding', {
        method: 'PUT',
        body: JSON.stringify({
          city_title: cityTitle.trim(),
          alert_enabled: alertEnabled,
          alert_level: alertLevel,
          alert_title: alertTitle.trim(),
          alert_message: alertMessage.trim(),
          alert_link_url: alertLinkUrl.trim(),
          alert_link_label: alertLinkLabel.trim(),
          footer_text: footerText.trim(),
          city_website_url: cityWebsiteUrl.trim(),
          city_website_label: cityWebsiteLabel.trim(),
          directory_url: directoryUrl.trim(),
          directory_label: directoryLabel.trim(),
          home_heading: homeHeading.trim(),
          home_intro_body: homeIntroBody.trim(),
          ...themeColors,
        }),
      });
      setCityTitle(saved.city_title || '');
      const savedTheme = {
        theme_primary: saved.theme_primary || DEFAULT_THEME.theme_primary,
        theme_secondary: saved.theme_secondary || DEFAULT_THEME.theme_secondary,
        theme_tint: saved.theme_tint || DEFAULT_THEME.theme_tint,
        theme_bg: saved.theme_bg || DEFAULT_THEME.theme_bg,
        theme_surface: saved.theme_surface || DEFAULT_THEME.theme_surface,
        theme_header_bg: saved.theme_header_bg || DEFAULT_THEME.theme_header_bg,
      };
      setThemeColors(savedTheme);
      applyTheme(savedTheme);
      setMsg({ text: 'General preferences saved.', isError: false });
      onBrandingChange?.({ cityTitle: saved.city_title || '', hasLogo, logoVer });
    } catch (err) {
      setMsg({ text: err.message, isError: true });
    }
  };

  return (
    <section id="section-preferences-general">
      <h1>General &amp; Branding</h1>
      <div className="tabs">
        <button type="button" className={`btn sm${tab === 'identity' ? ' active' : ''}`} onClick={() => setTab('identity')}>
          Identity &amp; Footer
        </button>
        <button type="button" className={`btn sm${tab === 'homepage' ? ' active' : ''}`} onClick={() => setTab('homepage')}>
          Homepage Text &amp; Alerts
        </button>
        <button type="button" className={`btn sm${tab === 'theme' ? ' active' : ''}`} onClick={() => setTab('theme')}>
          Color Theme
        </button>
        <button type="button" className={`btn sm${tab === 'updates' ? ' active' : ''}`} onClick={() => setTab('updates')}>
          System Updates
        </button>
      </div>

      {tab !== 'updates' && (
        <div className="card">
          <form onSubmit={handleSave}>
            {tab === 'identity' && (
              <>
                <p className="muted" style={{ marginTop: 0 }}>
                  Site-wide city branding, logo, and public portal footer links.
                </p>
                <div className="field" style={{ marginBottom: '.9rem' }}>
                  <label htmlFor="pref-city-title">City Title (appears before DocketHall at the top of each page)</label>
                  <input
                    id="pref-city-title"
                    placeholder="e.g. City of Northfield"
                    value={cityTitle}
                    onChange={(e) => setCityTitle(e.target.value)}
                  />
                </div>
                <div className="field" style={{ marginBottom: '1.1rem' }}>
                  <label htmlFor="pref-logo-file">City Logo (prints on first page &amp; page header)</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', flexWrap: 'wrap' }}>
                    {hasLogo && (
                      <img
                        id="pref-logo-preview"
                        alt="City Logo"
                        src={`/api/branding/logo?t=${logoVer}`}
                        style={{ maxHeight: '72px', maxWidth: '220px', border: '1px solid #cbd2d9', borderRadius: '4px', padding: '4px', background: '#fff' }}
                      />
                    )}
                    <input
                      id="pref-logo-file"
                      type="file"
                      accept="image/png,image/jpeg,image/gif,image/webp,.png,.jpg,.jpeg,.gif,.webp"
                      style={{ width: 'auto' }}
                      onChange={async (e) => {
                        const f = e.target.files?.[0];
                        await uploadLogoFile(f);
                        e.target.value = '';
                      }}
                    />
                    {hasLogo && (
                      <button type="button" id="pref-logo-remove" className="btn sm danger" onClick={handleRemoveLogo}>
                        Remove Logo
                      </button>
                    )}
                  </div>
                  <div
                    id="pref-logo-drop"
                    className={`drop-zone${dragOver ? ' drag-over' : ''}`}
                    style={{ marginTop: '.5rem' }}
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={async (e) => {
                      e.preventDefault();
                      setDragOver(false);
                      const f = e.dataTransfer?.files?.[0];
                      if (f) await uploadLogoFile(f);
                    }}
                  >
                    Drag &amp; drop a city logo image (PNG, JPG, GIF, WEBP) here
                  </div>
                </div>

                <h2 style={{ margin: '1.25rem 0 .4rem', fontSize: '1.05rem' }}>Public Portal Footer</h2>
                <p className="muted" style={{ margin: '0 0 .75rem', fontSize: '.88rem' }}>
                  Shown at the bottom of the Public Portal, Permits Portal, and City Code pages.
                </p>
                <div className="field" style={{ marginBottom: '.75rem' }}>
                  <label htmlFor="pref-footer-text">Footer Contact / Office Hours Text</label>
                  <textarea
                    id="pref-footer-text"
                    rows={2}
                    placeholder="e.g. City Hall · 101 Main St · Mon–Fri 8:00 AM–4:30 PM · (555) 123-4567"
                    value={footerText}
                    onChange={(e) => setFooterText(e.target.value)}
                  />
                </div>
                <div className="row" style={{ marginBottom: '1.1rem' }}>
                  <div className="field" style={{ flex: 2, minWidth: 220 }}>
                    <label htmlFor="pref-city-website-url">Main City Website URL (optional)</label>
                    <input
                      id="pref-city-website-url"
                      type="url"
                      placeholder="https://www.cityofexample.gov"
                      value={cityWebsiteUrl}
                      onChange={(e) => setCityWebsiteUrl(e.target.value)}
                    />
                  </div>
                  <div className="field" style={{ flex: 1, minWidth: 160 }}>
                    <label htmlFor="pref-city-website-label">Website Link Label (optional)</label>
                    <input
                      id="pref-city-website-label"
                      placeholder="Visit Main City Website"
                      value={cityWebsiteLabel}
                      onChange={(e) => setCityWebsiteLabel(e.target.value)}
                    />
                  </div>
                </div>
                <div className="row" style={{ marginBottom: '1.1rem' }}>
                  <div className="field" style={{ flex: 2, minWidth: 220 }}>
                    <label htmlFor="pref-directory-url">Contact / Directory URL (shown in Public Portal header, optional)</label>
                    <input
                      id="pref-directory-url"
                      type="url"
                      placeholder="https://www.cityofexample.gov/staff-directory/"
                      value={directoryUrl}
                      onChange={(e) => setDirectoryUrl(e.target.value)}
                    />
                  </div>
                  <div className="field" style={{ flex: 1, minWidth: 160 }}>
                    <label htmlFor="pref-directory-label">Contact / Directory Label (optional)</label>
                    <input
                      id="pref-directory-label"
                      placeholder="Contact / Directory"
                      value={directoryLabel}
                      onChange={(e) => setDirectoryLabel(e.target.value)}
                    />
                  </div>
                </div>
              </>
            )}

            {tab === 'homepage' && (
              <>
                <h2 style={{ margin: '0 0 .4rem', fontSize: '1.05rem' }}>Public Portal Welcome &amp; Custom Page Text</h2>
                <p className="muted" style={{ margin: '0 0 .75rem', fontSize: '.88rem' }}>
                  Customize the welcome heading and rich intro text displayed on the Public Portal overview page. Manage main-page blog feed display under <strong>Administration → Blog Settings &amp; Feed</strong>.
                </p>
                <div className="field" style={{ marginBottom: '.75rem' }}>
                  <label htmlFor="pref-home-heading">Portal Welcome Heading (blank uses default)</label>
                  <input
                    id="pref-home-heading"
                    placeholder={cityTitle.trim() ? `Welcome to ${cityTitle.trim()}` : 'City Services & Community Hub'}
                    value={homeHeading}
                    onChange={(e) => setHomeHeading(e.target.value)}
                  />
                </div>
                <div style={{ marginBottom: '1.25rem' }}>
                  <RichTextEditor
                    id="pref-home-intro"
                    label="Custom Portal Page Text (blank uses default intro)"
                    rows={6}
                    placeholder="Add custom announcements, City Hall welcome notes, hours, or formatted links..."
                    value={homeIntroBody}
                    onChange={setHomeIntroBody}
                  />
                </div>

                <h2 style={{ margin: '1.25rem 0 .4rem', fontSize: '1.05rem' }}>Urgent Public Alert Banner</h2>
                <p className="muted" style={{ margin: '0 0 .75rem', fontSize: '.88rem' }}>
                  Display an urgent notice across the top of the Public Portal (e.g. snow emergency, water shutoff, or City Hall closure).
                </p>
                <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginBottom: '.75rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    style={{ width: 'auto' }}
                    checked={alertEnabled}
                    onChange={(e) => setAlertEnabled(e.target.checked)}
                  />
                  <span>Show urgent alert banner on Public Portal</span>
                </label>
                <div className="row" style={{ marginBottom: '.75rem' }}>
                  <div className="field" style={{ minWidth: 160 }}>
                    <label htmlFor="pref-alert-level">Severity</label>
                    <select id="pref-alert-level" value={alertLevel} onChange={(e) => setAlertLevel(e.target.value)}>
                      <option value="danger">Emergency (Red)</option>
                      <option value="warning">Advisory / Notice (Amber)</option>
                      <option value="info">Information (Blue)</option>
                    </select>
                  </div>
                  <div className="field" style={{ flex: 1, minWidth: 200 }}>
                    <label htmlFor="pref-alert-title">Short Title (optional)</label>
                    <input
                      id="pref-alert-title"
                      placeholder="e.g. Snow Emergency"
                      value={alertTitle}
                      onChange={(e) => setAlertTitle(e.target.value)}
                    />
                  </div>
                </div>
                <div className="field" style={{ marginBottom: '.75rem' }}>
                  <label htmlFor="pref-alert-message">Alert Message</label>
                  <textarea
                    id="pref-alert-message"
                    rows={2}
                    placeholder="e.g. No street parking until 8:00 AM tomorrow for snow removal."
                    value={alertMessage}
                    onChange={(e) => setAlertMessage(e.target.value)}
                  />
                </div>
                <div className="row" style={{ marginBottom: '1.1rem' }}>
                  <div className="field" style={{ flex: 2, minWidth: 220 }}>
                    <label htmlFor="pref-alert-link-url">Alert Link URL (optional)</label>
                    <input
                      id="pref-alert-link-url"
                      type="url"
                      placeholder="https://..."
                      value={alertLinkUrl}
                      onChange={(e) => setAlertLinkUrl(e.target.value)}
                    />
                  </div>
                  <div className="field" style={{ flex: 1, minWidth: 160 }}>
                    <label htmlFor="pref-alert-link-label">Link Label (optional)</label>
                    <input
                      id="pref-alert-link-label"
                      placeholder="More Details"
                      value={alertLinkLabel}
                      onChange={(e) => setAlertLinkLabel(e.target.value)}
                    />
                  </div>
                </div>
              </>
            )}

            {tab === 'theme' && (
              <>
                <h2 style={{ margin: '0 0 .4rem', fontSize: '1.05rem' }}>Color Theme</h2>
                <p className="muted" style={{ margin: '0 0 .75rem', fontSize: '.88rem' }}>
                  Customize site-wide colors for both the Public Portal and the Staff Workspace.
                </p>
                <div className="actions" style={{ marginBottom: '.85rem' }}>
                  <span className="muted" style={{ fontSize: '.85rem' }}>Presets:</span>
                  {THEME_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      className="btn sm"
                      onClick={() => {
                        const next = { ...preset.colors };
                        setThemeColors(next);
                        applyTheme(next);
                      }}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                    gap: '.75rem',
                    marginBottom: '1.25rem',
                  }}
                >
                  {COLOR_FIELDS.map(({ key, label }) => {
                    const val = themeColors[key] || DEFAULT_THEME[key];
                    const pickerVal = /^#[0-9a-f]{6}$/i.test(val) ? val : DEFAULT_THEME[key];
                    return (
                      <div key={key} className="field">
                        <label htmlFor={`pref-${key}`}>{label}</label>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '.45rem' }}>
                          <input
                            type="color"
                            aria-label={label}
                            value={pickerVal}
                            onChange={(e) => {
                              const next = { ...themeColors, [key]: e.target.value };
                              setThemeColors(next);
                              applyTheme(next);
                            }}
                            style={{ width: 42, height: 34, padding: 2, cursor: 'pointer', flexShrink: 0 }}
                          />
                          <input
                            id={`pref-${key}`}
                            value={val}
                            maxLength={7}
                            onChange={(e) => {
                              const next = { ...themeColors, [key]: e.target.value };
                              setThemeColors(next);
                              if (/^#[0-9a-f]{6}$/i.test(e.target.value)) applyTheme(next);
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>

                {(() => {
                  const contrastWarnings = getThemeContrastWarnings(themeColors);
                  if (!contrastWarnings.length) return null;
                  return (
                    <div
                      className="banner show"
                      role="alert"
                      style={{
                        background: '#fffbeb',
                        borderColor: '#f59e0b',
                        color: '#92400e',
                        flexDirection: 'column',
                        alignItems: 'flex-start',
                        gap: '.35rem',
                        marginBottom: '1rem',
                      }}
                    >
                      <strong>WCAG 2.1 AA Contrast Warning:</strong>
                      <ul style={{ margin: '0 0 0 1.2rem', padding: 0, fontSize: '.86rem' }}>
                        {contrastWarnings.map((w) => <li key={w}>{w}</li>)}
                      </ul>
                    </div>
                  );
                })()}
              </>
            )}

            <button type="submit" className="btn primary">Save General Preferences</button>
            {msg.text && (
              <div className={msg.isError ? 'error-msg' : 'ok-msg'} role="status">{msg.text}</div>
            )}
          </form>
        </div>
      )}

      {tab === 'updates' && <SystemUpdatesCard />}
    </section>
  );
}

function SystemUpdatesCard() {
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [err, setErr] = useState('');

  const loadUpdates = async () => {
    setLoading(true);
    setErr('');
    try {
      const data = await api('/api/system/updates');
      setInfo(data);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUpdates();
  }, []);

  const state = info?.upgrade_status?.state;
  useEffect(() => {
    if (state !== 'queued' && state !== 'running') return undefined;
    const t = setInterval(loadUpdates, 3000);
    return () => clearInterval(t);
  }, [state]);

  const startUpgrade = async () => {
    if (!window.confirm('Pull the latest DocketHall release from GitHub and restart services? Your database and uploaded files will be preserved.')) {
      return;
    }
    setTriggering(true);
    setErr('');
    try {
      await api('/api/system/upgrade', { method: 'POST' });
      await loadUpdates();
    } catch (e) {
      setErr(e.message);
    } finally {
      setTriggering(false);
    }
  };

  return (
    <div className="card">
      <div className="between" style={{ marginBottom: '.65rem', flexWrap: 'wrap', gap: '.5rem' }}>
        <div>
          <h2 style={{ margin: 0 }}>System Version &amp; Updates</h2>
          <p className="muted" style={{ margin: '.2rem 0 0', fontSize: '.86rem' }}>
            Check GitHub for newer DocketHall releases without affecting your database or uploaded files.
          </p>
        </div>
        <div className="actions">
          <button type="button" className="btn sm" disabled={loading} onClick={loadUpdates}>
            {loading ? 'Checking…' : 'Check for Updates'}
          </button>
          {info?.upgrade_supported && (
            <button
              type="button"
              className="btn sm primary"
              disabled={triggering || state === 'queued' || state === 'running'}
              onClick={startUpgrade}
            >
              {state === 'queued' || state === 'running' ? 'Upgrading…' : 'Upgrade Now'}
            </button>
          )}
        </div>
      </div>

      {err && <div className="error-msg" role="alert" style={{ marginBottom: '.65rem' }}>{err}</div>}

      {info && (
        <div style={{ fontSize: '.9rem', display: 'grid', gap: '.45rem' }}>
          <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <div><strong>Running Commit:</strong> <code>{info.current_commit}</code></div>
            <div><strong>Latest on GitHub:</strong> <code>{info.latest_commit}</code></div>
            <div>
              {info.update_available ? (
                <span className="badge" style={{ background: '#fef3c7', color: '#92400e' }}>Update Available</span>
              ) : info.current_commit !== 'unknown' && info.latest_commit !== 'unknown' ? (
                <span className="badge active">Up to Date</span>
              ) : null}
            </div>
          </div>

          {info.github_error && (
            <div className="muted" style={{ fontSize: '.82rem' }}>GitHub check note: {info.github_error}</div>
          )}

          {info.upgrade_status && info.upgrade_status.state && info.upgrade_status.state !== 'idle' && (
            <div style={{ padding: '.55rem .75rem', borderRadius: 6, background: '#f8fafc', border: '1px solid #e2e8f0', fontSize: '.84rem' }}>
              <strong>Upgrade Status:</strong> {info.upgrade_status.state}
              {info.upgrade_status.message ? ` — ${info.upgrade_status.message}` : ''}
            </div>
          )}

          {info.upgrade_log && (
            <details>
              <summary style={{ cursor: 'pointer', fontSize: '.82rem', color: '#2563eb' }}>View Upgrade Log</summary>
              <pre style={{ marginTop: '.4rem', padding: '.6rem', background: '#0f172a', color: '#e2e8f0', borderRadius: 6, fontSize: '.76rem', overflowX: 'auto', maxHeight: 240 }}>
                {info.upgrade_log}
              </pre>
            </details>
          )}

          {Array.isArray(info.recent_commits) && info.recent_commits.length > 0 && (
            <details style={{ marginTop: '.25rem' }}>
              <summary style={{ cursor: 'pointer', fontSize: '.84rem', color: '#2563eb' }}>
                Recent GitHub Commits ({info.repo})
              </summary>
              <ul style={{ margin: '.4rem 0 0 1.1rem', padding: 0, fontSize: '.82rem', lineHeight: 1.55 }}>
                {info.recent_commits.map((c) => (
                  <li key={c.full_sha}>
                    <code>{c.sha}</code> — {c.message}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {!info.upgrade_supported && (
            <div className="muted" style={{ fontSize: '.8rem', marginTop: '.25rem' }}>
              In-app 1-click upgrade activates automatically on VPS deployments installed via <code>scripts/install-vps.sh</code>.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
