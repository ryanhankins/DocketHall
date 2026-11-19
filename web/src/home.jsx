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

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../app.css';
import { ROLE_LABELS, formatDate, formatSize, formatTime12h } from './core/api.js';
import ServiceIcon from './core/ServiceIcon.jsx';
import { CivicDeskLogo, DirectoryHeaderLink, PublicFooter, UrgentAlertBanner } from './core/PublicChrome.jsx';
import { applyTheme } from './core/theme.js';
import { HighlightText, LinkedCodeBody, buildSectionMap, getSearchSnippet } from './modules/codification/codeHelpers.jsx';
import { COMPLAINT_STATUSES, ORDINANCE_PRESETS, StatusBadge } from './modules/complaints/constants.jsx';

const TAB_DEFS = [
  {
    id: 'agendas',
    label: 'Meeting Agendas & Minutes',
    description: 'Browse finalized meeting agendas, full packets, and approved minutes.',
    actionLabel: 'Browse Agendas →',
  },
  {
    id: 'permits',
    label: 'Permits & Fees',
    description: 'Search permit types, view fee schedules, and apply online (account required to submit).',
    actionLabel: 'Explore Permits →',
  },
  {
    id: 'codification',
    label: 'City Code',
    description: 'Search municipal code chapters, read ordinances, and download official section PDFs.',
    actionLabel: 'Search City Code →',
  },
  {
    id: 'records',
    label: 'Public Records',
    description: 'Browse publicly published contracts, resolutions, ordinances, and city agreements.',
    actionLabel: 'Browse Records →',
  },
  {
    id: 'complaints',
    label: 'Complaints',
    description: 'View the public Complaint Log Book or file a complaint at no cost (no account required).',
    actionLabel: 'Open Complaints →',
  },
  {
    id: 'calendar',
    label: 'City Calendar & Facility Reservations',
    description: 'View upcoming meetings, city events, and reserve municipal facilities.',
    actionLabel: 'View Calendar & Reserve →',
  },
];

function AuthModal({ open, initialRegister, initialResetToken, nextUrl, reason, onClose }) {
  const dlgRef = useRef(null);
  const [mode, setMode] = useState(initialResetToken ? 'reset' : (initialRegister ? 'register' : 'login'));
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [resetToken, setResetToken] = useState(initialResetToken || '');
  const [info, setInfo] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (initialResetToken) {
      setMode('reset');
      setResetToken(initialResetToken);
    } else {
      setMode(initialRegister ? 'register' : 'login');
    }
    setError('');
    setInfo('');
  }, [initialRegister, initialResetToken, open]);

  useEffect(() => {
    const dlg = dlgRef.current;
    if (!dlg) return;
    if (open && !dlg.open) dlg.showModal();
    if (!open && dlg.open) dlg.close();
  }, [open]);

  const rawNext = nextUrl && nextUrl.startsWith('/app') ? nextUrl : '/app';
  const safeNext = rawNext.includes('#') ? rawNext : `${rawNext}${location.hash || ''}`;

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setInfo('');
    setBusy(true);
    try {
      if (mode === 'forgot') {
        const r = await fetch('/api/password-reset/request', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifier: identifier.trim() }),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
          setError(data.detail || 'Unable to request password reset.');
        } else {
          setInfo(data.message || 'If an active account matches, a reset link has been sent.');
        }
        return;
      }

      if (mode === 'reset') {
        if (password !== confirmPassword) {
          setError('Passwords do not match.');
          return;
        }
        const r = await fetch('/api/password-reset/confirm', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: resetToken, new_password: password }),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
          setError(data.detail || 'Invalid or expired reset link.');
          return;
        }
        if (location.search.includes('reset=')) {
          history.replaceState(null, '', location.pathname + (location.hash || ''));
        }
        setUsername(data.username || '');
        setPassword('');
        setConfirmPassword('');
        setResetToken('');
        setMode('login');
        setInfo('Password updated. You can now sign in with your new password.');
        return;
      }

      const registerMode = mode === 'register';
      const endpoint = registerMode ? '/api/register' : '/api/login';
      const r = await fetch(endpoint, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim(),
          email: registerMode ? email.trim() : undefined,
          password,
        }),
      });
      if (r.ok) {
        location.replace(safeNext);
        return;
      }
      const data = await r.json().catch(() => ({}));
      if (r.status === 429) {
        setError('Too many attempts. Please wait a minute.');
      } else {
        setError(data.detail || (registerMode ? 'Registration failed.' : 'Invalid username or password.'));
      }
    } catch {
      setError('Unable to reach the server.');
    } finally {
      setBusy(false);
    }
  }

  const heading =
    mode === 'register'
      ? 'Create Applicant Account'
      : mode === 'forgot'
        ? 'Reset Your Password'
        : mode === 'reset'
          ? 'Choose a New Password'
          : 'Sign In to CivicDesk';

  return (
    <dialog ref={dlgRef} onCancel={(e) => { e.preventDefault(); onClose(); }} style={{ maxWidth: 400, width: '92%' }}>
      <h2 style={{ marginTop: 0 }}>{heading}</h2>
      {reason && mode === 'login' && (
        <p className="muted" style={{ marginTop: 0, fontSize: '.9rem' }}>{reason}</p>
      )}
      <form onSubmit={handleSubmit}>
        {mode === 'forgot' ? (
          <div className="field">
            <label htmlFor="auth-ident">Username or Email Address</label>
            <input
              id="auth-ident"
              required
              autoComplete="username"
              placeholder="you@example.com"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
            />
          </div>
        ) : mode === 'reset' ? (
          <>
            <div className="field">
              <label htmlFor="auth-new-pw">New Password (at least 8 characters)</label>
              <input
                id="auth-new-pw"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="auth-confirm-pw">Confirm New Password</label>
              <input
                id="auth-confirm-pw"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
          </>
        ) : (
          <>
            <div className="field">
              <label htmlFor="auth-username">Username</label>
              <input
                id="auth-username"
                required
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            {mode === 'register' && (
              <div className="field">
                <label htmlFor="auth-email">Email (recommended for password reset)</label>
                <input
                  id="auth-email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            )}
            <div className="field">
              <label htmlFor="auth-password">Password</label>
              <input
                id="auth-password"
                type="password"
                required
                minLength={mode === 'register' ? 8 : 1}
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </>
        )}
        {error && <div className="error-msg" role="alert">{error}</div>}
        {info && <div className="ok-msg" role="status">{info}</div>}
        <div className="dialog-actions" style={{ marginTop: '.75rem' }}>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={busy}>
            {busy
              ? 'Please wait…'
              : mode === 'register'
                ? 'Create Account'
                : mode === 'forgot'
                  ? 'Send Reset Link'
                  : mode === 'reset'
                    ? 'Save New Password'
                    : 'Sign In'}
          </button>
        </div>
      </form>
      <div style={{ marginTop: '.75rem', textAlign: 'center', fontSize: '.88rem', display: 'flex', flexDirection: 'column', gap: '.35rem' }}>
        {mode === 'login' && (
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setMode('forgot');
              setError('');
              setInfo('');
            }}
          >
            Forgot password?
          </a>
        )}
        {(mode === 'forgot' || mode === 'reset') ? (
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setMode('login');
              setError('');
              setInfo('');
            }}
          >
            Back to Sign In
          </a>
        ) : (
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setMode((v) => (v === 'register' ? 'login' : 'register'));
              setError('');
              setInfo('');
            }}
          >
            {mode === 'register' ? 'Already have an account? Sign in' : 'Need a citizen/contractor account? Register'}
          </a>
        )}
      </div>
    </dialog>
  );
}

