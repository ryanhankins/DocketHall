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

import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../app.css';
import ServiceIcon from './core/ServiceIcon.jsx';
import { PublicFooter, PublicHeader, UrgentAlertBanner } from './core/PublicChrome.jsx';
import { applyTheme } from './core/theme.js';

function PublicPermitsPortal() {
  const [branding, setBranding] = useState({ city_title: '', has_city_logo: false });
  const [catalog, setCatalog] = useState({ settings: {}, types: [], uses: [] });
  const [me, setMe] = useState(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [rowsPerPage, setRowsPerPage] = useState(50);
  const [page, setPage] = useState(1);

  useEffect(() => {
    fetch('/api/branding').then(r => (r.ok ? r.json() : null)).then(b => {
      if (b) {
        setBranding(b);
        applyTheme(b);
        document.title = b.city_title ? `${b.city_title} - Permits Portal` : 'Permits Portal - DocketHall';
      }
    }).catch(() => {});
    fetch('/api/permits/public/catalog').then(r => (r.ok ? r.json() : null)).then(c => {
      if (c) setCatalog(c);
    }).catch(() => {});
    fetch('/api/me', { credentials: 'same-origin' }).then(r => (r.ok ? r.json() : null)).then(u => {
      if (u) setMe(u);
    }).catch(() => {});
  }, []);

  const rows = useMemo(() => {
    const typeMap = new Map((catalog.types || []).map(t => [t.id, t]));
    const q = search.trim().toLowerCase();
    return (catalog.uses || [])
      .map(u => ({ ...u, typeName: typeMap.get(u.permit_type_id)?.name || '' }))
      .filter(r => {
        if (typeFilter && String(r.permit_type_id) !== typeFilter) return false;
        if (q && !r.typeName.toLowerCase().includes(q) && !r.name.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => a.typeName.localeCompare(b.typeName) || a.name.localeCompare(b.name));
  }, [catalog, search, typeFilter]);

  const totalPages = Math.max(1, Math.ceil(rows.length / rowsPerPage));
  const safePage = Math.min(page, totalPages);
  const pagedRows = rows.slice((safePage - 1) * rowsPerPage, safePage * rowsPerPage);

  const s = catalog.settings || {};

  const applyHref = (typeId, useId) => {
    const target = `/app/permits-apply?type=${typeId}&use=${useId}`;
    return me ? target : `/?register=1&next=${encodeURIComponent(target)}`;
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#f5f7fa' }}>
      <a className="skip-link" href="#portal-main">Skip To Main Content</a>
      <UrgentAlertBanner branding={branding} />
      <PublicHeader branding={branding} subtitle="Permits Portal" logoHeight={56}>
        {me ? (
          <>
            <span>Signed in as <strong>{me.username}</strong></span>
            <a className="btn sm primary" href="/app/my-permits">My Permits</a>
          </>
        ) : (
          <>
            <a className="btn sm" href="/">Sign In</a>
            <a className="btn sm primary" href="/?register=1">Register</a>
          </>
        )}
      </PublicHeader>

      <main id="portal-main" style={{ margin: '0 auto', width: '100%', maxWidth: '1040px' }}>
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', marginBottom: '.75rem' }}>
            <ServiceIcon id="permits" size={22} badge />
            <h1 style={{ margin: 0 }}>Permits — General Instructions</h1>
          </div>
          {s.general_instructions && <p style={{ lineHeight: 1.5 }}>{s.general_instructions}</p>}

          {s.required_documents_note && (
            <>
              <h2>Required Documents with Permit</h2>
              <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: '0 0 1rem', lineHeight: 1.5 }}>
                {s.required_documents_note}
              </pre>
            </>
          )}

          {(s.fee_schedule_url || s.payment_instructions || s.payment_url) && (
            <div className="row" style={{ gap: '1rem', alignItems: 'flex-start' }}>
              <div style={{ flex: 2, minWidth: '240px' }}>
                <h2>Permit Payment &amp; Fee Schedule</h2>
                {s.payment_instructions && (
                  <p className="muted" style={{ marginTop: 0 }}>{s.payment_instructions}</p>
                )}
                <div className="actions">
                  {s.payment_url && (
                    <a className="btn sm primary" href={s.payment_url} target="_blank" rel="noreferrer">Online Payment</a>
                  )}
                  {s.fee_schedule_url && (
                    <a className="btn sm" href={s.fee_schedule_url} target="_blank" rel="noreferrer">
                      {s.fee_schedule_label || 'Fee Schedule'}
                    </a>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="card">
          <h2>Search Permits and Apply Online</h2>
          <div className="row" style={{ marginBottom: '1rem', alignItems: 'flex-end' }}>
            <div className="field" style={{ flex: 2, minWidth: '220px' }}>
              <label htmlFor="portal-search">Search Permit Type or Use</label>
              <input
                id="portal-search"
                type="search"
                placeholder="Enter search terms here..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              />
            </div>
            <div className="field" style={{ flex: 1, minWidth: '190px' }}>
              <label htmlFor="portal-type-filter">Filter By: Permit Type</label>
              <select id="portal-type-filter" value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}>
                <option value="">All Permit Types</option>
                {(catalog.types || []).map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="portal-rows">Rows Per Page</label>
              <select id="portal-rows" value={rowsPerPage} onChange={(e) => { setRowsPerPage(Number(e.target.value)); setPage(1); }}>
                {[25, 50, 100, 200].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          </div>

          <table>
            <thead>
              <tr><th>Permit Type</th><th>Permit Application / Use</th><th>Requirements</th><th>Apply Online</th></tr>
            </thead>
            <tbody>
              {!pagedRows.length ? (
                <tr><td colSpan={4} className="muted">No matching permits found.</td></tr>
              ) : pagedRows.map(r => (
                <tr key={r.id}>
                  <td><strong>{r.typeName}</strong></td>
                  <td>{r.name}</td>
                  <td className="muted" style={{ fontSize: '.84rem' }}>
                    {[r.requires_coi && 'COI', r.requires_plans && 'Plans', r.requires_survey && 'Survey'].filter(Boolean).join(', ') || 'Application form'}
                  </td>
                  <td>
                    <a className="btn sm primary" href={applyHref(r.permit_type_id, r.id)}>
                      Apply Online
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {totalPages > 1 && (
            <div className="actions" style={{ justifyContent: 'center', marginTop: '1rem' }}>
              <button type="button" className="btn sm" disabled={safePage <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>&laquo; Prev</button>
              <span className="muted" style={{ fontSize: '.88rem' }}>Page {safePage} of {totalPages}</span>
              <button type="button" className="btn sm" disabled={safePage >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>Next &raquo;</button>
            </div>
          )}
        </div>

        <PermitLookupCard />
      </main>
      <PublicFooter branding={branding} />
    </div>
  );
}

function PermitLookupCard() {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);

  const searchPermits = async (e) => {
    e.preventDefault();
    if (q.trim().length < 2) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/permits/public/lookup?q=${encodeURIComponent(q.trim())}`);
      const d = await r.json().catch(() => []);
      setRows(Array.isArray(d) ? d : []);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Check Permit Status</h2>
      <p className="muted" style={{ marginTop: 0, fontSize: '.88rem' }}>
        Look up public permit status by Permit # (e.g. <code>PRM-2026-0001</code>) or street address.
      </p>
      <form onSubmit={searchPermits} className="row" style={{ alignItems: 'flex-end', marginBottom: '.75rem' }}>
        <div className="field" style={{ flex: 2, minWidth: 220 }}>
          <label htmlFor="permit-lookup-q">Permit # or Property Address</label>
          <input
            id="permit-lookup-q"
            placeholder="e.g. PRM-2026- or 123 Lake Ave"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <button type="submit" className="btn primary" disabled={busy || q.trim().length < 2}>
          {busy ? 'Searching…' : 'Check Status'}
        </button>
      </form>
      {Array.isArray(rows) && (
        rows.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>No matching permits found.</p>
        ) : (
          <table>
            <thead>
              <tr><th>Permit #</th><th>Type / Use</th><th>Property Address</th><th>Status</th></tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.permit_number}>
                  <td><strong>{p.permit_number}</strong></td>
                  <td>{p.permit_type_name} — {p.permit_use_name}</td>
                  <td>{p.property_address || '—'}</td>
                  <td><span className="badge draft">{String(p.status || '').replace('_', ' ')}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}
    </div>
  );
}

createRoot(document.getElementById('portal-root')).render(
  <React.StrictMode>
    <PublicPermitsPortal />
  </React.StrictMode>,
);
