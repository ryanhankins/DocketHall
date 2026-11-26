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
import CustomFieldsRenderer from './core/CustomFieldsRenderer.jsx';
import { DemoBanner, DocketHallLogo, DirectoryHeaderLink, PublicFooter, PublicHeader, UrgentAlertBanner } from './core/PublicChrome.jsx';
import { applyTheme } from './core/theme.js';
import RichTextContent from './core/RichTextContent.jsx';
import RichTextEditor from './core/RichTextEditor.jsx';
import BlogPublicTab from './modules/blog/BlogPublicTab.jsx';
import CodeLibraryViewer from './modules/codification/CodeLibraryViewer.jsx';
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
  {
    id: 'notices',
    label: 'News, Notices, Bids & Jobs',
    description: 'Read city news flashes, public hearing notices, open RFPs/bids, and job postings.',
    actionLabel: 'View Notices & Bids →',
  },
  {
    id: 'blog',
    label: 'Blog & Community Updates',
    description: 'Read city articles, community stories, RSS feeds, and share moderated comments.',
    actionLabel: 'Read Blog →',
  },
  {
    id: 'directory',
    label: 'Directory, Resources & FAQs',
    description: 'Find City Council & staff contacts, local businesses, community resources, and FAQs.',
    actionLabel: 'View Directory & Resources →',
  },
  {
    id: 'forms',
    label: 'Forms & Opinion Polls',
    description: 'Submit city applications, data requests, house-watch forms, and vote in community polls.',
    actionLabel: 'Open Forms & Polls →',
  },
  {
    id: 'pages',
    label: 'City Info Pages & Quick Links',
    description: 'Browse guides on utilities, trash/recycling, snow rules, and helpful city links.',
    actionLabel: 'View City Info & Links →',
  },
];