function AgendasPublicTab() {
  const [agendas, setAgendas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [bodyFilter, setBodyFilter] = useState('');
  const [yearFilter, setYearFilter] = useState('');

  useEffect(() => {
    fetch('/api/agendas/public')
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => setAgendas(d.items || []))
      .catch(() => setAgendas([]))
      .finally(() => setLoading(false));
  }, []);

  const bodyOptions = useMemo(() => {
    const set = new Set();
    for (const a of agendas) {
      if (a.body) set.add(a.body);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [agendas]);

  const yearOptions = useMemo(() => {
    const set = new Set();
    for (const a of agendas) {
      const y = (a.meeting_date || '').slice(0, 4);
      if (/^\d{4}$/.test(y)) set.add(y);
    }
    return [...set].sort((a, b) => b.localeCompare(a));
  }, [agendas]);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return agendas.filter((a) => {
      if (bodyFilter && a.body !== bodyFilter) return false;
      if (yearFilter && !(a.meeting_date || '').startsWith(yearFilter)) return false;
      if (ql && !`${a.title} ${a.body || ''} ${a.meeting_date || ''}`.toLowerCase().includes(ql)) return false;
      return true;
    });
  }, [agendas, q, bodyFilter, yearFilter]);

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem' }}>
          <ServiceIcon id="agendas" size={20} badge />
          <div>
            <h2 style={{ margin: 0 }}>Meeting Agendas &amp; Minutes</h2>
            <p className="muted" style={{ margin: '4px 0 0' }}>Finalized meeting agendas, packets, and approved minutes.</p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <select aria-label="Filter by Board" value={bodyFilter} onChange={(e) => setBodyFilter(e.target.value)} style={{ width: 'auto' }}>
            <option value="">All Boards</option>
            {bodyOptions.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <select aria-label="Filter by Year" value={yearFilter} onChange={(e) => setYearFilter(e.target.value)} style={{ width: 'auto' }}>
            <option value="">All Years</option>
            {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <input
            style={{ maxWidth: 240 }}
            placeholder="Search meetings…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>
      {loading ? (
        <p className="muted">Loading agendas…</p>
      ) : !filtered.length ? (
        <p className="muted">No finalized agendas are currently published.</p>
      ) : (
        <table>
          <thead>
            <tr><th>Meeting</th><th>Body</th><th>Date</th><th>Time</th><th>Items</th><th>Documents</th></tr>
          </thead>
          <tbody>
            {filtered.map((a) => (
              <tr key={a.id}>
                <td>
                  <strong>{a.title}</strong>
                  {a.amended_at && (
                    <> <span className="badge draft" title={`Amended ${formatDate(a.amended_at)}`}>Amended</span></>
                  )}
                </td>
                <td>{a.body || '—'}</td>
                <td>{a.meeting_date || '—'}</td>
                <td>{a.meeting_time ? formatTime12h(a.meeting_time) : '—'}</td>
                <td>{a.item_count}</td>
                <td>
                  <div className="actions">
                    <a className="btn sm" href={`/api/agendas/public/${a.id}/packet.pdf?summary=1`} target="_blank" rel="noreferrer">Summary</a>
                    <a className="btn sm primary" href={`/api/agendas/public/${a.id}/packet.pdf`} target="_blank" rel="noreferrer">Full Packet</a>
                    <a className="btn sm" href={`/api/agendas/public/${a.id}/packet.pdf?download=1`} target="_blank" rel="noreferrer">Download</a>
                    <a className="btn sm" href={`/api/agendas/public/${a.id}/minutes.pdf`} target="_blank" rel="noreferrer">
                      {a.minutes_status === 'approved' ? 'Minutes' : 'Minutes (Draft)'}
                    </a>
                    {a.media_url && (
                      <a className="btn sm" href={a.media_url} target="_blank" rel="noreferrer">
                        {a.media_type === 'audio' ? 'Listen Audio' : 'Watch Video'}
                      </a>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function PermitsPublicTab({ me, onRequireAuth }) {
  const [catalog, setCatalog] = useState({ settings: {}, types: [], uses: [] });
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  useEffect(() => {
    fetch('/api/permits/public/catalog')
      .then((r) => (r.ok ? r.json() : { settings: {}, types: [], uses: [] }))
      .then(setCatalog)
      .catch(() => {});
  }, []);

  const typesById = useMemo(() => {
    const map = {};
    for (const t of catalog.types || []) map[t.id] = t;
    return map;
  }, [catalog.types]);

  const filteredUses = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (catalog.uses || []).filter((u) => {
      if (typeFilter && String(u.permit_type_id) !== typeFilter) return false;
      if (!q) return true;
      const t = typesById[u.permit_type_id];
      return `${t?.name || ''} ${u.name} ${u.description || ''}`.toLowerCase().includes(q);
    });
  }, [catalog.uses, typeFilter, search, typesById]);

  const s = catalog.settings || {};

  function handleApply(typeId, useId) {
    const target = `/app#permits-apply?type=${typeId}&use=${useId}`;
    if (me) {
      location.href = target;
    } else {
      onRequireAuth(target, false, 'Sign in or create a free applicant account to submit and track permit applications.');
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {(s.general_instructions || s.required_documents_note || s.fee_schedule_url || s.payment_instructions || s.payment_url) && (
        <div className="card">
          {s.general_instructions && (
            <>
              <h2 style={{ marginTop: 0 }}>Permits &amp; Applications</h2>
              <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: '0 0 1rem', lineHeight: 1.5 }}>{s.general_instructions}</pre>
            </>
          )}
          {s.required_documents_note && (
            <>
              <h3>Required Documents</h3>
              <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: '0 0 1rem', lineHeight: 1.5 }}>{s.required_documents_note}</pre>
            </>
          )}
          {(s.fee_schedule_url || s.payment_instructions || s.payment_url) && (
            <div>
              <h3>Permit Payment &amp; Fee Schedule</h3>
              {s.payment_instructions && <p className="muted" style={{ marginTop: 0 }}>{s.payment_instructions}</p>}
              <div className="actions">
                {s.payment_url && <a className="btn sm primary" href={s.payment_url} target="_blank" rel="noreferrer">Online Payment</a>}
                {s.fee_schedule_url && <a className="btn sm" href={s.fee_schedule_url} target="_blank" rel="noreferrer">{s.fee_schedule_label || 'Fee Schedule'}</a>}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', marginBottom: '1rem' }}>
          <ServiceIcon id="permits" size={20} badge />
          <h2 style={{ margin: 0 }}>Search Permits &amp; Apply Online</h2>
        </div>
        <div className="row" style={{ marginBottom: '1rem', alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: 2, minWidth: 220 }}>
            <label htmlFor="pub-permit-search">Search Permit Type or Use</label>
            <input id="pub-permit-search" placeholder="e.g. Fence, Deck, Plumbing, Sign…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 180 }}>
            <label htmlFor="pub-permit-type">Permit Category</label>
            <select id="pub-permit-type" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="">All Categories</option>
              {(catalog.types || []).map((t) => <option key={t.id} value={String(t.id)}>{t.name}</option>)}
            </select>
          </div>
        </div>
        <table>
          <thead>
            <tr><th>Category</th><th>Permit / Use</th><th>Description</th><th>Fee</th><th></th></tr>
          </thead>
          <tbody>
            {!filteredUses.length ? (
              <tr><td colSpan={5} className="muted">No matching permit types found.</td></tr>
            ) : filteredUses.map((u) => {
              const t = typesById[u.permit_type_id];
              return (
                <tr key={u.id}>
                  <td><strong>{t?.name || '—'}</strong></td>
                  <td>{u.name}</td>
                  <td className="muted">{u.description || '—'}</td>
                  <td>{u.fee_amount || 'TBD'}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button type="button" className="btn sm primary" onClick={() => handleApply(u.permit_type_id, u.id)}>
                      Apply Online
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CodePublicTab() {
  const [chapters, setChapters] = useState([]);
  const [q, setQ] = useState('');
  const [openChapterIds, setOpenChapterIds] = useState({});
  const [activeSection, setActiveSection] = useState(null);
  const [allSectionsMap, setAllSectionsMap] = useState(() => new Map());

  useEffect(() => {
    fetch('/api/codification/public')
      .then((r) => (r.ok ? r.json() : { chapters: [] }))
      .then((d) => setAllSectionsMap(buildSectionMap(d.chapters || [])))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const qs = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : '';
      fetch(`/api/codification/public${qs}`, { signal: controller.signal })
        .then((r) => (r.ok ? r.json() : { chapters: [] }))
        .then((d) => {
          const list = d.chapters || [];
          setChapters(list);
          if (q.trim()) {
            const expanded = {};
            for (const ch of list) expanded[ch.id] = true;
            setOpenChapterIds(expanded);
          }
        })
        .catch(() => {});
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem' }}>
            <ServiceIcon id="codification" size={20} badge />
            <div>
              <h2 style={{ margin: 0 }}>Municipal City Code</h2>
              <p className="muted" style={{ margin: '4px 0 0' }}>Search chapters, read ordinance sections, or open official section PDFs.</p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              style={{ maxWidth: 320 }}
              placeholder="Search section #, title, or text…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <a className="btn sm" href="/api/codification/public/full.pdf?download=1" target="_blank" rel="noreferrer">
              Full Code PDF
            </a>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: activeSection ? '1fr 1.4fr' : '1fr', gap: '1rem', alignItems: 'start' }}>
        <div className="card">
          {!chapters.length ? (
            <p className="muted">No code chapters match your search.</p>
          ) : chapters.map((ch) => {
            const isOpen = !!openChapterIds[ch.id];
            return (
              <div key={ch.id} style={{ borderBottom: '1px solid #e5e7eb', padding: '8px 0' }}>
                <button
                  type="button"
                  onClick={() => setOpenChapterIds((prev) => ({ ...prev, [ch.id]: !prev[ch.id] }))}
                  style={{ width: '100%', textAlign: 'left', background: 'none', border: 0, cursor: 'pointer', fontWeight: 600, fontSize: '1rem', padding: '4px 0', display: 'flex', justifyContent: 'space-between' }}
                >
                  <span>{ch.code_prefix} — {ch.title}</span>
                  <span>{isOpen ? '▾' : '▸'}</span>
                </button>
                {isOpen && (
                  <ul style={{ listStyle: 'none', padding: '4px 0 0 12px', margin: 0, display: 'grid', gap: 4 }}>
                    {(ch.sections || []).map((sec) => {
                      const snippet = getSearchSnippet(sec, q);
                      return (
                        <li key={sec.id}>
                          <button
                            type="button"
                            onClick={() => setActiveSection({ ...sec, chapter_prefix: ch.code_prefix, chapter_title: ch.title })}
                            style={{
                              background: activeSection?.id === sec.id ? '#eff6ff' : 'transparent',
                              border: 0,
                              borderRadius: 4,
                              padding: '4px 6px',
                              textAlign: 'left',
                              width: '100%',
                              cursor: 'pointer',
                            }}
                          >
                            <div>
                              <strong>Sec. <HighlightText text={sec.section_number} query={q} /></strong> — <HighlightText text={sec.title} query={q} />
                            </div>
                            {snippet && (
                              <div className="muted" style={{ fontSize: '.8rem', marginTop: 2 }}>
                                <HighlightText text={snippet} query={q} />
                              </div>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </div>

        {activeSection && (
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>{activeSection.chapter_prefix} — {activeSection.chapter_title}</div>
                <h3 style={{ margin: '4px 0' }}>Section {activeSection.section_number} — {activeSection.title}</h3>
              </div>
              <div className="actions">
                <a className="btn sm primary" href={`/api/codification/sections/${activeSection.id}/pdf`} target="_blank" rel="noreferrer">View PDF</a>
                <button type="button" className="btn sm" onClick={() => setActiveSection(null)}>Close</button>
              </div>
            </div>
            {(activeSection.ordinance_ref || activeSection.effective_date) && (
              <p className="muted" style={{ fontSize: 13 }}>
                Ordinance: {activeSection.ordinance_ref || '—'} · Effective: {activeSection.effective_date || '—'}
              </p>
            )}
            {activeSection.summary && <p><strong>Summary:</strong> {activeSection.summary}</p>}
            <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', lineHeight: 1.55 }}>
              {activeSection.body ? (
                <LinkedCodeBody
                  text={activeSection.body}
                  sectionMap={allSectionsMap}
                  currentSectionId={activeSection.id}
                  onSelectSection={setActiveSection}
                  query={q}
                />
              ) : (
                'Full text is available via the View PDF button above.'
              )}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

function RecordsPublicTab() {
  const [items, setItems] = useState([]);
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [year, setYear] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (category) params.set('category', category);
      const qs = params.toString();
      fetch(`/api/records/public${qs ? `?${qs}` : ''}`, { signal: controller.signal })
        .then((r) => (r.ok ? r.json() : []))
        .then((d) => setItems(Array.isArray(d) ? d : (d.items || [])))
        .catch(() => {})
        .finally(() => setLoading(false));
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q, category]);

  const yearOptions = useMemo(() => {
    const set = new Set();
    for (const r of items) {
      const y = (r.effective_date || r.created_at || '').slice(0, 4);
      if (/^\d{4}$/.test(y)) set.add(y);
    }
    return [...set].sort((a, b) => b.localeCompare(a));
  }, [items]);

  const visibleItems = useMemo(() => {
    if (!year) return items;
    return items.filter((r) => (r.effective_date || r.created_at || '').startsWith(year));
  }, [items, year]);

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem' }}>
          <ServiceIcon id="records" size={20} badge />
          <div>
            <h2 style={{ margin: 0 }}>Public Contracts, Resolutions &amp; Records</h2>
            <p className="muted" style={{ margin: '4px 0 0' }}>Publicly published municipal contracts, resolutions, ordinances, and agreements.</p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input placeholder="Search doc #, title, counterparty…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select aria-label="Filter by Category" value={category} onChange={(e) => setCategory(e.target.value)} style={{ width: 'auto' }}>
            <option value="">All Categories</option>
            {['Contract', 'Resolution', 'Ordinance', 'Agreement', 'Easement', 'Policy', 'Other'].map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <select aria-label="Filter by Year" value={year} onChange={(e) => setYear(e.target.value)} style={{ width: 'auto' }}>
            <option value="">All Years</option>
            {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {loading ? (
        <p className="muted">Loading public records…</p>
      ) : !visibleItems.length ? (
        <p className="muted">No public repository documents match your search.</p>
      ) : (
        <table>
          <thead>
            <tr><th>Doc #</th><th>Title</th><th>Category</th><th>Counterparty</th><th>Effective</th><th>Files</th></tr>
          </thead>
          <tbody>
            {visibleItems.map((r) => (
              <tr key={r.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{r.doc_number || '—'}</td>
                <td>
                  <strong>{r.title}</strong>
                  {r.notes && <div className="muted" style={{ fontSize: 12 }}>{r.notes}</div>}
                </td>
                <td>{r.category}</td>
                <td>{r.counterparty || '—'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{r.effective_date || '—'}</td>
                <td>
                  {(r.files || []).length === 0 ? '—' : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {r.files.map((f) => (
                        <a key={f.id} href={`/api/records/public/files/${f.id}/download`} target="_blank" rel="noreferrer">
                          {f.filename} ({formatSize(f.size_bytes)})
                        </a>
                      ))}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ComplaintsPublicTab({ me, onRequireAuth }) {
  const [subView, setSubView] = useState('log'); // 'log' | 'file'
  const [items, setItems] = useState([]);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);

  // Public complaint filing state
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [isRealProperty, setIsRealProperty] = useState(true);
  const [complainantName, setComplainantName] = useState('');
  const [complainantEmail, setComplainantEmail] = useState('');
  const [complainantPhone, setComplainantPhone] = useState('');
  const [complainantAddress, setComplainantAddress] = useState('');
  const [subjectProperty, setSubjectProperty] = useState('');
  const [subjectPerson, setSubjectPerson] = useState('');
  const [ordinance, setOrdinance] = useState('');
  const [dateObserved, setDateObserved] = useState('');
  const [conduct, setConduct] = useState('');
  const [files, setFiles] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [formMsg, setFormMsg] = useState({ text: '', isError: false });

  const loadLog = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (statusFilter) params.set('status', statusFilter);
    const qs = params.toString();
    fetch(`/api/complaints/public-log${qs ? `?${qs}` : ''}`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => setItems(d.items || []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [q, statusFilter]);

  useEffect(() => {
    loadLog();
  }, [loadLog]);

  async function handleFileComplaint(e) {
    e.preventDefault();
    setFormMsg({ text: '', isError: false });
    if (!conduct.trim()) {
      setFormMsg({ text: 'Please describe the specific conduct complained about.', isError: true });
      return;
    }
    setSubmitting(true);
    try {
      const r = await fetch('/api/complaints/public', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intake_channel: isAnonymous ? 'anonymous' : 'written',
          is_anonymous: isAnonymous,
          is_real_property_complaint: isRealProperty,
          complainant_name: isAnonymous ? '' : complainantName,
          complainant_email: isAnonymous ? '' : complainantEmail,
          complainant_phone: isAnonymous ? '' : complainantPhone,
          complainant_address: isAnonymous ? '' : complainantAddress,
          subject_property_address: subjectProperty,
          subject_person_name: subjectPerson,
          ordinance_section: ordinance,
          date_observed: dateObserved,
          conduct_description: conduct,
        }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to submit complaint');
      }
      const created = await r.json();
      for (const f of files) {
        const fd = new FormData();
        fd.append('file', f);
        fd.append('doc_category', 'evidence');
        fd.append('title', f.name);
        await fetch(`/api/complaints/${created.id}/documents`, {
          method: 'POST',
          credentials: 'same-origin',
          body: fd,
        });
      }
      setFormMsg({
        text: `Complaint ${created.complaint_number} filed at no cost. Confidential complainant details are protected under applicable public-records law.`,
        isError: false,
      });
      setConduct('');
      setSubjectProperty('');
      setSubjectPerson('');
      setDateObserved('');
      setFiles([]);
      loadLog();
    } catch (err) {
      setFormMsg({ text: err.message || 'Failed to submit complaint', isError: true });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem' }}>
          <ServiceIcon id="complaints" size={20} badge />
          <div>
            <h2 style={{ margin: 0 }}>Administrative &amp; Code Complaints</h2>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              View the public Complaint Log Book or file a complaint at no cost without an account.
            </p>
          </div>
        </div>
        <div className="actions">
          <button type="button" className={`btn sm${subView === 'log' ? ' primary' : ''}`} onClick={() => setSubView('log')}>
            Complaint Log Book
          </button>
          <button type="button" className={`btn sm${subView === 'file' ? ' primary' : ''}`} onClick={() => setSubView('file')}>
            + File a Complaint (No Account Required)
          </button>
        </div>
      </div>

      {subView === 'file' ? (
        <form className="card" onSubmit={handleFileComplaint} style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <h3 style={{ margin: 0 }}>File a Complaint (No Fee)</h3>
            {!me && (
              <span className="muted" style={{ fontSize: 13 }}>
                Want to track your non-anonymous complaints later?{' '}
                <a href="#" onClick={(e) => { e.preventDefault(); onRequireAuth('/app#my-complaints', false, 'Sign in or create an account to track your complaints.'); }}>
                  Sign in / Register
                </a>
              </span>
            )}
          </div>
          <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: 12, display: 'grid', gap: 8 }}>
            <strong>Complainant Privacy &amp; Contact (Confidential — Never in Public Log)</strong>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={isAnonymous} onChange={(e) => setIsAnonymous(e.target.checked)} />
              <span>File anonymously (accepted at staff discretion)</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={isRealProperty} onChange={(e) => setIsRealProperty(e.target.checked)} />
              <span>Complaint involves the use of real property (confidential complainant protection)</span>
            </label>
            {!isAnonymous && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
                <label>
                  <div className="muted" style={{ fontSize: 12 }}>Your Name (Private)</div>
                  <input value={complainantName} onChange={(e) => setComplainantName(e.target.value)} />
                </label>
                <label>
                  <div className="muted" style={{ fontSize: 12 }}>Email (Private)</div>
                  <input type="email" value={complainantEmail} onChange={(e) => setComplainantEmail(e.target.value)} />
                </label>
                <label>
                  <div className="muted" style={{ fontSize: 12 }}>Phone (Private)</div>
                  <input value={complainantPhone} onChange={(e) => setComplainantPhone(e.target.value)} />
                </label>
                <label>
                  <div className="muted" style={{ fontSize: 12 }}>Your Address (Private)</div>
                  <input value={complainantAddress} onChange={(e) => setComplainantAddress(e.target.value)} />
                </label>
              </div>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
            <label>
              <div className="muted" style={{ fontSize: 12 }}>Property / Location Involved</div>
              <input value={subjectProperty} onChange={(e) => setSubjectProperty(e.target.value)} placeholder="e.g. 123 Main St" />
            </label>
            <label>
              <div className="muted" style={{ fontSize: 12 }}>Person(s) Involved (if known)</div>
              <input value={subjectPerson} onChange={(e) => setSubjectPerson(e.target.value)} />
            </label>
            <label>
              <div className="muted" style={{ fontSize: 12 }}>Ordinance Provision (if known)</div>
              <input list="pub-ord-presets" value={ordinance} onChange={(e) => setOrdinance(e.target.value)} />
              <datalist id="pub-ord-presets">
                {ORDINANCE_PRESETS.map((o) => <option key={o} value={o} />)}
              </datalist>
            </label>
            <label>
              <div className="muted" style={{ fontSize: 12 }}>Date Observed</div>
              <input type="date" value={dateObserved} onChange={(e) => setDateObserved(e.target.value)} />
            </label>
          </div>
          <label style={{ display: 'block', width: '100%' }}>
            <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Specific Conduct Complained About *</div>
            <textarea
              rows={8}
              required
              style={{ width: '100%', minHeight: 180, boxSizing: 'border-box', resize: 'vertical' }}
              value={conduct}
              onChange={(e) => setConduct(e.target.value)}
              placeholder="Describe the conduct, location, and any prior personal contact attempts..."
            />
          </label>
          <label>
            <div className="muted" style={{ fontSize: 12 }}>Supporting Photos or Documents (optional)</div>
            <input type="file" multiple onChange={(e) => setFiles(Array.from(e.target.files || []))} />
          </label>
          {formMsg.text && <div className={formMsg.isError ? 'error-msg' : 'ok-msg'} role="status">{formMsg.text}</div>}
          <div>
            <button type="submit" className="btn primary" disabled={submitting}>
              {submitting ? 'Submitting…' : 'Submit Complaint (No Fee)'}
            </button>
          </div>
        </form>
      ) : (
        <div className="card">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const num = (e.currentTarget.elements.trackNum?.value || '').trim();
              if (!num) return;
              try {
                const r = await fetch(`/api/complaints/public-lookup?number=${encodeURIComponent(num)}`);
                const d = await r.json().catch(() => ({}));
                if (!r.ok) throw new Error(d.detail || 'Complaint not found');
                setSelected(d);
              } catch (err) {
                alert(err.message || 'Complaint not found');
              }
            }}
            style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: '.85rem', paddingBottom: '.75rem', borderBottom: '1px solid #e5e7eb' }}
          >
            <strong style={{ fontSize: '.9rem' }}>Track by Number:</strong>
            <input name="trackNum" placeholder="e.g. COM-2026-0001" style={{ maxWidth: 200 }} />
            <button type="submit" className="btn sm">Look Up</button>
          </form>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: '1rem' }}>
            <input style={{ flex: '1 1 240px' }} placeholder="Search complaint #, property, ordinance, resolution…" value={q} onChange={(e) => setQ(e.target.value)} />
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All Statuses</option>
              {COMPLAINT_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: selected ? '1.3fr 1fr' : '1fr', gap: 16, alignItems: 'start' }}>
            <div>
              {loading ? (
                <p className="muted">Loading complaint log…</p>
              ) : !items.length ? (
                <p className="muted">No complaints in the public log match your filters.</p>
              ) : (
                <table>
                  <thead>
                    <tr><th>Complaint #</th><th>Received</th><th>Property / Subject</th><th>Ordinance</th><th>Status</th><th>Resolution</th></tr>
                  </thead>
                  <tbody>
                    {items.map((c) => (
                      <tr key={c.id} onClick={() => setSelected(c)} style={{ cursor: 'pointer', background: selected?.id === c.id ? '#eff6ff' : 'transparent' }}>
                        <td style={{ whiteSpace: 'nowrap', fontWeight: 500 }}>
                          <button type="button" className="link-btn" onClick={(e) => { e.stopPropagation(); setSelected(c); }}>
                            {c.complaint_number}
                          </button>
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>{formatDate(c.created_at)}</td>
                        <td>{c.subject_property_address || c.subject_person_name || '—'}</td>
                        <td>{c.ordinance_section || '—'}</td>
                        <td><StatusBadge status={c.status} /></td>
                        <td>{c.final_resolution ? `${c.final_resolution.slice(0, 70)}${c.final_resolution.length > 70 ? '…' : ''}` : <span className="muted">Pending</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            {selected && (
              <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12, display: 'grid', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 style={{ margin: 0 }}>{selected.complaint_number}</h3>
                  <button type="button" className="btn sm" onClick={() => setSelected(null)}>Close</button>
                </div>
                <div><StatusBadge status={selected.status} /></div>
                <div><strong>Property:</strong> {selected.subject_property_address || '—'}</div>
                <div><strong>Ordinance:</strong> {selected.ordinance_section || '—'}</div>
                <div><strong>Conduct:</strong> {selected.conduct_description}</div>
                {selected.investigation_report && (
                  <div style={{ background: '#f8fafc', padding: 8, borderRadius: 6 }}>
                    <strong>Investigation Report:</strong> {selected.investigation_report}
                  </div>
                )}
                {selected.final_resolution && (
                  <div style={{ background: '#f0fdf4', padding: 8, borderRadius: 6 }}>
                    <strong>Final Resolution:</strong> {selected.final_resolution}
                  </div>
                )}
                {(selected.messages || []).length > 0 && (
                  <div>
                    <strong>Updates:</strong>
                    <div style={{ display: 'grid', gap: 6, marginTop: 4 }}>
                      {selected.messages.map((m) => (
                        <div key={m.id} style={{ background: '#f8fafc', padding: 8, borderRadius: 6, fontSize: 13 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                            <strong>{m.sender_username || 'City Staff'}</strong>
                            <span className="muted" style={{ fontSize: 11 }}>{formatDate(m.created_at)}</span>
                          </div>
                          <div>{m.body}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {(selected.documents || []).length > 0 && (
                  <div>
                    <strong>Public Documents:</strong>
                    <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                      {selected.documents.map((d) => (
                        <li key={d.id}>
                          <a href={`/api/complaints/documents/${d.id}/download`} target="_blank" rel="noreferrer">{d.filename}</a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function CalendarPublicTab() {
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [data, setData] = useState({ facilities: [], items: [], booked_slots: [] });
  const [loading, setLoading] = useState(true);
  const [facId, setFacId] = useState('');
  const [evDate, setEvDate] = useState('');
  const [evTitle, setEvTitle] = useState('');
  const [reqName, setReqName] = useState('');
  const [reqEmail, setReqEmail] = useState('');
  const [reqPhone, setReqPhone] = useState('');
  const [reqNotes, setReqNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ text: '', isError: false });

  useEffect(() => {
    setLoading(true);
    fetch(`/api/calendar/public?month=${encodeURIComponent(month)}`)
      .then((r) => (r.ok ? r.json() : { facilities: [], items: [], booked_slots: [] }))
      .then((d) => {
        setData(d);
        const facs = d.facilities || [];
        if (facs.length) {
          setFacId((prev) => (prev && facs.some((f) => String(f.id) === String(prev)) ? prev : String(facs[0].id)));
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [month]);

  function shiftMonth(delta) {
    const [y, m] = month.split('-').map(Number);
    const dt = new Date(y, m - 1 + delta, 1);
    setMonth(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`);
  }

  const [yr, mo] = month.split('-').map(Number);
  const firstDow = new Date(yr, mo - 1, 1).getDay();
  const daysInMonth = new Date(yr, mo, 0).getDate();
  const monthLabel = new Date(yr, mo - 1, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' });
  const itemsByDay = useMemo(() => {
    const m = {};
    for (const it of data.items || []) {
      if (!m[it.event_date]) m[it.event_date] = [];
      m[it.event_date].push(it);
    }
    return m;
  }, [data.items]);

  const selectedFac = (data.facilities || []).find((f) => String(f.id) === String(facId)) || null;
  const dateBooked = Boolean(
    evDate &&
      facId &&
      (data.booked_slots || []).some((b) => String(b.facility_id) === String(facId) && b.event_date === evDate),
  );

  async function handleReserve(e) {
    e.preventDefault();
    setMsg({ text: '', isError: false });
    setBusy(true);
    try {
      const r = await fetch('/api/calendar/reservations/public', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          facility_id: Number(facId),
          event_date: evDate,
          event_title: evTitle.trim(),
          requester_name: reqName.trim(),
          requester_email: reqEmail.trim(),
          requester_phone: reqPhone.trim(),
          notes: reqNotes.trim(),
        }),
      });
      const res = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(res.detail || 'Reservation request failed');
      setMsg({
        text: `Request ${res.reservation_number} submitted for ${res.facility_name} on ${res.event_date}. Staff will confirm shortly.`,
        isError: false,
      });
      setEvTitle('');
      setReqNotes('');
    } catch (err) {
      setMsg({ text: err.message, isError: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div className="card">
        <div className="between" style={{ marginBottom: '1rem', flexWrap: 'wrap', gap: '.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem' }}>
            <ServiceIcon id="calendar" size={20} badge />
            <div>
              <h2 style={{ margin: 0 }}>City Calendar &amp; Hall Rentals</h2>
              <p className="muted" style={{ margin: '4px 0 0' }}>
                Public meetings, community events, and facility availability.
              </p>
            </div>
          </div>
          <div className="actions">
            <button type="button" className="btn sm" onClick={() => shiftMonth(-1)}>&larr; Prev</button>
            <strong style={{ minWidth: 140, textAlign: 'center' }}>{monthLabel}</strong>
            <button type="button" className="btn sm" onClick={() => shiftMonth(1)}>Next &rarr;</button>
          </div>
        </div>

        {loading ? (
          <p className="muted">Loading calendar…</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 4 }}>
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
              <div key={d} style={{ fontSize: '.78rem', fontWeight: 700, color: '#64748b', textAlign: 'center', paddingBottom: 4 }}>
                {d}
              </div>
            ))}
            {Array.from({ length: firstDow }).map((_, i) => (
              <div key={`pad-${i}`} style={{ minHeight: 74, background: '#f8fafc', borderRadius: 4 }} />
            ))}
            {Array.from({ length: daysInMonth }).map((_, idx) => {
              const dayNum = idx + 1;
              const iso = `${month}-${String(dayNum).padStart(2, '0')}`;
              const dayItems = itemsByDay[iso] || [];
              return (
                <div
                  key={iso}
                  onClick={() => setEvDate(iso)}
                  style={{
                    minHeight: 74,
                    border: evDate === iso ? '2px solid #2563eb' : '1px solid #e2e8f0',
                    borderRadius: 4,
                    padding: 4,
                    background: '#fff',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 3,
                  }}
                >
                  <div style={{ fontSize: '.78rem', fontWeight: 700, color: '#334155' }}>{dayNum}</div>
                  {dayItems.map((it) => (
                    <div
                      key={it.uid}
                      title={`${it.category}: ${it.title}${it.start_time ? ` (${it.start_time})` : ''}`}
                      style={{
                        fontSize: '.72rem',
                        lineHeight: 1.25,
                        padding: '2px 4px',
                        borderRadius: 3,
                        background:
                          it.kind === 'meeting'
                            ? '#eff6ff'
                            : it.kind === 'reservation'
                              ? '#fef2f2'
                              : '#ecfdf5',
                        color:
                          it.kind === 'meeting'
                            ? '#1d4ed8'
                            : it.kind === 'reservation'
                              ? '#991b1b'
                              : '#065f46',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {it.title}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {(data.facilities || []).length > 0 && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Reserve a City Facility</h3>
          <p className="muted" style={{ marginTop: 0 }}>
            Click a date on the calendar above or choose a date below to request a reservation.
          </p>
          <form onSubmit={handleReserve} style={{ display: 'grid', gap: '.75rem', maxWidth: 680 }}>
            <div className="row">
              <div className="field" style={{ flex: 2, minWidth: 220 }}>
                <label htmlFor="res-facility">Facility *</label>
                <select id="res-facility" value={facId} onChange={(e) => setFacId(e.target.value)}>
                  {data.facilities.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name} ({f.daily_fee}/day)
                    </option>
                  ))}
                </select>
              </div>
              <div className="field" style={{ flex: 1, minWidth: 160 }}>
                <label htmlFor="res-date">Event Date *</label>
                <input id="res-date" type="date" required value={evDate} onChange={(e) => setEvDate(e.target.value)} />
              </div>
            </div>
            {selectedFac && (selectedFac.description || selectedFac.rules || selectedFac.capacity) && (
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '.6rem .75rem', fontSize: '.86rem' }}>
                <div>
                  <strong>{selectedFac.name}</strong> — {selectedFac.daily_fee} per day
                  {selectedFac.capacity ? ` · Capacity: ${selectedFac.capacity}` : ''}
                </div>
                {selectedFac.description && <div className="muted">{selectedFac.description}</div>}
                {selectedFac.rules && <div className="muted" style={{ marginTop: 2 }}>Rules: {selectedFac.rules}</div>}
              </div>
            )}
            {dateBooked && (
              <div className="error-msg" role="alert">
                {selectedFac?.name || 'This facility'} is already reserved on {evDate}. Please choose another date.
              </div>
            )}
            <div className="row">
              <div className="field" style={{ flex: 1, minWidth: 180 }}>
                <label htmlFor="res-name">Your Name *</label>
                <input id="res-name" required value={reqName} onChange={(e) => setReqName(e.target.value)} />
              </div>
              <div className="field" style={{ flex: 1, minWidth: 180 }}>
                <label htmlFor="res-email">Email</label>
                <input id="res-email" type="email" value={reqEmail} onChange={(e) => setReqEmail(e.target.value)} />
              </div>
              <div className="field" style={{ flex: 1, minWidth: 160 }}>
                <label htmlFor="res-phone">Phone</label>
                <input id="res-phone" value={reqPhone} onChange={(e) => setReqPhone(e.target.value)} />
              </div>
            </div>
            <div className="row">
              <div className="field" style={{ flex: 1, minWidth: 200 }}>
                <label htmlFor="res-title">Event Type / Title (optional)</label>
                <input id="res-title" placeholder="e.g. Family Reunion, Birthday Party" value={evTitle} onChange={(e) => setEvTitle(e.target.value)} />
              </div>
              <div className="field" style={{ flex: 1, minWidth: 220 }}>
                <label htmlFor="res-notes">Notes (optional)</label>
                <input id="res-notes" value={reqNotes} onChange={(e) => setReqNotes(e.target.value)} />
              </div>
            </div>
            <div className="actions">
              <button type="submit" className="btn primary" disabled={busy || dateBooked}>
                {busy ? 'Submitting…' : 'Submit Reservation Request'}
              </button>
            </div>
            {msg.text && (
              <div className={msg.isError ? 'error-msg' : 'ok-msg'} role="status">
                {msg.text}
              </div>
            )}
          </form>
        </div>
      )}
    </div>
  );
}


function NotifyMeCard() {
  const [topics, setTopics] = useState([]);
  const [selected, setSelected] = useState([]);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ text: '', isError: false });

  useEffect(() => {
    fetch('/api/subscriptions/topics')
      .then((r) => (r.ok ? r.json() : { topics: [] }))
      .then((d) => {
        const list = Array.isArray(d.topics) ? d.topics : [];
        setTopics(list);
        setSelected(list.map((t) => t.id));
      })
      .catch(() => {});
  }, []);

  if (!topics.length) return null;

  function toggleTopic(id) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function handleSubscribe(e) {
    e.preventDefault();
    setMsg({ text: '', isError: false });
    if (!selected.length) {
      setMsg({ text: 'Please select at least one alert topic.', isError: true });
      return;
    }
    setBusy(true);
    try {
      const r = await fetch('/api/subscriptions/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), topics: selected }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.detail || 'Subscription failed');
      setMsg({ text: data.message || 'Subscribed to email alerts.', isError: false });
      setEmail('');
    } catch (err) {
      setMsg({ text: err.message, isError: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.65rem', marginBottom: '.35rem' }}>
            <ServiceIcon id="alerts" size={20} badge />
            <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Public Email Alerts</h2>
          </div>
          <p className="muted" style={{ margin: '0 0 .75rem', fontSize: '.9rem' }}>
            Subscribe to receive automatic email alerts whenever new city agendas, code updates, or public records are published. Every email includes a one-click unsubscribe link.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem 1.25rem', marginBottom: '.75rem' }}>
            {topics.map((t) => (
              <label key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '.4rem', fontSize: '.9rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  style={{ width: 'auto' }}
                  checked={selected.includes(t.id)}
                  onChange={() => toggleTopic(t.id)}
                />
                <span>{t.label}</span>
              </label>
            ))}
          </div>
          <form onSubmit={handleSubscribe} style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem', alignItems: 'center', maxWidth: 460 }}>
            <input
              type="email"
              required
              aria-label="Email address for public alerts"
              placeholder="Enter your email address…"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{ flex: 1, minWidth: 220 }}
            />
            <button type="submit" className="btn primary" disabled={busy}>
              {busy ? 'Subscribing…' : 'Subscribe'}
            </button>
          </form>
          {msg.text && (
            <div className={msg.isError ? 'error-msg' : 'ok-msg'} style={{ marginTop: '.6rem' }} role="status">
              {msg.text}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


function PublicHomePage() {
  const params = useMemo(() => new URLSearchParams(location.search), []);
  const [branding, setBranding] = useState({ city_title: '', has_city_logo: false });
  const [enabledModules, setEnabledModules] = useState(null);
  const [me, setMe] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');

  const [authModal, setAuthModal] = useState(() => ({
    open: params.has('next') || params.get('register') === '1' || params.has('reset'),
    register: params.get('register') === '1',
    resetToken: params.get('reset') || '',
    nextUrl: params.get('next') || '/app',
    reason: params.has('next') ? 'Please sign in to continue to your requested workspace page.' : '',
  }));

  useEffect(() => {
    fetch('/api/branding')
      .then((r) => (r.ok ? r.json() : {}))
      .then((b) => {
        setBranding(b || {});
        applyTheme(b || {});
        const title = (b?.city_title || '').trim();
        document.title = title ? `${title} - CivicDesk` : 'CivicDesk — Public Portal';
      })
      .catch(() => {});

    fetch('/api/me', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((user) => {
        setMe(user);
        if (user && params.has('next') && params.get('next').startsWith('/app')) {
          const raw = params.get('next');
          location.replace(raw.includes('#') ? raw : `${raw}${location.hash || ''}`);
        }
      })
      .catch(() => setMe(null));

    fetch('/api/modules/public')
      .then((r) => (r.ok ? r.json() : { enabled: [] }))
      .then((d) => {
        const list = Array.isArray(d.enabled) ? d.enabled : [];
        setEnabledModules(list);
        const hashTab = location.hash.replace(/^#/, '');
        setActiveTab(list.includes(hashTab) ? hashTab : 'overview');
      })
      .catch(() => setEnabledModules([]));
  }, [params]);

  useEffect(() => {
    const onHash = () => {
      const h = location.hash.replace(/^#/, '');
      if (!h || h === 'overview') {
        setActiveTab('overview');
      } else if (enabledModules?.includes(h)) {
        setActiveTab(h);
      }
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [enabledModules]);

  const visibleTabs = useMemo(() => {
    if (!enabledModules) return [];
    return TAB_DEFS.filter((t) => enabledModules.includes(t.id));
  }, [enabledModules]);

  function openAuth(nextUrl = '/app', register = false, reason = '') {
    setAuthModal({ open: true, register, nextUrl, reason });
  }

  function selectTab(tabId) {
    setActiveTab(tabId);
    const targetHash = tabId === 'overview' ? '#overview' : `#${tabId}`;
    if (location.hash !== targetHash) {
      history.pushState(null, '', targetHash);
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <UrgentAlertBanner branding={branding} />
      <header>
        <a
          href="/#overview"
          className="brand"
          style={{ display: 'flex', alignItems: 'center', gap: '.55rem', textDecoration: 'none', color: 'inherit' }}
          onClick={(e) => {
            e.preventDefault();
            selectTab('overview');
          }}
        >
          {branding.has_city_logo && (
            <img alt="City Logo" src="/api/branding/logo" style={{ height: '52px', width: 'auto', borderRadius: '4px', objectFit: 'contain' }} />
          )}
          {branding.city_title && <span>{branding.city_title}</span>}
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem' }}>
            <CivicDeskLogo size={24} />
            <span>CivicDesk</span>
          </span>
        </a>
        <div className="user-bar">
          <DirectoryHeaderLink branding={branding} />
          {me ? (
            <>
              <span>{me.username} ({ROLE_LABELS[me.role] || me.role})</span>
              <a className="btn sm primary" href="/app">Go to Workspace</a>
              <button
                type="button"
                className="btn sm"
                onClick={async () => {
                  await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' });
                  setMe(null);
                }}
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn sm primary" onClick={() => openAuth('/app', false, '')}>
                Sign In
              </button>
              <button type="button" className="btn sm" onClick={() => openAuth('/app', true, 'Create an applicant account to submit and track permit applications or complaints.')}>
                Create Account
              </button>
            </>
          )}
        </div>
      </header>

      <main id="main-content" style={{ maxWidth: 1180, margin: '0 auto', padding: '1.25rem' }}>
        {me?.is_default_password && (
          <div
            className="banner show"
            role="alert"
            style={{ background: '#fef2f2', borderColor: '#f87171', color: '#991b1b', marginBottom: '1rem' }}
          >
            <span>
              <strong>Security Warning:</strong> You are signed in with the default administrator password (<code>admin</code>). Please change your password immediately.
            </span>
            <a className="btn sm danger" href="/app">Change Password in Workspace</a>
          </div>
        )}
        {enabledModules === null ? (
          <div className="muted">Loading public services…</div>
        ) : visibleTabs.length === 0 ? (
          <div className="card">
            <p className="muted" style={{ margin: 0 }}>No public modules are currently enabled. Please sign in to access administration.</p>
          </div>
        ) : activeTab === 'overview' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div className="card">
              <h1 style={{ margin: '0 0 .35rem' }}>Public Services &amp; Records Portal</h1>
              <p className="muted" style={{ margin: 0 }}>
                Explore public city services below — no account required to view finalized agendas, City Code, public records, permit schedules, or to file a complaint.
              </p>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))',
                gap: '1rem',
              }}
            >
              {visibleTabs.map((t) => (
                <div
                  key={t.id}
                  className="card service-tile"
                  onClick={() => selectTab(t.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      selectTab(t.id);
                    }
                  }}
                  style={{
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    gap: '.75rem',
                    marginBottom: 0,
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '.65rem', marginBottom: '.45rem' }}>
                      <ServiceIcon id={t.id} size={20} badge />
                      <h2 style={{ margin: 0, fontSize: '1.1rem' }}>{t.label}</h2>
                    </div>
                    <p className="muted" style={{ margin: 0, fontSize: '.92rem', lineHeight: 1.45 }}>
                      {t.description}
                    </p>
                  </div>
                  <div style={{ fontSize: '.9rem', fontWeight: 600, color: 'var(--cd-primary)' }}>
                    {t.actionLabel}
                  </div>
                </div>
              ))}
            </div>

            <NotifyMeCard />
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <a
                href="#overview"
                onClick={(e) => {
                  e.preventDefault();
                  selectTab('overview');
                }}
                style={{ fontSize: '.92rem', fontWeight: 500, color: 'var(--cd-primary)', textDecoration: 'none' }}
              >
                ← All Public Services
              </a>
            </div>
            {activeTab === 'agendas' && <AgendasPublicTab />}
            {activeTab === 'permits' && <PermitsPublicTab me={me} onRequireAuth={openAuth} />}
            {activeTab === 'codification' && <CodePublicTab />}
            {activeTab === 'records' && <RecordsPublicTab />}
            {activeTab === 'complaints' && <ComplaintsPublicTab me={me} onRequireAuth={openAuth} />}
            {activeTab === 'calendar' && <CalendarPublicTab />}
          </div>
        )}
      </main>

      <AuthModal
        open={authModal.open}
        initialRegister={authModal.register}
        initialResetToken={authModal.resetToken}
        nextUrl={authModal.nextUrl}
        reason={authModal.reason}
        onClose={() => setAuthModal((prev) => ({ ...prev, open: false, resetToken: '' }))}
      />
      <PublicFooter branding={branding} />
    </div>
  );
}

createRoot(document.getElementById('home-root')).render(<PublicHomePage />);