function GlobalSearchBar({ onSelectTab }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);

  const runSearch = async (e) => {
    e.preventDefault();
    const term = q.trim();
    if (term.length < 2) {
      setResults(null);
      return;
    }
    setBusy(true);
    try {
      const r = await fetch(`/api/public/search?q=${encodeURIComponent(term)}`);
      const d = await r.json().catch(() => ({ results: [] }));
      setResults(Array.isArray(d.results) ? d.results : []);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" style={{ marginBottom: 0 }}>
      <form onSubmit={runSearch} className="row" style={{ alignItems: 'center', gap: '.5rem' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 240, display: 'flex', alignItems: 'center' }}>
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="#64748b"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ position: 'absolute', left: '.7rem', pointerEvents: 'none' }}
          >
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="search"
            aria-label="Search all public services"
            placeholder="Search everything: agendas, City Code, permits, trash, directory, notices…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              if (!e.target.value.trim()) setResults(null);
            }}
            style={{ width: '100%', paddingLeft: '2.15rem' }}
          />
        </div>
        <button type="submit" className="btn primary" disabled={busy || q.trim().length < 2} style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem' }}>
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <span>{busy ? 'Searching…' : 'Search'}</span>
        </button>
        {results !== null && (
          <button type="button" className="btn" onClick={() => { setQ(''); setResults(null); }}>
            Clear
          </button>
        )}
      </form>

      {Array.isArray(results) && (
        <div style={{ marginTop: '.75rem', borderTop: '1px solid #e2e8f0', paddingTop: '.65rem' }}>
          {results.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>No matching public items found for &ldquo;{q}&rdquo;.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.4rem', maxHeight: 340, overflowY: 'auto' }}>
              {results.map((item, idx) => (
                <button
                  key={`${item.module_id}-${idx}`}
                  type="button"
                  onClick={() => {
                    if (item.href && item.href !== '/portal' && /^https?:\/\//i.test(item.href)) {
                      window.open(item.href, '_blank', 'noreferrer');
                    } else if (item.href === '/portal') {
                      window.location.href = '/portal';
                    } else {
                      onSelectTab(item.tab, item.slug || '');
                    }
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '.75rem',
                    width: '100%',
                    textAlign: 'left',
                    padding: '.5rem .65rem',
                    borderRadius: 6,
                    border: '1px solid #e2e8f0',
                    background: '#f8fafc',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', minWidth: 0 }}>
                    <ServiceIcon id={item.module_id} size={16} badge />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: '.92rem', color: '#0f172a' }}>{item.title}</div>
                      {item.subtitle && <div className="muted" style={{ fontSize: '.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.subtitle}</div>}
                    </div>
                  </div>
                  <span className="badge draft" style={{ flexShrink: 0 }}>{item.module_label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PagesPublicTab({ initialItemId = '', onItemChange }) {
  const [data, setData] = useState({ pages: [], quick_links: [] });
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    const qs = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : '';
    fetch(`/api/pages/public${qs}`)
      .then((r) => (r.ok ? r.json() : { pages: [], quick_links: [] }))
      .then((d) => { setData({ pages: d.pages || [], quick_links: d.quick_links || [] }); setLoading(false); })
      .catch(() => { setData({ pages: [], quick_links: [] }); setLoading(false); });
  }, [q]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!initialItemId) {
      setOpenId(null);
      return;
    }
    const match = data.pages.find((p) => p.slug === initialItemId || String(p.id) === String(initialItemId));
    if (match) setOpenId(match.id);
  }, [initialItemId, data.pages]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {data.quick_links.length > 0 && (
        <div className="card">
          <h2 style={{ margin: '0 0 .65rem' }}>Quick Links</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: '.65rem' }}>
            {data.quick_links.map((l) => {
              const isExternal = /^https?:\/\//i.test(l.url);
              return (
                <a
                  key={l.id}
                  href={l.url}
                  target={isExternal ? '_blank' : undefined}
                  rel={isExternal ? 'noreferrer' : undefined}
                  style={{
                    display: 'block',
                    border: '1px solid #cbd5e1',
                    borderRadius: 8,
                    padding: '.75rem',
                    background: '#f8fafc',
                    textDecoration: 'none',
                    color: 'inherit',
                  }}
                >
                  <strong style={{ color: 'var(--cd-primary, #2563eb)' }}>{l.label} &rarr;</strong>
                  {l.description && <div className="muted" style={{ fontSize: '.83rem', marginTop: 3 }}>{l.description}</div>}
                </a>
              );
            })}
          </div>
        </div>
      )}

      <div className="card">
        <div className="between" style={{ marginBottom: '.75rem', flexWrap: 'wrap', gap: '.5rem' }}>
          <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
            <ServiceIcon id="pages" size={20} badge />
            <span>City Information Pages</span>
          </h2>
          <input
            placeholder="Search city info…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ minWidth: 210 }}
          />
        </div>

        {loading ? (
          <p className="muted">Loading city info pages…</p>
        ) : data.pages.length === 0 ? (
          <p className="muted">No city information pages published yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.65rem' }}>
            {data.pages.map((p) => {
              const isOpen = openId === p.id;
              return (
                <div key={p.id} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '.85rem 1rem', background: '#fff' }}>
                  <div className="between" style={{ gap: '.5rem', flexWrap: 'wrap' }}>
                    <div>
                      <span className="badge draft" style={{ marginRight: '.45rem' }}>{p.category}</span>
                      <strong style={{ fontSize: '1.04rem' }}>{p.title}</strong>
                    </div>
                    <button
                      type="button"
                      className="btn sm"
                      onClick={() => {
                        const nextOpen = isOpen ? null : p.id;
                        setOpenId(nextOpen);
                        onItemChange?.(nextOpen ? (p.slug || String(p.id)) : '');
                      }}
                    >
                      {isOpen ? 'Collapse' : 'Read Page'}
                    </button>
                  </div>
                  {p.summary && <p className="muted" style={{ margin: '.35rem 0 0', fontSize: '.9rem' }}>{p.summary}</p>}
                  {isOpen && p.body && (
                    <div style={{ marginTop: '.65rem', paddingTop: '.65rem', borderTop: '1px solid #e2e8f0' }}>
                      <RichTextContent text={p.body} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function FormsPublicTab({ initialItemId = '', onItemChange }) {
  const [forms, setForms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeFormId, setActiveFormId] = useState(() => (initialItemId ? Number(initialItemId) || null : null));
  const [subName, setSubName] = useState('');
  const [subEmail, setSubEmail] = useState('');
  const [responses, setResponses] = useState({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ text: '', isError: false });

  const loadForms = useCallback(() => {
    setLoading(true);
    fetch('/api/forms/public')
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => { setForms(Array.isArray(rows) ? rows : []); setLoading(false); })
      .catch(() => { setForms([]); setLoading(false); });
  }, []);

  useEffect(() => { loadForms(); }, [loadForms]);

  useEffect(() => {
    setActiveFormId(initialItemId ? (Number(initialItemId) || null) : null);
  }, [initialItemId]);

  const activeForm = forms.find((f) => f.id === activeFormId) || null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!activeForm) return;
    setBusy(true);
    setMsg({ text: '', isError: false });
    try {
      const r = await fetch(`/api/forms/public/${activeForm.id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          submitter_name: subName.trim(),
          submitter_email: subEmail.trim(),
          responses,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.detail || 'Submission failed');
      setMsg({
        text: activeForm.form_kind === 'poll' ? 'Thank you! Your vote has been recorded.' : 'Thank you! Your form has been submitted.',
        isError: false,
      });
      setResponses({});
      setSubName('');
      setSubEmail('');
      if (data.poll_results) {
        setForms((prev) => prev.map((f) => (f.id === activeForm.id ? { ...f, poll_results: data.poll_results } : f)));
      }
    } catch (err) {
      setMsg({ text: err.message, isError: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div className="card">
        <h2 style={{ margin: '0 0 .5rem', display: 'flex', alignItems: 'center', gap: 10 }}>
          <ServiceIcon id="forms" size={20} badge />
          <span>City Forms &amp; Community Opinion Polls</span>
        </h2>
        {loading ? (
          <p className="muted">Loading forms &amp; polls…</p>
        ) : forms.length === 0 ? (
          <p className="muted">No active forms or polls right now.</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '.75rem' }}>
            {forms.map((frm) => (
              <div
                key={frm.id}
                style={{
                  border: activeFormId === frm.id ? '2px solid var(--cd-primary)' : '1px solid #e2e8f0',
                  borderRadius: 8,
                  padding: '.85rem',
                  background: '#fff',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: '.5rem',
                }}
              >
                <div>
                  <span className="badge draft" style={{ marginBottom: '.35rem', display: 'inline-block' }}>
                    {frm.form_kind === 'poll' ? 'Opinion Poll' : 'Online Form'}
                  </span>
                  <h3 style={{ margin: '0 0 .25rem', fontSize: '1.02rem' }}>{frm.title}</h3>
                  {frm.description && <p className="muted" style={{ margin: 0, fontSize: '.86rem' }}>{frm.description}</p>}
                </div>
                <div>
                  <button
                    type="button"
                    className={`btn sm ${activeFormId === frm.id ? 'primary' : ''}`}
                    onClick={() => {
                      setActiveFormId(frm.id);
                      setResponses({});
                      setMsg({ text: '', isError: false });
                      onItemChange?.(String(frm.id));
                    }}
                  >
                    {frm.form_kind === 'poll' ? 'Vote / View Poll' : 'Open Form'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {activeForm && (
        <div className="card">
          <div className="between" style={{ marginBottom: '.65rem' }}>
            <h2 style={{ margin: 0 }}>{activeForm.title}</h2>
            <button type="button" className="btn sm" onClick={() => { setActiveFormId(null); onItemChange?.(''); }}>Close</button>
          </div>
          {activeForm.description && <p className="muted" style={{ marginTop: 0 }}>{activeForm.description}</p>}

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '.85rem' }}>
            {(!activeForm.allow_anonymous || activeForm.form_kind !== 'poll') && (
              <div className="row">
                <div className="field" style={{ flex: 1, minWidth: 180 }}>
                  <label htmlFor="pub-frm-name">Your Name{activeForm.allow_anonymous ? ' (optional)' : ' *'}</label>
                  <input id="pub-frm-name" required={!activeForm.allow_anonymous} value={subName} onChange={(e) => setSubName(e.target.value)} />
                </div>
                <div className="field" style={{ flex: 1, minWidth: 180 }}>
                  <label htmlFor="pub-frm-email">Email{activeForm.allow_anonymous ? ' (optional)' : ' *'}</label>
                  <input id="pub-frm-email" type="email" required={!activeForm.allow_anonymous} value={subEmail} onChange={(e) => setSubEmail(e.target.value)} />
                </div>
              </div>
            )}

            <CustomFieldsRenderer fields={activeForm.fields || []} value={responses} onChange={setResponses} />

            <div>
              <button type="submit" className="btn primary" disabled={busy}>
                {busy ? 'Submitting…' : (activeForm.form_kind === 'poll' ? 'Submit Vote' : 'Submit Form')}
              </button>
            </div>
            {msg.text && <div className={msg.isError ? 'error-msg' : 'ok-msg'} role="status">{msg.text}</div>}
          </form>

          {activeForm.form_kind === 'poll' && activeForm.show_poll_results && activeForm.poll_results && (
            <div style={{ marginTop: '1rem', paddingTop: '.85rem', borderTop: '1px solid #e2e8f0' }}>
              <h3 style={{ margin: '0 0 .5rem', fontSize: '.98rem' }}>
                Current Poll Results ({activeForm.poll_results.total_votes} {activeForm.poll_results.total_votes === 1 ? 'vote' : 'votes'})
              </h3>
              {Object.entries(activeForm.poll_results.tallies || {}).map(([key, counts]) => (
                <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: '.45rem' }}>
                  {Object.entries(counts).map(([opt, cnt]) => {
                    const tot = activeForm.poll_results.total_votes || 0;
                    const pct = tot > 0 ? Math.round((cnt / tot) * 100) : 0;
                    return (
                      <div key={opt} style={{ fontSize: '.86rem' }}>
                        <div className="between" style={{ marginBottom: 2 }}>
                          <span>{opt}</span>
                          <span className="muted">{cnt} ({pct}%)</span>
                        </div>
                        <div style={{ height: 8, background: '#e2e8f0', borderRadius: 4, overflow: 'hidden' }}>
                          <div style={{ width: `${pct}%`, height: '100%', background: 'var(--cd-primary, #2563eb)' }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DirectoryPublicTab({ features = {} }) {
  const [data, setData] = useState({ contacts: [], faqs: [], resources: [], boards: [], locations: [] });
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [subTab, setSubTab] = useState('all');
  const [resourceCat, setResourceCat] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (resourceCat) params.set('resource_category', resourceCat);
    const qs = params.toString() ? `?${params.toString()}` : '';
    fetch(`/api/directory/public${qs}`)
      .then((r) => (r.ok ? r.json() : { contacts: [], faqs: [], resources: [], boards: [], locations: [] }))
      .then((d) => {
        setData({ contacts: d.contacts || [], faqs: d.faqs || [], resources: d.resources || [], boards: d.boards || [], locations: d.locations || [] });
        setLoading(false);
      })
      .catch(() => {
        setData({ contacts: [], faqs: [], resources: [], boards: [], locations: [] });
        setLoading(false);
      });
  }, [q, resourceCat]);

  useEffect(() => { load(); }, [load]);

  const elected = data.contacts.filter((c) => c.is_elected);
  const staff = data.contacts.filter((c) => !c.is_elected);
  const resourceCategories = Array.from(new Set(data.resources.map((r) => r.category).filter(Boolean)));
  const faqGroups = [];
  const groupMap = new Map();
  for (const fq of data.faqs) {
    const cat = fq.category || 'General';
    if (!groupMap.has(cat)) {
      const g = { category: cat, items: [] };
      groupMap.set(cat, g);
      faqGroups.push(g);
    }
    groupMap.get(cat).items.push(fq);
  }

  const showContacts = subTab === 'all' || subTab === 'contacts';
  const showResources = features.resources !== false && (subTab === 'all' || subTab === 'resources');
  const showBoards = subTab === 'all' || subTab === 'boards';
  const showLocations = subTab === 'all' || subTab === 'locations';
  const showFaqs = subTab === 'all' || subTab === 'faqs';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div className="card">
        <div className="between" style={{ marginBottom: '.75rem', flexWrap: 'wrap', gap: '.5rem' }}>
          <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
            <ServiceIcon id="directory" size={20} badge />
            <span>Directory, Local Resources &amp; FAQs</span>
          </h2>
          <input
            aria-label="Search contacts, businesses, resources, or FAQs"
            placeholder="Search contacts, businesses, resources, or FAQs…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ minWidth: 240 }}
          />
        </div>

        <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', marginBottom: '.9rem' }}>
          {[
            { id: 'all', label: 'All' },
            { id: 'contacts', label: `Staff & Council (${data.contacts.length})` },
            ...(features.resources !== false ? [{ id: 'resources', label: `Local Business & Resources (${data.resources.length})` }] : []),
            { id: 'boards', label: `Boards & Commissions (${data.boards.length})` },
            { id: 'locations', label: `Locations & Parks (${data.locations.length})` },
            { id: 'faqs', label: `FAQs (${data.faqs.length})` },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              className={`btn sm${subTab === t.id ? ' primary' : ''}`}
              onClick={() => setSubTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {loading ? (
          <p className="muted">Loading directory, resources &amp; FAQs…</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {showContacts && elected.length > 0 && (
              <div>
                <h3 style={{ margin: '0 0 .5rem', fontSize: '1rem' }}>City Council &amp; Elected Officials</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: '.65rem' }}>
                  {elected.map((c) => (
                    <div key={c.id} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '.75rem', background: '#f8fafc' }}>
                      <strong>{c.name}</strong>
                      {c.title_role && <div className="muted" style={{ fontSize: '.85rem' }}>{c.title_role}</div>}
                      {c.email && <div style={{ fontSize: '.84rem', marginTop: 4 }}><a href={`mailto:${c.email}`}>{c.email}</a></div>}
                      {c.phone && <div style={{ fontSize: '.84rem' }}><a href={`tel:${c.phone}`}>{c.phone}</a></div>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {showContacts && staff.length > 0 && (
              <div>
                <h3 style={{ margin: '0 0 .5rem', fontSize: '1rem' }}>City Staff &amp; Departments</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: '.65rem' }}>
                  {staff.map((c) => (
                    <div key={c.id} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '.75rem', background: '#fff' }}>
                      <strong>{c.name}</strong>
                      {(c.title_role || c.department) && (
                        <div className="muted" style={{ fontSize: '.85rem' }}>
                          {[c.title_role, c.department].filter(Boolean).join(' · ')}
                        </div>
                      )}
                      {c.email && <div style={{ fontSize: '.84rem', marginTop: 4 }}><a href={`mailto:${c.email}`}>{c.email}</a></div>}
                      {c.phone && <div style={{ fontSize: '.84rem' }}><a href={`tel:${c.phone}`}>{c.phone}</a></div>}
                      {c.office_hours && <div className="muted" style={{ fontSize: '.8rem', marginTop: 2 }}>Hours: {c.office_hours}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {showResources && (data.resources.length > 0 || resourceCat) && (
              <div>
                <div className="between" style={{ marginBottom: '.5rem', flexWrap: 'wrap', gap: '.5rem' }}>
                  <h3 style={{ margin: 0, fontSize: '1rem' }}>Local Business &amp; Community Resource Directory</h3>
                  {(resourceCategories.length > 1 || resourceCat) && (
                    <div style={{ display: 'flex', gap: '.35rem', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className={`btn sm${resourceCat === '' ? ' primary' : ''}`}
                        onClick={() => setResourceCat('')}
                      >
                        All Categories
                      </button>
                      {resourceCategories.map((cat) => (
                        <button
                          key={cat}
                          type="button"
                          className={`btn sm${resourceCat === cat ? ' primary' : ''}`}
                          onClick={() => setResourceCat(cat)}
                        >
                          {cat}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {data.resources.length === 0 ? (
                  <p className="muted">No matching resources in this category.</p>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '.65rem' }}>
                    {data.resources.map((r) => (
                      <div
                        key={r.id}
                        style={{
                          border: r.is_featured ? '1.5px solid #0891b2' : '1px solid #e2e8f0',
                          borderRadius: 8,
                          padding: '.8rem',
                          background: r.is_featured ? '#f0fdfa' : '#fff',
                        }}
                      >
                        <div className="between" style={{ gap: '.4rem', alignItems: 'flex-start' }}>
                          <strong>{r.name}</strong>
                          <span className="badge draft" style={{ fontSize: '.72rem' }}>{r.category}</span>
                        </div>
                        {r.description && (
                          <p style={{ margin: '.35rem 0 .4rem', fontSize: '.86rem', color: '#334e68' }}>{r.description}</p>
                        )}
                        {r.address && <div className="muted" style={{ fontSize: '.82rem' }}>{r.address}</div>}
                        {r.hours && <div className="muted" style={{ fontSize: '.8rem', marginTop: 2 }}>Hours: {r.hours}</div>}
                        <div style={{ display: 'flex', gap: '.65rem', flexWrap: 'wrap', marginTop: '.4rem', fontSize: '.83rem' }}>
                          {r.phone && <a href={`tel:${r.phone}`}>{r.phone}</a>}
                          {r.email && <a href={`mailto:${r.email}`}>{r.email}</a>}
                          {r.website_url && <a href={r.website_url} target="_blank" rel="noreferrer">Visit Website ↗</a>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {showLocations && data.locations.length > 0 && (
              <div>
                <h3 style={{ margin: '0 0 .5rem', fontSize: '1rem' }}>City Locations, Parks &amp; Trails</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '.65rem' }}>
                  {data.locations.map((loc) => (
                    <div key={loc.id} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '.8rem', background: '#fff' }}>
                      <div className="between" style={{ gap: '.4rem', alignItems: 'flex-start' }}>
                        <strong>{loc.name}</strong>
                        <span className="badge draft" style={{ fontSize: '.72rem' }}>{loc.category}</span>
                      </div>
                      {loc.description && <p style={{ margin: '.35rem 0 .4rem', fontSize: '.86rem', color: '#334e68' }}>{loc.description}</p>}
                      {loc.address && <div className="muted" style={{ fontSize: '.82rem' }}>{loc.address}</div>}
                      {loc.hours && <div className="muted" style={{ fontSize: '.8rem', marginTop: 2 }}>Hours: {loc.hours}</div>}
                      {loc.amenities && <div className="muted" style={{ fontSize: '.8rem', marginTop: 4 }}>Amenities: {loc.amenities}</div>}
                      <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center', marginTop: '.45rem', fontSize: '.82rem' }}>
                        {loc.ada_accessible && <span className="badge active" style={{ fontSize: '.72rem' }}>ADA Accessible</span>}
                        {loc.phone && <a href={`tel:${loc.phone}`}>{loc.phone}</a>}
                        {loc.address && (
                          <a href={`https://www.openstreetmap.org/search?query=${encodeURIComponent(loc.address)}`} target="_blank" rel="noreferrer">
                            Map ↗
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {showBoards && data.boards.length > 0 && (
              <div>
                <h3 style={{ margin: '0 0 .5rem', fontSize: '1rem' }}>Boards &amp; Commissions</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '.65rem' }}>
                  {data.boards.map((b) => (
                    <div key={b.id} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '.75rem', background: b.is_vacant ? '#fffbeb' : '#fff' }}>
                      <div className="between" style={{ gap: '.4rem' }}>
                        <strong>{b.board_name}</strong>
                        {b.is_vacant && <span className="badge draft">Vacant Seat</span>}
                      </div>
                      {b.seat_name && <div className="muted" style={{ fontSize: '.84rem' }}>{b.seat_name}</div>}
                      {!b.is_vacant && b.member_name && <div style={{ fontSize: '.88rem', marginTop: 4 }}>{b.member_name}</div>}
                      {(b.term_start || b.term_end) && (
                        <div className="muted" style={{ fontSize: '.78rem', marginTop: 2 }}>Term: {b.term_start || '—'} – {b.term_end || '—'}</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {showFaqs && faqGroups.length > 0 && (
              <div>
                <h3 style={{ margin: '0 0 .5rem', fontSize: '1rem' }}>Frequently Asked Questions</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '.65rem' }}>
                  {faqGroups.map((grp) => (
                    <div key={grp.category} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '.75rem', background: '#fff' }}>
                      <div style={{ fontSize: '.8rem', fontWeight: 700, textTransform: 'uppercase', color: '#475569', marginBottom: '.4rem' }}>
                        {grp.category}
                      </div>
                      {grp.items.map((fq) => (
                        <details key={fq.id} style={{ borderTop: '1px solid #f1f5f9', padding: '.4rem 0' }}>
                          <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '.92rem' }}>{fq.question}</summary>
                          <p style={{ margin: '.4rem 0 .2rem', color: '#334e68', fontSize: '.9rem', whiteSpace: 'pre-wrap' }}>{fq.answer}</p>
                        </details>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {data.contacts.length === 0 && data.faqs.length === 0 && data.resources.length === 0 && (
              <p className="muted">No directory entries, community resources, or FAQs published yet.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function NoticesPublicTab({ features = {}, initialItemId = '', onItemChange }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cat, setCat] = useState('');
  const [q, setQ] = useState('');
  const [expandedId, setExpandedId] = useState(() => (initialItemId ? Number(initialItemId) || null : null));
  const [respondId, setRespondId] = useState(null);
  const [respForm, setRespForm] = useState({ applicant_name: '', applicant_email: '', applicant_phone: '', organization: '', cover_note: '' });
  const [respMsg, setRespMsg] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (cat) params.set('category', cat);
    if (q.trim()) params.set('q', q.trim());
    const qs = params.toString() ? `?${params.toString()}` : '';
    fetch(`/api/notices/public${qs}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => { setItems(Array.isArray(rows) ? rows : []); setLoading(false); })
      .catch(() => { setItems([]); setLoading(false); });
  }, [cat, q]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    setExpandedId(initialItemId ? (Number(initialItemId) || null) : null);
  }, [initialItemId]);

  const catLabels = {
    news: 'City News',
    public_notice: 'Public Notice',
    bid: 'Bid / RFP',
    job: 'Job Opening',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div className="card">
        <div className="between" style={{ marginBottom: '.75rem', flexWrap: 'wrap', gap: '.5rem' }}>
          <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
            <ServiceIcon id="notices" size={20} badge />
            <span>News, Public Notices, Bids &amp; Jobs</span>
          </h2>
          <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
            <select aria-label="Filter notices by category" value={cat} onChange={(e) => setCat(e.target.value)} style={{ width: 'auto' }}>
              <option value="">All Categories</option>
              <option value="news">City News</option>
              <option value="public_notice">Public Notices</option>
              {features.bids !== false && <option value="bid">Bids &amp; RFPs</option>}
              {features.jobs !== false && <option value="job">Job Openings</option>}
            </select>
            <input
              aria-label="Search notices, bids, and jobs"
              placeholder="Search notices, bids, jobs…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{ minWidth: 200 }}
            />
          </div>
        </div>

        {loading ? (
          <p className="muted">Loading notices…</p>
        ) : items.length === 0 ? (
          <p className="muted">No active notices, news, bids, or job postings right now.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
            {items.map((n) => {
              const isOpen = expandedId === n.id;
              return (
                <div
                  key={n.id}
                  style={{
                    border: '1px solid #e2e8f0',
                    borderRadius: 8,
                    padding: '.85rem 1rem',
                    background: n.is_pinned ? '#fffbeb' : '#fff',
                  }}
                >
                  <div className="between" style={{ gap: '.5rem', flexWrap: 'wrap', marginBottom: '.35rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '.45rem', flexWrap: 'wrap' }}>
                      <span className="badge draft">{catLabels[n.category] || n.category}</span>
                      {n.is_pinned && <span className="badge" style={{ background: '#fef3c7', color: '#92400e' }}>Pinned</span>}
                      {n.department && <span className="muted" style={{ fontSize: '.82rem' }}>{n.department}</span>}
                    </div>
                    <span className="muted" style={{ fontSize: '.82rem' }}>
                      Posted {new Date(n.publish_at).toLocaleDateString()}
                      {n.deadline_at ? ` · Deadline: ${n.deadline_at}` : ''}
                    </span>
                  </div>
                  <h3 style={{ margin: '0 0 .3rem', fontSize: '1.05rem' }}>{n.title}</h3>
                  {n.summary && <p style={{ margin: '0 0 .45rem', color: '#334e68', fontSize: '.92rem' }}>{n.summary}</p>}
                  {(n.body || n.contact_info || n.attachment_url) && (
                    <div>
                      <button
                        type="button"
                        className="btn sm"
                        onClick={() => {
                          const nextId = isOpen ? null : n.id;
                          setExpandedId(nextId);
                          onItemChange?.(nextId ? String(nextId) : '');
                        }}
                      >
                        {isOpen ? 'Hide Details' : 'Read Full Details'}
                      </button>
                      {n.attachment_url && (
                        <a
                          href={n.attachment_url}
                          target="_blank"
                          rel="noreferrer"
                          className="btn sm"
                          style={{ marginLeft: '.4rem' }}
                        >
                          View Attachment / PDF
                        </a>
                      )}
                      {(n.category === 'job' || n.category === 'bid') && (
                        <button
                          type="button"
                          className="btn sm primary"
                          style={{ marginLeft: '.4rem' }}
                          onClick={() => {
                            setRespMsg('');
                            setRespondId(respondId === n.id ? null : n.id);
                          }}
                        >
                          {n.category === 'job' ? 'Apply Online' : 'Register as Plan-Holder'}
                        </button>
                      )}
                      {respondId === n.id && (
                        <form
                          style={{ marginTop: '.65rem', padding: '.75rem', border: '1px solid #cbd5e1', borderRadius: 8, background: '#f8fafc', display: 'grid', gap: '.5rem' }}
                          onSubmit={async (e) => {
                            e.preventDefault();
                            setRespMsg('');
                            try {
                              const r = await fetch(`/api/notices/public/${n.id}/respond`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify(respForm),
                              });
                              if (!r.ok) {
                                const d = await r.json().catch(() => ({}));
                                throw new Error(d.detail || 'Submission failed');
                              }
                              setRespForm({ applicant_name: '', applicant_email: '', applicant_phone: '', organization: '', cover_note: '' });
                              setRespMsg(n.category === 'job' ? 'Application submitted!' : 'Plan-holder registration recorded!');
                            } catch (err2) {
                              setRespMsg(err2.message || 'Submission failed');
                            }
                          }}
                        >
                          <strong>{n.category === 'job' ? 'Online Job Application' : 'Vendor / Plan-Holder Registration'}</strong>
                          <div className="row" style={{ gap: '.5rem' }}>
                            <input required placeholder="Full Name *" value={respForm.applicant_name} onChange={(e) => setRespForm((f) => ({ ...f, applicant_name: e.target.value }))} style={{ flex: 1 }} />
                            <input type="email" placeholder="Email" value={respForm.applicant_email} onChange={(e) => setRespForm((f) => ({ ...f, applicant_email: e.target.value }))} style={{ flex: 1 }} />
                            <input placeholder="Phone" value={respForm.applicant_phone} onChange={(e) => setRespForm((f) => ({ ...f, applicant_phone: e.target.value }))} style={{ flex: 1 }} />
                          </div>
                          {n.category === 'bid' && (
                            <input placeholder="Company / Organization" value={respForm.organization} onChange={(e) => setRespForm((f) => ({ ...f, organization: e.target.value }))} />
                          )}
                          <textarea rows={2} placeholder={n.category === 'job' ? 'Qualifications / cover note…' : 'Notes or trade categories…'} value={respForm.cover_note} onChange={(e) => setRespForm((f) => ({ ...f, cover_note: e.target.value }))} />
                          <div className="actions">
                            <button type="submit" className="btn sm primary">Submit</button>
                            {respMsg && <span className="muted" style={{ fontSize: '.86rem' }}>{respMsg}</span>}
                          </div>
                        </form>
                      )}
                      {isOpen && (
                        <div style={{ marginTop: '.65rem', paddingTop: '.6rem', borderTop: '1px solid #e2e8f0', fontSize: '.9rem', lineHeight: 1.55 }}>
                          {n.body && <pre style={{ margin: '0 0 .5rem', whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{n.body}</pre>}
                          {n.contact_info && <div><strong>Contact / How to Submit:</strong> {n.contact_info}</div>}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function AuthModal({ open, initialRegister, initialResetToken, nextUrl, reason, demoMode, onClose }) {
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
          : 'Sign In to DocketHall';

  return (
    <dialog ref={dlgRef} onCancel={(e) => { e.preventDefault(); onClose(); }} style={{ maxWidth: 400, width: '92%' }}>
      <h2 style={{ marginTop: 0 }}>{heading}</h2>
      {reason && mode === 'login' && (
        <p className="muted" style={{ marginTop: 0, fontSize: '.9rem' }}>{reason}</p>
      )}
      {demoMode && mode === 'login' && (
        <div style={{ marginBottom: '.9rem', paddingBottom: '.85rem', borderBottom: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: '.82rem', fontWeight: 700, color: '#334155', marginBottom: '.45rem' }}>
            One-Click Demo Sign In
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.4rem' }}>
            {[
              ['clerk', 'Try as City Clerk'],
              ['inspector', 'Try as Inspector'],
              ['council', 'Try as Council Member'],
              ['resident', 'Try as Resident'],
              ['admin', 'Try as Admin'],
            ].map(([role, label]) => (
              <button
                key={role}
                type="button"
                className="btn sm"
                disabled={busy}
                onClick={async () => {
                  setError('');
                  setInfo('');
                  setBusy(true);
                  try {
                    const r = await fetch('/api/demo-login', {
                      method: 'POST',
                      credentials: 'same-origin',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ role }),
                    });
                    if (r.ok) {
                      const dest = role === 'resident' && (!nextUrl || nextUrl === '/app')
                        ? '/'
                        : (role === 'inspector' ? '/app#field-inspector' : (role === 'council' ? '/app#council' : safeNext));
                      location.replace(dest);
                      return;
                    }
                    const data = await r.json().catch(() => ({}));
                    setError(data.detail || 'Demo sign in failed.');
                  } catch {
                    setError('Unable to reach the server.');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
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

function parseTimestampSeconds(raw) {
  const s = String(raw || '').trim();
  if (!s) return 0;
  if (/^\d+$/.test(s)) return Number(s);
  const parts = s.split(':').map((p) => Number(p));
  if (parts.some((n) => Number.isNaN(n) || n < 0)) return 0;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

function toEmbedUrl(raw, startSeconds = 0) {
  const url = String(raw || '').trim();
  if (!url) return null;
  const sec = Number(startSeconds) > 0 ? Math.floor(Number(startSeconds)) : 0;
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([A-Za-z0-9_-]{6,})/);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}${sec ? `?start=${sec}&autoplay=1` : ''}`;
  const vm = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vm) return `https://player.vimeo.com/video/${vm[1]}${sec ? `#t=${sec}s` : ''}`;
  return null;
}

function AgendasPublicTab({ me, onRequireAuth, initialItemId = '', onItemChange }) {
  const [activeMedia, setActiveMedia] = useState(null);
  const [mediaStartSec, setMediaStartSec] = useState(0);
  const [agendas, setAgendas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [bodyFilter, setBodyFilter] = useState('');
  const [yearFilter, setYearFilter] = useState('');
  const [selectedAgendaId, setSelectedAgendaId] = useState(null);
  const [agendaDetail, setAgendaDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [commentItemId, setCommentItemId] = useState('');
  const [commentBody, setCommentBody] = useState('');
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [commentMsg, setCommentMsg] = useState('');
  const [commentErr, setCommentErr] = useState('');

  const openAgendaDetail = useCallback(async (agendaId) => {
    setSelectedAgendaId(agendaId);
    setDetailLoading(true);
    setCommentErr('');
    setCommentMsg('');
    try {
      const d = await api(`/api/agendas/public/${agendaId}`);
      setAgendaDetail(d);
    } catch (e) {
      setAgendaDetail(null);
      setCommentErr(e.message || 'Unable to load agenda items and comments.');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    const idNum = initialItemId ? Number(initialItemId) : null;
    if (idNum && idNum !== selectedAgendaId) {
      openAgendaDetail(idNum);
    } else if (!idNum && selectedAgendaId) {
      setSelectedAgendaId(null);
    }
  }, [initialItemId, openAgendaDetail, selectedAgendaId]);

  function jumpToTimestamp(agendaObj, tsRaw) {
    setMediaStartSec(parseTimestampSeconds(tsRaw));
    setActiveMedia(agendaObj);
  }

  async function submitPublicComment(e) {
    e.preventDefault();
    if (!me) {
      onRequireAuth?.('Sign in to submit an online public comment.');
      return;
    }
    const text = commentBody.trim();
    if (!text || !selectedAgendaId) return;
    setCommentSubmitting(true);
    setCommentErr('');
    setCommentMsg('');
    try {
      const created = await api(`/api/agendas/public/${selectedAgendaId}/comments`, {
        method: 'POST',
        body: JSON.stringify({
          item_id: commentItemId ? Number(commentItemId) : null,
          body: text,
        }),
      });
      setCommentBody('');
      setCommentMsg('Your public comment has been submitted.');
      setAgendaDetail((prev) => (prev ? {
        ...prev,
        public_comments: [...(prev.public_comments || []), created],
      } : prev));
    } catch (err) {
      setCommentErr(err.message || 'Failed to submit comment.');
    } finally {
      setCommentSubmitting(false);
    }
  }

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
                      <button
                        type="button"
                        className="btn sm"
                        onClick={() => {
                          setMediaStartSec(0);
                          setActiveMedia(activeMedia?.id === a.id ? null : a);
                        }}
                      >
                        {a.media_type === 'audio' ? 'Listen Audio' : 'Watch Video'}
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn sm"
                      onClick={() => {
                        if (selectedAgendaId === a.id) {
                          setSelectedAgendaId(null);
                          onItemChange?.('');
                        } else {
                          openAgendaDetail(a.id);
                          onItemChange?.(String(a.id));
                        }
                      }}
                    >
                      {selectedAgendaId === a.id ? 'Hide Items' : 'Items & Comments'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {activeMedia && (
        <div style={{ marginTop: '1rem', padding: '.85rem', border: '1px solid #cbd5e1', borderRadius: 8, background: '#f8fafc' }}>
          <div className="between" style={{ marginBottom: '.6rem', flexWrap: 'wrap', gap: '.5rem' }}>
            <strong>{activeMedia.title} — Meeting Recording</strong>
            <div className="actions">
              <a className="btn sm" href={activeMedia.media_url} target="_blank" rel="noreferrer">Open in New Tab</a>
              <button type="button" className="btn sm" onClick={() => setActiveMedia(null)}>Close</button>
            </div>
          </div>
          {activeMedia.media_type === 'audio' ? (
            <audio controls style={{ width: '100%' }} src={activeMedia.media_url} />
          ) : (() => {
            const embed = toEmbedUrl(activeMedia.media_url, mediaStartSec);
            return embed ? (
              <div style={{ position: 'relative', paddingBottom: '56.25%', height: 0, overflow: 'hidden', borderRadius: 6 }}>
                <iframe
                  key={embed}
                  title={activeMedia.title}
                  src={embed}
                  style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 0 }}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            ) : (
              <p className="muted" style={{ margin: 0 }}>
                External recording link: <a href={activeMedia.media_url} target="_blank" rel="noreferrer">{activeMedia.media_url}</a>
              </p>
            );
          })()}
        </div>
      )}

      {selectedAgendaId && (
        <div style={{ marginTop: '1rem', padding: '1rem', border: '1px solid #cbd5e1', borderRadius: 8, background: '#fff' }}>
          <div className="between" style={{ marginBottom: '.75rem', flexWrap: 'wrap', gap: '.5rem' }}>
            <strong>{agendaDetail ? `${agendaDetail.title} — Agenda Items & Public Comment` : 'Agenda Details'}</strong>
            <button type="button" className="btn sm" onClick={() => { setSelectedAgendaId(null); onItemChange?.(''); }}>Close</button>
          </div>
          {detailLoading ? (
            <p className="muted">Loading agenda items…</p>
          ) : !agendaDetail ? (
            <p className="muted">{commentErr || 'Unable to load agenda.'}</p>
          ) : (
            <div style={{ display: 'grid', gap: '1rem' }}>
              <div>
                <h3 style={{ margin: '0 0 .5rem', fontSize: '1rem' }}>Agenda Items</h3>
                {!(agendaDetail.items || []).length ? (
                  <p className="muted" style={{ margin: 0 }}>No agenda items listed.</p>
                ) : (
                  <ul style={{ margin: 0, paddingLeft: '1.25rem', display: 'grid', gap: '.45rem' }}>
                    {(agendaDetail.items || []).map((it) => (
                      <li key={it.id}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
                          <div>
                            {it.section && <span className="badge" style={{ marginRight: '.4rem' }}>{it.section}</span>}
                            <strong>{it.title}</strong>
                            {it.description && <div className="muted" style={{ fontSize: '.86rem' }}>{it.description}</div>}
                          </div>
                          {it.video_timestamp && agendaDetail.media_url && (
                            <button
                              type="button"
                              className="btn sm"
                              onClick={() => jumpToTimestamp(agendaDetail, it.video_timestamp)}
                              title={`Jump video to ${it.video_timestamp}`}
                            >
                              ▶ {it.video_timestamp}
                            </button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '.85rem' }}>
                <h3 style={{ margin: '0 0 .5rem', fontSize: '1rem' }}>
                  Online Public Comments ({(agendaDetail.public_comments || []).length})
                </h3>
                {!(agendaDetail.public_comments || []).length ? (
                  <p className="muted" style={{ margin: '0 0 .75rem' }}>No public comments submitted yet.</p>
                ) : (
                  <div style={{ display: 'grid', gap: '.5rem', marginBottom: '.85rem' }}>
                    {(agendaDetail.public_comments || []).map((c) => (
                      <div key={c.id} style={{ padding: '.6rem .75rem', border: '1px solid #e2e8f0', borderRadius: 6, background: '#f8fafc' }}>
                        <div className="between" style={{ fontSize: '.82rem', marginBottom: '.25rem', gap: '.5rem', flexWrap: 'wrap' }}>
                          <strong>{c.author_name || 'Resident'}</strong>
                          <span className="muted">
                            {c.item_title ? `Re: ${c.item_title} · ` : ''}
                            {formatDate(c.created_at)}
                          </span>
                        </div>
                        <div style={{ whiteSpace: 'pre-wrap', fontSize: '.92rem' }}>{c.body}</div>
                      </div>
                    ))}
                  </div>
                )}

                {!me ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', flexWrap: 'wrap' }}>
                    <span className="muted" style={{ fontSize: '.9rem' }}>Sign in as a verified resident to submit an online public comment.</span>
                    <button
                      type="button"
                      className="btn sm primary"
                      onClick={() => onRequireAuth?.('Sign in to submit an online public comment.')}
                    >
                      Sign In to Comment
                    </button>
                  </div>
                ) : (
                  <form onSubmit={submitPublicComment} style={{ display: 'grid', gap: '.5rem' }}>
                    <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                      <label htmlFor="public-comment-item" className="muted" style={{ fontSize: '.86rem' }}>Agenda Item:</label>
                      <select
                        id="public-comment-item"
                        value={commentItemId}
                        onChange={(e) => setCommentItemId(e.target.value)}
                        style={{ width: 'auto', maxWidth: '100%' }}
                      >
                        <option value="">General Meeting Comment</option>
                        {(agendaDetail.items || []).map((it) => (
                          <option key={it.id} value={it.id}>{it.title}</option>
                        ))}
                      </select>
                    </div>
                    <textarea
                      rows={3}
                      placeholder="Write your public comment for the record…"
                      value={commentBody}
                      onChange={(e) => setCommentBody(e.target.value)}
                      required
                    />
                    {commentErr && <div style={{ color: '#b91c1c', fontSize: '.86rem' }}>{commentErr}</div>}
                    {commentMsg && <div style={{ color: '#15803d', fontSize: '.86rem' }}>{commentMsg}</div>}
                    <div>
                      <button type="submit" className="btn sm primary" disabled={commentSubmitting || !commentBody.trim()}>
                        {commentSubmitting ? 'Submitting…' : 'Submit Public Comment'}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </div>
          )}
        </div>
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

function CodePublicTab({ branding = {}, initialSection = '' }) {
  return <CodeLibraryViewer branding={branding} standalone={false} initialSection={initialSection} />;
}

function RecordsPublicTab({ features = {} }) {
  const [items, setItems] = useState([]);
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [year, setYear] = useState('');
  const [loading, setLoading] = useState(true);
  const [showFoia, setShowFoia] = useState(false);
  const [foiaForm, setFoiaForm] = useState({ requester_name: '', requester_email: '', requester_phone: '', subject: '', description: '' });
  const [foiaResult, setFoiaResult] = useState(null);
  const [foiaLookupNum, setFoiaLookupNum] = useState('');
  const [foiaLookupRes, setFoiaLookupRes] = useState(null);

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
          {features.foia_requests !== false && (
            <button type="button" className="btn sm" onClick={() => setShowFoia((v) => !v)}>
              {showFoia ? 'Hide Data Request' : '+ Request Public Record (FOIA)'}
            </button>
          )}
        </div>
      </div>

      {features.foia_requests !== false && showFoia && (
        <div style={{ marginBottom: '1rem', padding: '1rem', border: '1px solid #cbd5e1', borderRadius: 8, background: '#f8fafc' }}>
          <h3 style={{ marginTop: 0 }}>Submit or Track a Public Records (FOIA / Data Practices) Request</h3>
          <form
            className="row"
            style={{ gap: '.5rem', alignItems: 'flex-end', marginBottom: '.75rem' }}
            onSubmit={async (e) => {
              e.preventDefault();
              const r = await fetch('/api/records/requests/public', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(foiaForm),
              });
              const d = await r.json();
              if (r.ok) {
                setFoiaResult(d);
                setFoiaForm({ requester_name: '', requester_email: '', requester_phone: '', subject: '', description: '' });
              }
            }}
          >
            <input required placeholder="Your Name *" value={foiaForm.requester_name} onChange={(e) => setFoiaForm((f) => ({ ...f, requester_name: e.target.value }))} style={{ flex: 1, minWidth: 150 }} />
            <input type="email" placeholder="Email" value={foiaForm.requester_email} onChange={(e) => setFoiaForm((f) => ({ ...f, requester_email: e.target.value }))} style={{ flex: 1, minWidth: 160 }} />
            <input required placeholder="Records Subject *" value={foiaForm.subject} onChange={(e) => setFoiaForm((f) => ({ ...f, subject: e.target.value }))} style={{ flex: 2, minWidth: 200 }} />
            <input placeholder="Details / Date Range" value={foiaForm.description} onChange={(e) => setFoiaForm((f) => ({ ...f, description: e.target.value }))} style={{ flex: 2, minWidth: 200 }} />
            <button type="submit" className="btn sm primary">Submit Request</button>
          </form>
          {foiaResult && (
            <div style={{ padding: '.5rem .75rem', background: '#dcfce7', borderRadius: 6, marginBottom: '.65rem', fontSize: '.9rem' }}>
              Submitted <strong>{foiaResult.request_number}</strong> — Target Response Date: <strong>{foiaResult.due_date}</strong>
            </div>
          )}
          <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <input placeholder="Track Request # (e.g. PRR-2026-0001)" value={foiaLookupNum} onChange={(e) => setFoiaLookupNum(e.target.value)} style={{ minWidth: 220 }} />
            <button
              type="button"
              className="btn sm"
              onClick={async () => {
                if (!foiaLookupNum.trim()) return;
                const r = await fetch(`/api/records/requests/public-lookup?request_number=${encodeURIComponent(foiaLookupNum.trim())}`);
                setFoiaLookupRes(r.ok ? await r.json() : { error: 'Not found' });
              }}
            >
              Check Status
            </button>
            {foiaLookupRes && (
              <span style={{ fontSize: '.88rem' }}>
                {foiaLookupRes.error ? foiaLookupRes.error : (
                  <>
                    {foiaLookupRes.request_number}: {foiaLookupRes.status.replace('_', ' ')} (Due {foiaLookupRes.due_date || '—'})
                    {foiaLookupRes.fulfillment_filename && (foiaLookupRes.status === 'ready' || foiaLookupRes.status === 'fulfilled') && (
                      <> · <a href={`/api/records/requests/public-download/${encodeURIComponent(foiaLookupRes.request_number)}`} target="_blank" rel="noreferrer">Download {foiaLookupRes.fulfillment_filename}</a></>
                    )}
                  </>
                )}
              </span>
            )}
          </div>
        </div>
      )}

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

function ComplaintsPublicTab({ me, onRequireAuth, features = {}, initialItemId = '', onItemChange }) {
  const [subView, setSubView] = useState('log'); // 'log' | 'file' | '311'
  const [woForm, setWoForm] = useState({ category: 'Pothole / Street', location: '', description: '', reporter_name: '', reporter_email: '', latitude: '', longitude: '' });
  const [woDone, setWoDone] = useState(null);
  const [woLookupNum, setWoLookupNum] = useState('');
  const [woLookupRes, setWoLookupRes] = useState(null);
  const [items, setItems] = useState([]);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selected, setSelected] = useState(null);
  const [trackErr, setTrackErr] = useState('');
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
  const [compLat, setCompLat] = useState('');
  const [compLng, setCompLng] = useState('');
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

  useEffect(() => {
    if (!initialItemId) {
      setSelected(null);
      return;
    }
    const match = items.find((c) => c.complaint_number === initialItemId || String(c.id) === String(initialItemId));
    if (match) setSelected(match);
  }, [initialItemId, items]);

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
          latitude: compLat !== '' ? Number(compLat) : null,
          longitude: compLng !== '' ? Number(compLng) : null,
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
          {features.work_orders !== false && (
            <button type="button" className={`btn sm${subView === '311' ? ' primary' : ''}`} onClick={() => setSubView('311')}>
              + 311 Service Request
            </button>
          )}
        </div>
      </div>

      {features.work_orders !== false && subView === '311' ? (
        <form
          className="card"
          style={{ display: 'grid', gap: 10 }}
          onSubmit={async (e) => {
            e.preventDefault();
            const payload = {
              ...woForm,
              latitude: woForm.latitude !== '' ? Number(woForm.latitude) : null,
              longitude: woForm.longitude !== '' ? Number(woForm.longitude) : null,
            };
            const r = await fetch('/api/complaints/work-orders/public', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
            if (r.ok) {
              setWoDone(await r.json());
              setWoForm({ category: 'Pothole / Street', location: '', description: '', reporter_name: '', reporter_email: '', latitude: '', longitude: '' });
            }
          }}
        >
          <h3 style={{ margin: 0 }}>Report a Public Works / 311 Issue</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
            <select aria-label="311 request category" value={woForm.category} onChange={(e) => setWoForm((f) => ({ ...f, category: e.target.value }))}>
              <option value="Pothole / Street">Pothole / Street</option>
              <option value="Streetlight">Streetlight Outage</option>
              <option value="Water / Sewer">Water / Sewer</option>
              <option value="Snow / Brush">Snow / Brush</option>
              <option value="Parks / Facilities">Parks / Facilities</option>
              <option value="Other">Other</option>
            </select>
            <input placeholder="Location / Nearest Address" value={woForm.location} onChange={(e) => setWoForm((f) => ({ ...f, location: e.target.value }))} />
            <input placeholder="Your Name (optional)" value={woForm.reporter_name} onChange={(e) => setWoForm((f) => ({ ...f, reporter_name: e.target.value }))} />
            <input type="email" placeholder="Email (optional)" value={woForm.reporter_email} onChange={(e) => setWoForm((f) => ({ ...f, reporter_email: e.target.value }))} />
          </div>
          <textarea required rows={3} placeholder="Describe the maintenance issue..." value={woForm.description} onChange={(e) => setWoForm((f) => ({ ...f, description: e.target.value }))} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              type="button"
              className="btn sm"
              onClick={() => {
                if (!navigator.geolocation) return;
                navigator.geolocation.getCurrentPosition((pos) => {
                  setWoForm((f) => ({
                    ...f,
                    latitude: pos.coords.latitude.toFixed(6),
                    longitude: pos.coords.longitude.toFixed(6),
                  }));
                });
              }}
            >
              Pin My GPS Location
            </button>
            <input placeholder="Latitude (optional)" value={woForm.latitude} onChange={(e) => setWoForm((f) => ({ ...f, latitude: e.target.value }))} style={{ maxWidth: 145 }} />
            <input placeholder="Longitude (optional)" value={woForm.longitude} onChange={(e) => setWoForm((f) => ({ ...f, longitude: e.target.value }))} style={{ maxWidth: 145 }} />
          </div>
          <div className="actions"><button type="submit" className="btn primary">Submit 311 Request</button></div>
          {woDone && (
            <div style={{ padding: '.6rem .8rem', background: '#dcfce7', borderRadius: 6, fontSize: '.9rem' }}>
              Submitted Work Order <strong>{woDone.work_order_number}</strong> ({woDone.category}).
            </div>
          )}
          <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '.65rem', display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <input placeholder="Track 311 Work Order # (e.g. WO-2026-0001)" value={woLookupNum} onChange={(e) => setWoLookupNum(e.target.value)} style={{ minWidth: 240 }} />
            <button
              type="button"
              className="btn sm"
              onClick={async () => {
                if (!woLookupNum.trim()) return;
                const r = await fetch(`/api/complaints/work-orders/public-lookup?work_order_number=${encodeURIComponent(woLookupNum.trim())}`);
                setWoLookupRes(r.ok ? await r.json() : { error: 'Work order not found' });
              }}
            >
              Check 311 Status
            </button>
            {woLookupRes && (
              <span style={{ fontSize: '.88rem' }}>
                {woLookupRes.error ? woLookupRes.error : `${woLookupRes.work_order_number}: ${woLookupRes.status.replace('_', ' ')} (${woLookupRes.category}${woLookupRes.assigned_crew ? ` · ${woLookupRes.assigned_crew}` : ''})`}
              </span>
            )}
          </div>
        </form>
      ) : subView === 'file' ? (
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
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" style={{ width: 'auto', flexShrink: 0 }} checked={isAnonymous} onChange={(e) => setIsAnonymous(e.target.checked)} />
              <span>File anonymously (accepted at staff discretion)</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" style={{ width: 'auto', flexShrink: 0 }} checked={isRealProperty} onChange={(e) => setIsRealProperty(e.target.checked)} />
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
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              type="button"
              className="btn sm"
              onClick={() => {
                if (!navigator.geolocation) return;
                navigator.geolocation.getCurrentPosition((pos) => {
                  setCompLat(pos.coords.latitude.toFixed(6));
                  setCompLng(pos.coords.longitude.toFixed(6));
                });
              }}
            >
              Pin My GPS Location
            </button>
            <input placeholder="Latitude (optional)" value={compLat} onChange={(e) => setCompLat(e.target.value)} style={{ maxWidth: 145 }} />
            <input placeholder="Longitude (optional)" value={compLng} onChange={(e) => setCompLng(e.target.value)} style={{ maxWidth: 145 }} />
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
              setTrackErr('');
              const num = (e.currentTarget.elements.trackNum?.value || '').trim();
              if (!num) return;
              try {
                const r = await fetch(`/api/complaints/public-lookup?number=${encodeURIComponent(num)}`);
                const d = await r.json().catch(() => ({}));
                if (!r.ok) throw new Error(d.detail || 'Complaint not found');
                setSelected(d);
              } catch (err) {
                setTrackErr(err.message || 'Complaint not found');
              }
            }}
            style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: '.85rem', paddingBottom: '.75rem', borderBottom: '1px solid #e5e7eb' }}
          >
            <strong style={{ fontSize: '.9rem' }}>Track by Number:</strong>
            <input name="trackNum" placeholder="e.g. COM-2026-0001" style={{ maxWidth: 200 }} />
            <button type="submit" className="btn sm">Look Up</button>
          </form>
          {trackErr && <div className="error-msg" role="alert" style={{ marginBottom: '.75rem' }}>{trackErr}</div>}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: '1rem' }}>
            <input style={{ flex: '1 1 240px' }} placeholder="Search complaint #, property, ordinance, resolution…" value={q} onChange={(e) => setQ(e.target.value)} />
            <select aria-label="Filter complaints by status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All Statuses</option>
              {COMPLAINT_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div className={`split-detail-layout${selected ? '' : ' single'}`}>
            <div style={{ overflowX: 'auto' }}>
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
                      <tr
                        key={c.id}
                        onClick={() => {
                          setSelected(c);
                          onItemChange?.(c.complaint_number || String(c.id));
                        }}
                        style={{ cursor: 'pointer', background: selected?.id === c.id ? '#eff6ff' : 'transparent' }}
                      >
                        <td style={{ whiteSpace: 'nowrap', fontWeight: 500 }}>
                          <button
                            type="button"
                            className="link-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelected(c);
                              onItemChange?.(c.complaint_number || String(c.id));
                            }}
                          >
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
                  <button type="button" className="btn sm" onClick={() => { setSelected(null); onItemChange?.(''); }}>Close</button>
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

function CalendarPublicTab({ features = {} }) {
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [data, setData] = useState({ facilities: [], items: [], booked_slots: [] });
  const [loading, setLoading] = useState(true);
  const [facId, setFacId] = useState('');
  const [evDate, setEvDate] = useState('');
  const [rentalMode, setRentalMode] = useState('full_day');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('11:00');
  const [evTitle, setEvTitle] = useState('');
  const [reqName, setReqName] = useState('');
  const [reqEmail, setReqEmail] = useState('');
  const [reqPhone, setReqPhone] = useState('');
  const [reqNotes, setReqNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ text: '', isError: false });
  const [paymentsEnabled, setPaymentsEnabled] = useState(false);
  const [lastReservation, setLastReservation] = useState(null);
  const [resLookupNum, setResLookupNum] = useState('');
  const [resLookupRes, setResLookupRes] = useState(null);
  const [resLookupErr, setResLookupErr] = useState('');

  useEffect(() => {
    fetch('/api/payments/config')
      .then((r) => (r.ok ? r.json() : {}))
      .then((d) => setPaymentsEnabled(Boolean(d?.enabled)))
      .catch(() => {});
    const params = new URLSearchParams(window.location.search);
    const sid = params.get('session_id');
    if (params.get('payment') === 'success' && sid) {
      fetch('/api/payments/verify-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sid }),
      })
        .then((r) => (r.ok ? r.json() : {}))
        .then((res) => {
          if (res?.paid) setMsg({ text: 'Payment received! Thank you.', isError: false });
          window.history.replaceState({}, '', window.location.pathname + window.location.hash);
        })
        .catch(() => {});
    }
  }, []);

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
  const hasHourly = Boolean((selectedFac?.hourly_fee || '').trim());
  const effectiveMode = hasHourly ? rentalMode : 'full_day';

  const daySlots = (data.booked_slots || []).filter(
    (b) => evDate && facId && String(b.facility_id) === String(facId) && b.event_date === evDate,
  );
  const dateBooked = Boolean(
    daySlots.some((b) => {
      if ((b.rental_mode || 'full_day') === 'full_day' || effectiveMode === 'full_day') return true;
      if (!startTime || !endTime || !b.start_time || !b.end_time) return false;
      return startTime < b.end_time && endTime > b.start_time;
    }),
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
          rental_mode: effectiveMode,
          start_time: effectiveMode === 'hourly' ? startTime : '',
          end_time: effectiveMode === 'hourly' ? endTime : '',
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
      setLastReservation(res);
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
                  role="button"
                  tabIndex={0}
                  aria-label={`Select date ${iso}${dayItems.length ? `, ${dayItems.length} event(s)` : ''}`}
                  onClick={() => setEvDate(iso)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setEvDate(iso);
                    }
                  }}
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

        {(data.items || []).filter((it) => it.kind === 'meeting' || it.kind === 'event').length > 0 && (
          <div style={{ marginTop: '1rem', paddingTop: '.85rem', borderTop: '1px solid #e2e8f0' }}>
            <strong style={{ fontSize: '.92rem', display: 'block', marginBottom: '.45rem' }}>
              Meetings &amp; City Events This Month
            </strong>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.35rem' }}>
              {(data.items || [])
                .filter((it) => it.kind === 'meeting' || it.kind === 'event')
                .map((it) => {
                  const rawId = String(it.uid || '').split('-')[1];
                  return (
                    <div key={it.uid} className="between" style={{ fontSize: '.86rem', padding: '.3rem .5rem', background: '#f8fafc', borderRadius: 6, gap: '.5rem' }}>
                      <div>
                        <strong>{it.event_date}</strong>
                        {it.start_time ? ` · ${formatTime12h(it.start_time)}` : ''} — {it.title}
                      </div>
                      {rawId && (
                        <a
                          className="btn sm"
                          href={`/api/calendar/public/ics?kind=${encodeURIComponent(it.kind)}&item_id=${encodeURIComponent(rawId)}`}
                        >
                          + Add to Calendar (.ics)
                        </a>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
        )}
      </div>

      {features.reservations !== false && (data.facilities || []).length > 0 && (
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
                      {f.name} ({f.daily_fee}/day{f.hourly_fee ? `, ${f.hourly_fee}/hr` : ''})
                    </option>
                  ))}
                </select>
              </div>
              <div className="field" style={{ flex: 1, minWidth: 160 }}>
                <label htmlFor="res-date">Event Date *</label>
                <input id="res-date" type="date" required value={evDate} onChange={(e) => setEvDate(e.target.value)} />
              </div>
              {hasHourly && (
                <div className="field" style={{ flex: 1, minWidth: 160 }}>
                  <label htmlFor="res-mode">Rental Type</label>
                  <select id="res-mode" value={effectiveMode} onChange={(e) => setRentalMode(e.target.value)}>
                    <option value="full_day">Full Day / 24hrs ({selectedFac.daily_fee})</option>
                    <option value="hourly">Hourly ({selectedFac.hourly_fee}/hr)</option>
                  </select>
                </div>
              )}
            </div>
            {effectiveMode === 'hourly' && (
              <div className="row">
                <div className="field" style={{ minWidth: 150 }}>
                  <label htmlFor="res-start">Start Time *</label>
                  <input id="res-start" type="time" required value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                </div>
                <div className="field" style={{ minWidth: 150 }}>
                  <label htmlFor="res-end">End Time *</label>
                  <input id="res-end" type="time" required value={endTime} onChange={(e) => setEndTime(e.target.value)} />
                </div>
              </div>
            )}
            {selectedFac && (selectedFac.description || selectedFac.rules || selectedFac.capacity || selectedFac.hourly_fee || selectedFac.deposit_amount) && (
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '.6rem .75rem', fontSize: '.86rem' }}>
                <div>
                  <strong>{selectedFac.name}</strong> — {selectedFac.daily_fee}/24hrs
                  {selectedFac.hourly_fee ? ` or ${selectedFac.hourly_fee}/hr` : ''}
                  {selectedFac.deposit_amount ? ` + ${selectedFac.deposit_amount} deposit` : ''}
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
            {paymentsEnabled && lastReservation && /\d/.test(lastReservation.fee_amount || '') && (
              <div style={{ marginTop: '.4rem' }}>
                <button
                  type="button"
                  className="btn sm primary"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const r = await fetch('/api/payments/checkout', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ item_type: 'reservation', item_id: lastReservation.id }),
                      });
                      const data = await r.json().catch(() => ({}));
                      if (!r.ok) throw new Error(data.detail || 'Could not start checkout');
                      if (data.checkout_url) window.location.href = data.checkout_url;
                    } catch (err) {
                      setMsg({ text: err.message, isError: true });
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Pay Rental Fee Online ({lastReservation.fee_amount})
                </button>
              </div>
            )}
          </form>

          <div style={{ marginTop: '1rem', paddingTop: '.85rem', borderTop: '1px solid #e2e8f0', maxWidth: 680 }}>
            <strong style={{ fontSize: '.92rem', display: 'block', marginBottom: '.4rem' }}>Check Existing Reservation Status</strong>
            <form
              className="row"
              style={{ gap: '.5rem' }}
              onSubmit={async (e) => {
                e.preventDefault();
                setResLookupErr('');
                setResLookupRes(null);
                try {
                  const r = await fetch(`/api/calendar/reservations/public-lookup?reservation_number=${encodeURIComponent(resLookupNum.trim())}`);
                  const d = await r.json().catch(() => ({}));
                  if (!r.ok) throw new Error(d.detail || 'Reservation not found');
                  setResLookupRes(d);
                } catch (ex) {
                  setResLookupErr(ex.message || 'Not found');
                }
              }}
            >
              <input
                placeholder="Enter Reservation # (e.g. RES-2026-0001)"
                value={resLookupNum}
                onChange={(e) => setResLookupNum(e.target.value)}
                style={{ flex: 1 }}
              />
              <button type="submit" className="btn sm">Check Status</button>
            </form>
            {resLookupErr && <div className="error-msg" style={{ marginTop: '.4rem' }}>{resLookupErr}</div>}
            {resLookupRes && (
              <div style={{ marginTop: '.5rem', padding: '.6rem', border: '1px solid #cbd5e1', borderRadius: 6, background: '#f8fafc', fontSize: '.88rem' }}>
                <strong>{resLookupRes.reservation_number}</strong> — {resLookupRes.facility_name} on {resLookupRes.event_date}{' '}
                <span className="badge draft">{resLookupRes.status}</span>{' '}
                <span className="badge">{resLookupRes.payment_status} ({resLookupRes.fee_amount || '$0'})</span>
                {resLookupRes.staff_notes && <div className="muted" style={{ marginTop: '.25rem' }}>Staff note: {resLookupRes.staff_notes}</div>}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}


function TransparencyPublicTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch('/api/public/performance')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="card"><p className="muted">Loading public performance dashboard…</p></div>;
  }
  if (!data) {
    return <div className="card"><p className="muted">Performance metrics are currently unavailable.</p></div>;
  }

  const s = data.summary || {};
  const foia = s.foia || {};
  const compList = data.complaints_by_category || [];
  const permList = data.permits_by_type || [];
  const foiaList = data.foia_by_department || [];
  const maxCompDays = Math.max(1, ...compList.map((c) => Number(c.avg_resolution_days || 0)));
  const maxPermDays = Math.max(1, ...permList.map((p) => Number(p.avg_turnaround_days || 0)));

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <div className="card" style={{ marginBottom: 0 }}>
        <div className="between" style={{ flexWrap: 'wrap', gap: '.65rem', marginBottom: '1rem' }}>
          <div>
            <h2 style={{ margin: 0 }}>Public Transparency &amp; Performance Dashboard</h2>
            <p className="muted" style={{ margin: '.2rem 0 0' }}>
              Anonymized municipal response times, permitting turnaround, and FOIA fulfillment compliance.
            </p>
          </div>
          <div className="actions">
            <a className="btn sm" href="/api/public/performance?download=1" download="dockethall-performance-metrics.json">
              Export Open Data (JSON)
            </a>
            <a className="btn sm primary" href="/api/public/performance.csv" download="dockethall-performance-metrics.csv">
              Export Open Data (CSV)
            </a>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '.75rem' }}>
          <div style={{ padding: '.8rem', border: '1px solid #e2e8f0', borderRadius: 8, background: '#f8fafc' }}>
            <div className="muted" style={{ fontSize: '.8rem' }}>311 / Code Avg Resolution</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--cd-primary)' }}>
              {s.complaints_avg_resolution_days != null ? `${s.complaints_avg_resolution_days} days` : '—'}
            </div>
          </div>
          <div style={{ padding: '.8rem', border: '1px solid #e2e8f0', borderRadius: 8, background: '#f8fafc' }}>
            <div className="muted" style={{ fontSize: '.8rem' }}>Permit Avg Turnaround</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--cd-primary)' }}>
              {s.permits_avg_turnaround_days != null ? `${s.permits_avg_turnaround_days} days` : '—'}
            </div>
          </div>
          <div style={{ padding: '.8rem', border: '1px solid #e2e8f0', borderRadius: 8, background: '#f8fafc' }}>
            <div className="muted" style={{ fontSize: '.8rem' }}>FOIA On-Time Compliance</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--cd-primary)' }}>
              {foia.compliance_rate_pct != null ? `${foia.compliance_rate_pct}%` : '—'}
            </div>
            <div className="muted" style={{ fontSize: '.78rem' }}>
              {foia.on_time_count || 0} of {foia.fulfilled_count || 0} fulfilled on time
            </div>
          </div>
          <div style={{ padding: '.8rem', border: '1px solid #e2e8f0', borderRadius: 8, background: '#f8fafc' }}>
            <div className="muted" style={{ fontSize: '.8rem' }}>FOIA Avg Fulfillment</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--cd-primary)' }}>
              {foia.avg_fulfillment_days != null ? `${foia.avg_fulfillment_days} days` : '—'}
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 0 }}>
        <h3 style={{ marginTop: 0 }}>311 &amp; Code Response Time by Category</h3>
        {!compList.length ? (
          <p className="muted" style={{ margin: 0 }}>No resolved 311/code cases recorded yet.</p>
        ) : (
          <table>
            <thead>
              <tr><th>Category</th><th>Total Cases</th><th>Resolved</th><th>Avg Resolution Time</th></tr>
            </thead>
            <tbody>
              {compList.map((c) => (
                <tr key={c.category}>
                  <td><strong>{c.category}</strong></td>
                  <td>{c.total_cases}</td>
                  <td>{c.resolved_cases}</td>
                  <td style={{ minWidth: 180 }}>
                    {c.avg_resolution_days != null ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                        <div style={{ flex: 1, height: 8, background: '#e2e8f0', borderRadius: 4, overflow: 'hidden' }}>
                          <div style={{ width: `${Math.min(100, (c.avg_resolution_days / maxCompDays) * 100)}%`, height: '100%', background: 'var(--cd-primary)' }} />
                        </div>
                        <span style={{ fontSize: '.85rem', fontWeight: 600 }}>{c.avg_resolution_days}d</span>
                      </div>
                    ) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card" style={{ marginBottom: 0 }}>
        <h3 style={{ marginTop: 0 }}>Permit Turnaround Times by Type</h3>
        {!permList.length ? (
          <p className="muted" style={{ margin: 0 }}>No permit applications recorded yet.</p>
        ) : (
          <table>
            <thead>
              <tr><th>Permit Type</th><th>Applications</th><th>Approved / Issued</th><th>Avg Turnaround</th></tr>
            </thead>
            <tbody>
              {permList.map((p) => (
                <tr key={p.permit_type}>
                  <td><strong>{p.permit_type}</strong></td>
                  <td>{p.total_applications}</td>
                  <td>{p.issued_count}</td>
                  <td style={{ minWidth: 180 }}>
                    {p.avg_turnaround_days != null ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                        <div style={{ flex: 1, height: 8, background: '#e2e8f0', borderRadius: 4, overflow: 'hidden' }}>
                          <div style={{ width: `${Math.min(100, (p.avg_turnaround_days / maxPermDays) * 100)}%`, height: '100%', background: 'var(--cd-primary)' }} />
                        </div>
                        <span style={{ fontSize: '.85rem', fontWeight: 600 }}>{p.avg_turnaround_days}d</span>
                      </div>
                    ) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card" style={{ marginBottom: 0 }}>
        <h3 style={{ marginTop: 0 }}>FOIA Fulfillment Compliance by Department</h3>
        {!foiaList.length ? (
          <p className="muted" style={{ margin: 0 }}>No FOIA requests recorded yet.</p>
        ) : (
          <table>
            <thead>
              <tr><th>Department</th><th>Total Requests</th><th>Fulfilled</th><th>On-Time Rate</th><th>Avg Days</th></tr>
            </thead>
            <tbody>
              {foiaList.map((f) => (
                <tr key={f.department}>
                  <td><strong>{f.department}</strong></td>
                  <td>{f.total_requests}</td>
                  <td>{f.fulfilled_count}</td>
                  <td>{f.compliance_rate_pct != null ? <span className="badge final">{f.compliance_rate_pct}%</span> : '—'}</td>
                  <td>{f.avg_fulfillment_days != null ? `${f.avg_fulfillment_days}d` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function TransparencySnapshotBar({ onSelectTab }) {
  const [metrics, setMetrics] = useState([]);
  useEffect(() => {
    fetch('/api/public/transparency')
      .then((r) => (r.ok ? r.json() : { metrics: [] }))
      .then((d) => setMetrics(Array.isArray(d.metrics) ? d.metrics : []))
      .catch(() => {});
  }, []);
  if (!metrics.length) return null;
  return (
    <div className="card" style={{ marginBottom: 0 }}>
      <div className="between" style={{ marginBottom: '.65rem', flexWrap: 'wrap', gap: '.5rem' }}>
        <div>
          <strong style={{ fontSize: '.95rem' }}>City Transparency Snapshot</strong>
          <span className="muted" style={{ fontSize: '.8rem', marginLeft: '.5rem' }}>Live public counts (YTD &amp; upcoming)</span>
        </div>
        <button type="button" className="btn sm" onClick={() => onSelectTab('transparency')}>
          Full Performance Dashboard →
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '.6rem' }}>
        {metrics.map((m) => (
          <button
            key={m.label}
            type="button"
            onClick={() => onSelectTab(m.tab)}
            style={{
              textAlign: 'left',
              padding: '.6rem .75rem',
              borderRadius: 8,
              border: '1px solid #e2e8f0',
              background: '#f8fafc',
              cursor: 'pointer',
            }}
          >
            <div style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--cd-primary)' }}>{m.value}</div>
            <div className="muted" style={{ fontSize: '.78rem' }}>{m.label}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function NotifyMeCard({ t = (k) => k }) {
  const [topics, setTopics] = useState([]);
  const [selected, setSelected] = useState([]);
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [smsEnabled, setSmsEnabled] = useState(false);
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
        body: JSON.stringify({
          email: email.trim(),
          topics: selected,
          phone: phone.trim(),
          sms_enabled: smsEnabled,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.detail || 'Subscription failed');
      setMsg({ text: data.message || 'Subscribed to alerts.', isError: false });
      setEmail('');
      setPhone('');
      setSmsEnabled(false);
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
            <h2 style={{ margin: 0, fontSize: '1.1rem' }}>{t('Public Email & SMS Alerts')}</h2>
          </div>
          <p className="muted" style={{ margin: '0 0 .75rem', fontSize: '.9rem' }}>
            {t('Subscribe to receive automatic email or text alerts whenever new city agendas, code updates, notices, or public records are published.')}
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem 1.25rem', marginBottom: '.75rem' }}>
            {topics.map((tp) => (
              <label key={tp.id} style={{ display: 'flex', alignItems: 'center', gap: '.4rem', fontSize: '.9rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  style={{ width: 'auto' }}
                  checked={selected.includes(tp.id)}
                  onChange={() => toggleTopic(tp.id)}
                />
                <span>{tp.label}</span>
              </label>
            ))}
          </div>
          <form onSubmit={handleSubscribe} style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem', alignItems: 'center', maxWidth: 680 }}>
            <input
              type="email"
              required
              aria-label="Email address for public alerts"
              placeholder={t('Enter your email address…')}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{ flex: 1, minWidth: 200 }}
            />
            <input
              type="tel"
              aria-label="Mobile phone for SMS alerts"
              placeholder={t('Mobile phone for SMS (optional)')}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              style={{ flex: 1, minWidth: 180 }}
            />
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem', fontSize: '.86rem' }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={smsEnabled} onChange={(e) => setSmsEnabled(e.target.checked)} />
              <span>{t('SMS Alerts')}</span>
            </label>
            <button type="submit" className="btn primary" disabled={busy}>
              {busy ? t('Subscribing…') : t('Subscribe')}
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


function PayBillsPublicTab({ billType = '' }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [paymentsEnabled, setPaymentsEnabled] = useState(false);
  const [payingId, setPayingId] = useState(null);
  const [payMsg, setPayMsg] = useState('');
  const [contestBill, setContestBill] = useState(null);
  const [contestReason, setContestReason] = useState('');
  const [contesting, setContesting] = useState(false);

  useEffect(() => {
    fetch('/api/payments/config')
      .then((r) => (r.ok ? r.json() : {}))
      .then((d) => setPaymentsEnabled(Boolean(d?.enabled)))
      .catch(() => {});
    const params = new URLSearchParams(window.location.search);
    const sid = params.get('session_id');
    if (params.get('payment') === 'success' && sid) {
      fetch('/api/payments/verify-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sid }),
      })
        .then((r) => (r.ok ? r.json() : {}))
        .then((res) => {
          if (res?.paid) setPayMsg('Payment received! Your account balance has been updated.');
          window.history.replaceState({}, '', window.location.pathname + window.location.hash);
        })
        .catch(() => {});
    }
  }, []);

  const lookup = async (e) => {
    e.preventDefault();
    const term = query.trim();
    if (term.length < 3) {
      setErr('Please enter at least 3 characters (Account # or Citation/Reference #).');
      return;
    }
    setErr('');
    setLoading(true);
    try {
      const r = await fetch(`/api/payments/bills/public-lookup?q=${encodeURIComponent(term)}`);
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.detail || 'Lookup failed');
      }
      const list = await r.json();
      setResults(billType ? (Array.isArray(list) ? list.filter((b) => b.bill_type === billType) : []) : list);
    } catch (ex) {
      setErr(ex.message || 'Lookup failed');
      setResults(null);
    } finally {
      setLoading(false);
    }
  };

  const startPay = async (bill) => {
    setPayingId(bill.id);
    setErr('');
    try {
      const r = await fetch('/api/payments/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_type: 'bill', item_id: bill.id }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.checkout_url) {
        throw new Error(d.detail || 'Unable to start online checkout');
      }
      window.location.href = d.checkout_url;
    } catch (ex) {
      setErr(ex.message || 'Checkout failed');
      setPayingId(null);
    }
  };

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', marginBottom: '.5rem' }}>
        <ServiceIcon id={billType === 'utility' ? 'utilities' : (billType === 'citation' ? 'citations' : 'pay')} size={20} badge />
        <h2 style={{ margin: 0 }}>
          {billType === 'utility'
            ? 'Pay Utility Bill'
            : (billType === 'citation' ? 'Pay or Contest Municipal Citation' : 'Pay Utility Bill, Citation or Municipal Fee')}
        </h2>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        Look up water/sewer utility statements, municipal or parking citations, license renewals, or other city fees by your exact Account # or Reference / Citation #.
      </p>
      {payMsg && <div className="ok-msg" role="status" style={{ marginBottom: '.75rem' }}>{payMsg}</div>}
      <form onSubmit={lookup} className="row" style={{ gap: '.5rem', marginBottom: '1rem' }}>
        <input
          aria-label="Utility account number or citation reference number"
          placeholder="Enter Account # (e.g. ACCT-1042) or Reference # (e.g. UTIL-00001, CIT-00002)…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ flex: 1, minWidth: 260 }}
        />
        <button type="submit" className="btn primary" disabled={loading}>
          {loading ? 'Searching…' : 'Look Up Balance'}
        </button>
      </form>
      {err && <div className="error-msg" role="alert">{err}</div>}
      {Array.isArray(results) && (
        results.length === 0 ? (
          <p className="muted">No matching utility bills, citations, or fees found for "{query.trim()}".</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Reference #</th>
                  <th>Type</th>
                  <th>Account / Address</th>
                  <th>Description</th>
                  <th>Due Date</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {results.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <strong>{b.reference_number}</strong>
                      {b.late_fee_applied && <div><span className="badge draft">Late Fee Added</span></div>}
                      {b.dispute_status === 'contested' && <div><span className="badge draft">Hearing Requested</span></div>}
                    </td>
                    <td>{b.bill_type}</td>
                    <td>{b.account_number || b.service_address || '—'}</td>
                    <td>
                      <div>{b.description || '—'}</div>
                      {Array.isArray(b.line_items) && b.line_items.length > 0 && (
                        <div className="muted" style={{ fontSize: '.78rem' }}>
                          {b.line_items.map((li) => `${li.label}${li.amount ? `: ${li.amount}` : ''}`).join(' · ')}
                        </div>
                      )}
                    </td>
                    <td>{b.due_date ? formatDate(b.due_date) : '—'}</td>
                    <td>
                      <strong>{b.amount_due}</strong>
                      {b.amount_paid && <div className="muted" style={{ fontSize: '.78rem' }}>Paid: {b.amount_paid}</div>}
                    </td>
                    <td>
                      <span className={`badge ${b.payment_status === 'paid' ? 'active' : (b.payment_status === 'waived' ? 'draft' : 'disabled')}`}>
                        {b.payment_status}
                      </span>
                    </td>
                    <td>
                      <div className="actions">
                        <a className="btn sm" href={`/api/payments/public/bills/${encodeURIComponent(b.reference_number)}/receipt.pdf`} target="_blank" rel="noreferrer">
                          PDF
                        </a>
                        {b.payment_status === 'unpaid' && (
                          <>
                            {paymentsEnabled ? (
                              <button type="button" className="btn sm primary" disabled={payingId === b.id} onClick={() => startPay(b)}>
                                {payingId === b.id ? 'Redirecting…' : 'Pay Online'}
                              </button>
                            ) : (
                              <span className="muted" style={{ fontSize: '.82rem' }}>Pay at City Hall</span>
                            )}
                            {b.bill_type === 'citation' && b.dispute_status !== 'contested' && (
                              <button
                                type="button"
                                className="btn sm"
                                onClick={() => {
                                  setContestBill(b);
                                  setContestReason('');
                                  setErr('');
                                }}
                              >
                                Contest
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {contestBill && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="contest-bill-title"
          style={{
            position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', zIndex: 1000,
          }}
          onClick={(e) => { if (e.target === e.currentTarget && !contesting) setContestBill(null); }}
        >
          <div className="card" style={{ width: '100%', maxWidth: '460px', margin: 0 }}>
            <h3 id="contest-bill-title" style={{ marginTop: 0 }}>Contest Citation — {contestBill.reference_number}</h3>
            <p className="muted" style={{ marginTop: 0, fontSize: '.88rem' }}>
              Explain why you are contesting this citation or requesting a formal hearing.
            </p>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!contestReason.trim()) return;
                setContesting(true);
                setErr('');
                try {
                  const r = await fetch('/api/payments/public/bills/contest', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ reference_number: contestBill.reference_number, reason: contestReason.trim() }),
                  });
                  const updated = await r.json().catch(() => ({}));
                  if (!r.ok) throw new Error(updated.detail || 'Failed to submit contest request.');
                  setResults((prev) => (prev || []).map((x) => (x.id === contestBill.id ? updated : x)));
                  setPayMsg(`Hearing/contest request submitted for ${contestBill.reference_number}.`);
                  setContestBill(null);
                } catch (e2) {
                  setErr(e2.message || 'Failed to submit contest request.');
                } finally {
                  setContesting(false);
                }
              }}
              style={{ display: 'grid', gap: '.75rem' }}
            >
              <div className="field">
                <label htmlFor="contest-reason-input">Reason for Contest / Hearing Request *</label>
                <textarea
                  id="contest-reason-input"
                  rows={4}
                  required
                  value={contestReason}
                  onChange={(e) => setContestReason(e.target.value)}
                  placeholder="Describe the reason for your dispute..."
                />
              </div>
              <div className="actions" style={{ justifyContent: 'flex-end' }}>
                <button type="button" className="btn" disabled={contesting} onClick={() => setContestBill(null)}>Cancel</button>
                <button type="submit" className="btn primary" disabled={contesting}>{contesting ? 'Submitting…' : 'Submit Request'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}


function LatestBlogPreviewCard({ enabled, limit = 3, styleMode = 'cards', heading = '', onOpenPost, onViewAll }) {
  const [posts, setPosts] = useState([]);
  const safeLimit = Math.max(1, Math.min(20, Number(limit) || 3));

  useEffect(() => {
    if (!enabled) {
      setPosts([]);
      return;
    }
    fetch(`/api/blog/public?home_only=true&limit=${safeLimit}`)
      .then((r) => (r.ok ? r.json() : { posts: [] }))
      .then((d) => setPosts(Array.isArray(d?.posts) ? d.posts : []))
      .catch(() => setPosts([]));
  }, [enabled, safeLimit]);

  if (!enabled || posts.length === 0) return null;
  const sectionTitle = (heading || '').trim() || 'Latest from the Blog';

  return (
    <div className="card" style={{ marginBottom: 0 }}>
      <div className="between" style={{ marginBottom: '.65rem' }}>
        <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
          <ServiceIcon id="blog" size={18} badge />
          <span>{sectionTitle}</span>
        </h2>
        <div className="actions">
          <a href="/api/blog/rss.xml" target="_blank" rel="noreferrer" className="btn sm">RSS</a>
          <button type="button" className="btn sm" onClick={onViewAll}>View All Blog Posts →</button>
        </div>
      </div>
      {styleMode === 'full' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {posts.map((p) => (
            <article
              key={p.id}
              style={{
                border: '1px solid #e2e8f0',
                borderRadius: 8,
                padding: '1rem 1.15rem',
                background: '#f8fafc',
              }}
            >
              {p.has_image && (
                <img
                  src={`${p.image_url}?v=${p.updated_at || ''}`}
                  alt={p.title}
                  className="blog-cover-img"
                />
              )}
              <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '.35rem' }}>
                <span className="badge draft">{p.category_name}</span>
                {p.is_featured && (
                  <span className="badge" style={{ background: '#fef3c7', color: '#92400e' }}>Featured</span>
                )}
                <span className="muted" style={{ fontSize: '.82rem' }}>
                  {formatDate(p.publish_at)}
                  {p.author_name ? ` · By ${p.author_name}` : ''}
                </span>
              </div>
              <h3 style={{ margin: '0 0 .45rem', fontSize: '1.22rem' }}>
                <a
                  href={`/blog/${encodeURIComponent(p.slug)}`}
                  onClick={(e) => {
                    e.preventDefault();
                    onOpenPost(p.slug);
                  }}
                  style={{ color: '#0f172a', textDecoration: 'none' }}
                >
                  {p.title}
                </a>
              </h3>
              {p.lead_in && (
                <p className="muted" style={{ margin: '0 0 .65rem', fontSize: '.96rem', lineHeight: 1.5 }}>{p.lead_in}</p>
              )}
              <RichTextContent text={p.body} />
              <div
                className="between"
                style={{ marginTop: '.85rem', paddingTop: '.6rem', borderTop: '1px solid #e2e8f0', gap: '.5rem' }}
              >
                <div style={{ display: 'flex', gap: '.3rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  {Array.isArray(p.tags) && p.tags.map((t) => (
                    <span key={t} className="badge draft" style={{ fontSize: '.74rem' }}>#{t}</span>
                  ))}
                  {p.effective_comment_policy !== 'disabled' && (
                    <span className="muted" style={{ fontSize: '.82rem' }}>
                      {p.approved_comment_count} comment{p.approved_comment_count === 1 ? '' : 's'}
                    </span>
                  )}
                </div>
                <button type="button" className="btn sm" onClick={() => onOpenPost(p.slug)}>
                  Open Post &amp; Comments →
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '.75rem' }}>
          {posts.map((p) => (
            <div
              key={p.id}
              role="button"
              tabIndex={0}
              onClick={() => onOpenPost(p.slug)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onOpenPost(p.slug);
                }
              }}
              style={{
                border: '1px solid #e2e8f0',
                borderRadius: 8,
                padding: '.75rem .9rem',
                background: '#f8fafc',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                gap: '.45rem',
              }}
            >
              <div>
                {p.has_image && (
                  <img
                    src={`${p.image_url}?v=${p.updated_at || ''}`}
                    alt={p.title}
                    style={{ width: '100%', height: 130, objectFit: 'cover', borderRadius: 6, marginBottom: '.55rem' }}
                  />
                )}
                <div style={{ display: 'flex', gap: '.35rem', flexWrap: 'wrap', marginBottom: '.3rem' }}>
                  <span className="badge draft">{p.category_name}</span>
                  <span className="muted" style={{ fontSize: '.78rem' }}>{formatDate(p.publish_at)}</span>
                </div>
                <div style={{ fontWeight: 600, fontSize: '.98rem', color: '#0f172a', marginBottom: '.25rem' }}>{p.title}</div>
                {p.lead_in && (
                  <div className="muted" style={{ fontSize: '.84rem', lineHeight: 1.4 }}>{p.lead_in}</div>
                )}
              </div>
              <div style={{ fontSize: '.84rem', fontWeight: 600, color: 'var(--cd-primary)' }}>Read Article →</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


function isPublicTabAllowed(tabId, enabledList, publicFeatures = {}) {
  if (!tabId) return false;
  if (['pay', 'utilities', 'citations', 'transparency'].includes(tabId)) return true;
  const list = Array.isArray(enabledList) ? enabledList : [];
  if (tabId === 'blog') {
    return list.includes('blog') || (list.includes('communications') && publicFeatures?.communications?.blog !== false);
  }
  if (list.includes(tabId)) return true;
  if (['notices', 'directory', 'forms', 'pages'].includes(tabId) && list.includes('communications')) {
    return true;
  }
  return false;
}


function parsePublicLocation(pathname, rawHash) {
  const pathClean = (pathname || '/').replace(/^\/+|\/+$/g, '');
  if (pathClean && pathClean !== 'index.html') {
    const slashIdx = pathClean.indexOf('/');
    if (slashIdx === -1) return { tab: pathClean, slug: '', fromHash: false };
    return {
      tab: pathClean.slice(0, slashIdx),
      slug: decodeURIComponent(pathClean.slice(slashIdx + 1)),
      fromHash: false,
    };
  }
  const clean = (rawHash || '').replace(/^#/, '');
  if (!clean) return { tab: 'overview', slug: '', fromHash: false };
  const slashIdx = clean.indexOf('/');
  if (slashIdx === -1) return { tab: clean, slug: '', fromHash: true };
  return {
    tab: clean.slice(0, slashIdx),
    slug: decodeURIComponent(clean.slice(slashIdx + 1)),
    fromHash: true,
  };
}


const PUBLIC_I18N = {
  es: {
    'Sign In': 'Iniciar sesión',
    'Create Account': 'Crear cuenta',
    'Go to Workspace': 'Ir al espacio de trabajo',
    'Sign out': 'Cerrar sesión',
    '← All Public Services': '← Todos los servicios públicos',
    'Public Email & SMS Alerts': 'Alertas públicas por correo y SMS',
    'Subscribe to receive automatic email or text alerts whenever new city agendas, code updates, notices, or public records are published.': 'Suscríbase para recibir alertas automáticas por correo o SMS cuando se publiquen nuevas agendas, códigos, avisos o registros públicos.',
    'Enter your email address…': 'Ingrese su correo electrónico…',
    'Mobile phone for SMS (optional)': 'Teléfono móvil para SMS (opcional)',
    'SMS Alerts': 'Alertas SMS',
    'Subscribing…': 'Suscribiendo…',
    'Subscribe': 'Suscribirse',
  },
  fr: {
    'Sign In': 'Se connecter',
    'Create Account': 'Créer un compte',
    'Go to Workspace': 'Aller à l’espace de travail',
    'Sign out': 'Se déconnecter',
    '← All Public Services': '← Tous les services publics',
    'Public Email & SMS Alerts': 'Alertes publiques par courriel et SMS',
    'Subscribe to receive automatic email or text alerts whenever new city agendas, code updates, notices, or public records are published.': 'Abonnez-vous pour recevoir des alertes automatiques par courriel ou SMS lors de la publication d’ordres du jour, de codes, d’avis ou de dossiers publics.',
    'Enter your email address…': 'Entrez votre adresse courriel…',
    'Mobile phone for SMS (optional)': 'Téléphone mobile pour SMS (optionnel)',
    'SMS Alerts': 'Alertes SMS',
    'Subscribing…': 'Abonnement…',
    'Subscribe': 'S’abonner',
  },
  so: {
    'Sign In': 'Soo Gal',
    'Create Account': 'Samee Koonto',
    'Go to Workspace': 'Tag Goobta Shaqada',
    'Sign out': 'Ka Bax',
    '← All Public Services': '← Dhammaan Adeegyada Dadweynaha',
    'Public Email & SMS Alerts': 'Ogeysiisyada Iimaylka & SMS-ka',
    'Subscribe to receive automatic email or text alerts whenever new city agendas, code updates, notices, or public records are published.': 'Isdiiwaangeli si aad u hesho ogeysiisyo iimayl ama fariin qoraal ah markii la daabaco ajandayaasha cusub, xeerarka, ogeysiisyada, ama diiwaanada.',
    'Enter your email address…': 'Geli cinwaanka iimaylkaaga…',
    'Mobile phone for SMS (optional)': 'Telefoonka gacanta ee SMS (ikhtiyaari)',
    'SMS Alerts': 'Ogeysiisyada SMS',
    'Subscribing…': 'Waa la diiwaangelinayaa…',
    'Subscribe': 'Isdiiwaangeli',
  },
  hmn: {
    'Sign In': 'Nkag Mus',
    'Create Account': 'Tsim Ib Tug As-khauj',
    'Go to Workspace': 'Mus Rau Chaw Ua Haujlwm',
    'Sign out': 'Tawm Mus',
    '← All Public Services': '← Tag Nrho Cov Kev Pab Pejxeem',
    'Public Email & SMS Alerts': 'Ceeb Toom Email & SMS Rau Pejxeem',
    'Subscribe to receive automatic email or text alerts whenever new city agendas, code updates, notices, or public records are published.': 'Sau npe kom tau txais email lossis SMS ceeb toom thaum muaj cov txheej txheem tshiab, txoj cai, lossis ntaub ntawv pejxeem.',
    'Enter your email address…': 'Sau koj tus email…',
    'Mobile phone for SMS (optional)': 'Xov tooj ntawm tes rau SMS (yeem xaiv)',
    'SMS Alerts': 'Ceeb Toom SMS',
    'Subscribing…': 'Tab tom sau npe…',
    'Subscribe': 'Sau Npe',
  },
};

function PublicHomePage() {
  const params = useMemo(() => new URLSearchParams(location.search), []);
  const lang = 'en';
  const t = useCallback((key) => (PUBLIC_I18N[lang]?.[key]) || key, [lang]);
  const [branding, setBranding] = useState({ city_title: '', has_city_logo: false });
  const [enabledModules, setEnabledModules] = useState(null);
  const [publicFeatures, setPublicFeatures] = useState({});
  const [showAllServices, setShowAllServices] = useState(() => {
    try {
      return localStorage.getItem('dockethall.showAllServices') === 'true';
    } catch {
      return false;
    }
  });
  const [me, setMe] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [activeItemSlug, setActiveItemSlug] = useState('');
  const [homeEditOpen, setHomeEditOpen] = useState(false);
  const [homeHeadingDraft, setHomeHeadingDraft] = useState('');
  const [homeIntroDraft, setHomeIntroDraft] = useState('');
  const [homeBlogEnabledDraft, setHomeBlogEnabledDraft] = useState(true);
  const [homeBlogCountDraft, setHomeBlogCountDraft] = useState(3);
  const [homeBlogStyleDraft, setHomeBlogStyleDraft] = useState('cards');
  const [homeBlogPositionDraft, setHomeBlogPositionDraft] = useState('below_services');
  const [homeBlogHeadingDraft, setHomeBlogHeadingDraft] = useState('');
  const [homeEditBusy, setHomeEditBusy] = useState(false);
  const [homeEditErr, setHomeEditErr] = useState('');

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
        document.title = title ? `${title} - DocketHall` : 'DocketHall — Public Portal';
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
      .then((r) => (r.ok ? r.json() : { enabled: [], features: {} }))
      .then((d) => {
        const list = Array.isArray(d.enabled) ? d.enabled : [];
        const feats = d && typeof d.features === 'object' && d.features ? d.features : {};
        setEnabledModules(list);
        setPublicFeatures(feats);
        const parsed = parsePublicLocation(location.pathname, location.hash);
        if (isPublicTabAllowed(parsed.tab, list, feats)) {
          setActiveTab(parsed.tab);
          setActiveItemSlug(parsed.slug || '');
          if (parsed.fromHash) {
            const cleanUrl = parsed.tab === 'overview'
              ? '/'
              : (parsed.slug ? `/${parsed.tab}/${encodeURIComponent(parsed.slug)}` : `/${parsed.tab}`);
            history.replaceState(null, '', cleanUrl);
          }
        } else {
          setActiveTab('overview');
          setActiveItemSlug('');
        }
      })
      .catch(() => { setEnabledModules([]); setPublicFeatures({}); });
  }, [params]);

  useEffect(() => {
    const onRoute = () => {
      const parsed = parsePublicLocation(location.pathname, location.hash);
      if (!parsed.tab || parsed.tab === 'overview') {
        setActiveTab('overview');
        setActiveItemSlug('');
      } else if (isPublicTabAllowed(parsed.tab, enabledModules, publicFeatures)) {
        setActiveTab(parsed.tab);
        setActiveItemSlug(parsed.slug || '');
      }
    };
    window.addEventListener('popstate', onRoute);
    window.addEventListener('hashchange', onRoute);
    return () => {
      window.removeEventListener('popstate', onRoute);
      window.removeEventListener('hashchange', onRoute);
    };
  }, [enabledModules, publicFeatures]);

  const hiddenCards = useMemo(
    () => new Set((Array.isArray(branding.home_hidden_cards) ? branding.home_hidden_cards : []).map((c) => String(c).toLowerCase())),
    [branding.home_hidden_cards],
  );

  useEffect(() => {
    if (activeTab !== 'overview' && hiddenCards.has(activeTab)) {
      setActiveTab('overview');
      setActiveItemSlug('');
    }
  }, [activeTab, hiddenCards]);

  const visibleTabs = useMemo(() => {
    if (!enabledModules) return [];
    const hasComms = enabledModules.includes('communications');
    const blogEnabled = hasComms && publicFeatures?.communications?.blog !== false;
    const cmsIds = new Set(['notices', 'directory', 'forms', 'pages']);
    const out = TAB_DEFS.filter((t) => {
      if (hiddenCards.has(t.id)) return false;
      if (t.id === 'blog') return blogEnabled || enabledModules.includes('blog');
      if (cmsIds.has(t.id)) return hasComms || enabledModules.includes(t.id);
      return enabledModules.includes(t.id);
    });
    if (enabledModules.includes('utilities') && !hiddenCards.has('utilities')) {
      out.push({
        id: 'utilities',
        label: 'Pay Utility Bill',
        description: 'Look up your water, sewer, or trash account balance and pay online via Stripe.',
        actionLabel: 'Look Up Utility Bill →',
      });
    }
    if (enabledModules.includes('citations') && !hiddenCards.has('citations')) {
      out.push({
        id: 'citations',
        label: 'Pay / Contest Citation',
        description: 'Look up a parking or municipal code citation to pay online or request a hearing.',
        actionLabel: 'Look Up Citation →',
      });
    }
    return out;
  }, [enabledModules, publicFeatures, hiddenCards]);

  const overviewTabs = useMemo(() => {
    if (showAllServices || visibleTabs.length <= 4) return visibleTabs;
    return visibleTabs.slice(0, 4);
  }, [visibleTabs, showAllServices]);

  const canEditHomeText = Boolean(
    me && Array.isArray(me.permissions) && ['*', 'settings.manage', 'pages.manage', 'blog.manage', 'agendas.manage'].some((p) => me.permissions.includes(p))
  );

  function openAuth(nextUrl = '/app', register = false, reason = '') {
    setAuthModal({ open: true, register, nextUrl, reason });
  }

  function selectTab(tabId, slug = '') {
    setActiveTab(tabId);
    setActiveItemSlug(slug || '');
    const targetPath = tabId === 'overview'
      ? '/'
      : (slug ? `/${tabId}/${encodeURIComponent(slug)}` : `/${tabId}`);
    if (location.pathname !== targetPath || location.hash) {
      history.pushState(null, '', targetPath);
    }
  }

  async function saveHomeText(e) {
    e.preventDefault();
    setHomeEditBusy(true);
    setHomeEditErr('');
    try {
      const res = await fetch('/api/branding/home-text', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          home_heading: homeHeadingDraft.trim(),
          home_intro_body: homeIntroDraft.trim(),
          home_blog_enabled: homeBlogEnabledDraft,
          home_blog_count: Math.max(1, Math.min(20, Number(homeBlogCountDraft) || 3)),
          home_blog_style: homeBlogStyleDraft,
          home_blog_position: homeBlogPositionDraft,
          home_blog_heading: homeBlogHeadingDraft.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || `Failed (${res.status})`);
      setBranding(data);
      setHomeEditOpen(false);
    } catch (err) {
      setHomeEditErr(err.message);
    } finally {
      setHomeEditBusy(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <DemoBanner demoMode={Boolean(branding.demo_mode)} />
      <UrgentAlertBanner branding={branding} />
      <PublicHeader
        branding={branding}
        brandHref="/"
        onBrandClick={(e) => {
          e.preventDefault();
          selectTab('overview');
        }}
        subtitle="DocketHall"
        logoHeight={52}
      >
        {me ? (
          <>
            <span>{me.username} ({ROLE_LABELS[me.role] || me.role})</span>
            <a className="btn sm primary" href="/app">{t('Go to Workspace')}</a>
            <button
              type="button"
              className="btn sm"
              onClick={async () => {
                await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' });
                setMe(null);
              }}
            >
              {t('Sign out')}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn sm primary" onClick={() => openAuth('/app', false, '')}>
              {t('Sign In')}
            </button>
            <button type="button" className="btn sm" onClick={() => openAuth('/app', true, 'Create an applicant account to submit and track permit applications or complaints.')}>
              {t('Create Account')}
            </button>
          </>
        )}
      </PublicHeader>

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
              <div className="between" style={{ gap: '.5rem', marginBottom: '.35rem' }}>
                <h1 style={{ margin: 0 }}>
                  {branding.home_heading || (branding.city_title?.trim() ? `Welcome to ${branding.city_title.trim()}` : 'City Services & Community Hub')}
                </h1>
                {canEditHomeText && (
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => {
                      setHomeEditErr('');
                      setHomeHeadingDraft(branding.home_heading || '');
                      setHomeIntroDraft(branding.home_intro_body || '');
                      setHomeBlogEnabledDraft(branding.home_blog_enabled !== false);
                      setHomeBlogCountDraft(Number(branding.home_blog_count) || 3);
                      setHomeBlogStyleDraft(branding.home_blog_style === 'full' ? 'full' : 'cards');
                      setHomeBlogPositionDraft(branding.home_blog_position === 'above_services' ? 'above_services' : 'below_services');
                      setHomeBlogHeadingDraft(branding.home_blog_heading || '');
                      setHomeEditOpen(true);
                    }}
                  >
                    Edit Page Text
                  </button>
                )}
              </div>
              {branding.home_intro_body ? (
                <RichTextContent text={branding.home_intro_body} />
              ) : (
                <p className="muted" style={{ margin: 0 }}>
                  Read community updates, browse city information, view meeting agendas and City Code, and access online resident services — no account required for public information.
                </p>
              )}
            </div>

            {branding.demo_mode && (
              <div
                role="region"
                aria-label="Interactive Demo Guide"
                style={{
                  background: 'linear-gradient(135deg, #eff6ff 0%, #f8fafc 100%)',
                  border: '2px solid #2563eb',
                  borderRadius: '12px',
                  padding: '1rem 1.25rem',
                  marginBottom: '1.1rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '1rem',
                  flexWrap: 'wrap',
                  boxShadow: '0 4px 14px rgba(37, 99, 235, 0.10)',
                }}
              >
                <div style={{ flex: '1 1 320px' }}>
                  <div style={{ fontWeight: 800, fontSize: '1.02rem', color: '#0f2942', marginBottom: '.25rem' }}>
                    Explore the Full Staff &amp; Resident Experience
                  </div>
                  <div style={{ fontSize: '.92rem', color: '#334155', lineHeight: 1.5 }}>
                    Want to see behind the scenes? Click <strong>Sign In</strong> in the top-right corner to try DocketHall with one click as a <strong>City Clerk</strong>, <strong>Field Inspector</strong>, <strong>Resident</strong>, or <strong>Administrator</strong>—no credentials required.
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', flexShrink: 0 }}>
                  {me ? (
                    <a className="btn primary" href="/app">Go to Workspace &rarr;</a>
                  ) : (
                    <button
                      type="button"
                      className="btn primary"
                      onClick={() => openAuth('/app', false, 'Choose any role below to explore DocketHall instantly—no credentials required.')}
                    >
                      Try One-Click Sign In &rarr;
                    </button>
                  )}
                </div>
              </div>
            )}

            <GlobalSearchBar onSelectTab={selectTab} />

            {branding.home_blog_position === 'above_services' && (
              <LatestBlogPreviewCard
                enabled={
                  enabledModules.includes('communications') &&
                  publicFeatures?.communications?.blog !== false &&
                  branding.home_blog_enabled !== false
                }
                limit={branding.home_blog_count || 3}
                styleMode={branding.home_blog_style === 'full' ? 'full' : 'cards'}
                heading={branding.home_blog_heading || ''}
                onOpenPost={(slug) => selectTab('blog', slug)}
                onViewAll={() => selectTab('blog')}
              />
            )}

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))',
                gap: '1rem',
              }}
            >
              {overviewTabs.map((t) => (
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

            {visibleTabs.length > 4 && (
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => {
                    const next = !showAllServices;
                    setShowAllServices(next);
                    try { localStorage.setItem('dockethall.showAllServices', String(next)); } catch { /* ignore */ }
                  }}
                >
                  {showAllServices ? 'Show Fewer Services ▴' : `Show All City Services (${visibleTabs.length}) ▾`}
                </button>
              </div>
            )}

            {branding.home_blog_position !== 'above_services' && (
              <LatestBlogPreviewCard
                enabled={
                  enabledModules.includes('communications') &&
                  publicFeatures?.communications?.blog !== false &&
                  branding.home_blog_enabled !== false
                }
                limit={branding.home_blog_count || 3}
                styleMode={branding.home_blog_style === 'full' ? 'full' : 'cards'}
                heading={branding.home_blog_heading || ''}
                onOpenPost={(slug) => selectTab('blog', slug)}
                onViewAll={() => selectTab('blog')}
              />
            )}

            <TransparencySnapshotBar onSelectTab={selectTab} />

            <NotifyMeCard t={t} />
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <a
                href="/"
                onClick={(e) => {
                  e.preventDefault();
                  selectTab('overview');
                }}
                style={{ fontSize: '.92rem', fontWeight: 500, color: 'var(--cd-primary)', textDecoration: 'none' }}
              >
                {t('← All Public Services')}
              </a>
            </div>
            {activeTab === 'agendas' && (
              <AgendasPublicTab
                me={me}
                onRequireAuth={openAuth}
                initialItemId={activeItemSlug}
                onItemChange={(id) => selectTab('agendas', id)}
              />
            )}
            {activeTab === 'permits' && <PermitsPublicTab me={me} onRequireAuth={openAuth} />}
            {activeTab === 'codification' && <CodePublicTab branding={branding} initialSection={activeItemSlug} />}
            {activeTab === 'records' && <RecordsPublicTab features={publicFeatures.records || {}} />}
            {activeTab === 'complaints' && (
              <ComplaintsPublicTab
                me={me}
                onRequireAuth={openAuth}
                features={publicFeatures.complaints || {}}
                initialItemId={activeItemSlug}
                onItemChange={(id) => selectTab('complaints', id)}
              />
            )}
            {activeTab === 'calendar' && <CalendarPublicTab features={publicFeatures.calendar || {}} />}
            {activeTab === 'notices' && (
              <NoticesPublicTab
                features={publicFeatures.notices || {}}
                initialItemId={activeItemSlug}
                onItemChange={(id) => selectTab('notices', id)}
              />
            )}
            {activeTab === 'blog' && (
              <BlogPublicTab
                me={me}
                initialPostSlug={activeItemSlug}
                onSlugChange={(slug) => selectTab('blog', slug)}
              />
            )}
            {activeTab === 'directory' && <DirectoryPublicTab features={publicFeatures.directory || {}} />}
            {activeTab === 'forms' && (
              <FormsPublicTab
                initialItemId={activeItemSlug}
                onItemChange={(id) => selectTab('forms', id)}
              />
            )}
            {activeTab === 'pages' && (
              <PagesPublicTab
                initialItemId={activeItemSlug}
                onItemChange={(id) => selectTab('pages', id)}
              />
            )}
            {activeTab === 'pay' && <PayBillsPublicTab />}
            {activeTab === 'utilities' && <PayBillsPublicTab billType="utility" />}
            {activeTab === 'citations' && <PayBillsPublicTab billType="citation" />}
            {activeTab === 'transparency' && <TransparencyPublicTab />}
          </div>
        )}
      </main>

      <AuthModal
        open={authModal.open}
        initialRegister={authModal.register}
        initialResetToken={authModal.resetToken}
        nextUrl={authModal.nextUrl}
        reason={authModal.reason}
        demoMode={Boolean(branding.demo_mode)}
        onClose={() => setAuthModal((prev) => ({ ...prev, open: false, resetToken: '' }))}
      />
      {homeEditOpen && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 120,
            background: 'rgba(15, 23, 42, .45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1rem',
          }}
        >
          <div className="card" style={{ width: '100%', maxWidth: 680, maxHeight: '90vh', overflowY: 'auto', marginBottom: 0 }}>
            <div className="between" style={{ marginBottom: '.75rem' }}>
              <h2 style={{ margin: 0 }}>Edit Public Portal Custom Page Text</h2>
              <button type="button" className="btn sm" onClick={() => setHomeEditOpen(false)}>Close</button>
            </div>
            <form onSubmit={saveHomeText}>
              <div className="field" style={{ marginBottom: '.75rem' }}>
                <label htmlFor="home-edit-heading">Portal Welcome Heading (blank uses default)</label>
                <input
                  id="home-edit-heading"
                  placeholder={branding.city_title?.trim() ? `Welcome to ${branding.city_title.trim()}` : 'City Services & Community Hub'}
                  value={homeHeadingDraft}
                  onChange={(e) => setHomeHeadingDraft(e.target.value)}
                />
              </div>
              <div style={{ marginBottom: '.75rem' }}>
                <RichTextEditor
                  id="home-edit-intro"
                  label="Custom Page Text (supports headings, bold, lists, callouts, and links)"
                  rows={7}
                  placeholder="Add custom announcements, City Hall welcome text, office hours, or helpful links..."
                  value={homeIntroDraft}
                  onChange={setHomeIntroDraft}
                />
              </div>
              <div style={{ padding: '.75rem .9rem', background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: 8, marginBottom: '.75rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginBottom: homeBlogEnabledDraft ? '.65rem' : 0, cursor: 'pointer', fontWeight: 600 }}>
                  <input
                    type="checkbox"
                    style={{ width: 'auto' }}
                    checked={homeBlogEnabledDraft}
                    onChange={(e) => setHomeBlogEnabledDraft(e.target.checked)}
                  />
                  <span>Show recent blog entries on main page</span>
                </label>
                {homeBlogEnabledDraft && (
                  <div className="row">
                    <div className="field" style={{ width: 130 }}>
                      <label htmlFor="home-edit-blog-count">Entries (1–20)</label>
                      <input
                        id="home-edit-blog-count"
                        type="number"
                        min={1}
                        max={20}
                        value={homeBlogCountDraft}
                        onChange={(e) => setHomeBlogCountDraft(e.target.value)}
                      />
                    </div>
                    <div className="field" style={{ flex: 1, minWidth: 160 }}>
                      <label htmlFor="home-edit-blog-style">Display Style</label>
                      <select
                        id="home-edit-blog-style"
                        value={homeBlogStyleDraft}
                        onChange={(e) => setHomeBlogStyleDraft(e.target.value)}
                      >
                        <option value="cards">Summary Cards</option>
                        <option value="full">Full Blog Entries</option>
                      </select>
                    </div>
                    <div className="field" style={{ flex: 1, minWidth: 160 }}>
                      <label htmlFor="home-edit-blog-pos">Placement</label>
                      <select
                        id="home-edit-blog-pos"
                        value={homeBlogPositionDraft}
                        onChange={(e) => setHomeBlogPositionDraft(e.target.value)}
                      >
                        <option value="below_services">Below Services</option>
                        <option value="above_services">Above Services</option>
                      </select>
                    </div>
                    <div className="field" style={{ flex: 1, minWidth: 180 }}>
                      <label htmlFor="home-edit-blog-heading">Section Heading</label>
                      <input
                        id="home-edit-blog-heading"
                        placeholder="Latest from the Blog"
                        value={homeBlogHeadingDraft}
                        onChange={(e) => setHomeBlogHeadingDraft(e.target.value)}
                      />
                    </div>
                  </div>
                )}
              </div>
              {homeEditErr && <div className="error-msg" role="alert" style={{ marginBottom: '.65rem' }}>{homeEditErr}</div>}
              <div className="actions">
                <button type="submit" className="btn primary" disabled={homeEditBusy}>
                  {homeEditBusy ? 'Saving…' : 'Save'}
                </button>
                <button type="button" className="btn" onClick={() => setHomeEditOpen(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
      <PublicFooter branding={branding} />
    </div>
  );
}

createRoot(document.getElementById('home-root')).render(<PublicHomePage />);
