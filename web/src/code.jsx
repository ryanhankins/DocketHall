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
import { createRoot } from 'react-dom/client';
import '../app.css';
import ServiceIcon from './core/ServiceIcon.jsx';

function PublicCityCode() {
  const [branding, setBranding] = useState({ city_title: '', has_city_logo: false });
  const [chapters, setChapters] = useState([]);
  const [search, setSearch] = useState('');
  const [selectedSec, setSelectedSec] = useState(null);

  useEffect(() => {
    fetch('/api/branding').then(r => (r.ok ? r.json() : null)).then(b => {
      if (b) {
        setBranding(b);
        document.title = b.city_title ? `${b.city_title} - City Code` : 'City Code - CivicDesk';
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    fetch(`/api/codification/public?q=${encodeURIComponent(search)}`)
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (data?.chapters) setChapters(data.chapters);
      })
      .catch(() => {});
  }, [search]);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#f5f7fa' }}>
      <header>
        <a
          href="/"
          className="brand"
          style={{ display: 'flex', alignItems: 'center', gap: '.55rem', textDecoration: 'none', color: 'inherit' }}
          title="Go to main page"
        >
          {branding.has_city_logo && (
            <img src="/api/branding/logo" alt="City Logo" style={{ height: '56px', width: 'auto', borderRadius: '4px', objectFit: 'contain' }} />
          )}
          {branding.city_title && <span>{branding.city_title}</span>}
          <span>City Code</span>
        </a>
        <div className="user-bar">
          <a className="btn sm" href="/portal">Permits Portal</a>
          <a className="btn sm primary" href="/">Sign In</a>
        </div>
      </header>

      <main style={{ margin: '0 auto', width: '100%', maxWidth: '1040px' }}>
        {selectedSec ? (
          <div className="card">
            <div className="between" style={{ marginBottom: '.85rem' }}>
              <button type="button" className="btn sm" onClick={() => setSelectedSec(null)}>&larr; Back to City Code</button>
              <a className="btn sm primary" href={`/api/codification/sections/${selectedSec.id}/pdf`} target="_blank" rel="noreferrer">
                Open Official PDF
              </a>
            </div>
            <h1 style={{ marginTop: 0 }}>Section {selectedSec.section_number} — {selectedSec.title}</h1>
            {(selectedSec.ordinance_ref || selectedSec.effective_date) && (
              <p className="muted">
                {selectedSec.ordinance_ref && `Ordinance: ${selectedSec.ordinance_ref}`}
                {selectedSec.ordinance_ref && selectedSec.effective_date && ' · '}
                {selectedSec.effective_date && `Effective: ${selectedSec.effective_date}`}
              </p>
            )}
            {selectedSec.summary && <p><strong>Summary:</strong> {selectedSec.summary}</p>}
            {selectedSec.body ? (
              <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6, marginTop: '1rem' }}>{selectedSec.body}</div>
            ) : (
              <p className="muted">
                Full text is available in the{' '}
                <a href={`/api/codification/sections/${selectedSec.id}/pdf`} target="_blank" rel="noreferrer">
                  Official Section PDF
                </a>.
              </p>
            )}
          </div>
        ) : (
          <>
            <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', marginBottom: '.75rem' }}>
                <ServiceIcon id="codification" size={22} badge />
                <h1 style={{ margin: 0 }}>Municipal Code</h1>
              </div>
              <div className="field">
                <label htmlFor="public-code-search">Search Chapters &amp; Sections</label>
                <input
                  id="public-code-search"
                  type="search"
                  placeholder="Search by section number, title, keyword, or ordinance..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>

            {chapters.map(c => (
              <details key={c.id} className="card" open={!!search.trim()}>
                <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: '.6rem' }}>
                  <span className="badge active">{c.code_prefix}</span>
                  <span>{c.title}</span>
                  <span className="muted" style={{ fontWeight: 400, fontSize: '.88rem' }}>({(c.sections || []).length} sections)</span>
                </summary>
                <ul style={{ listStyle: 'none', padding: '.75rem 0 0', margin: 0, display: 'flex', flexDirection: 'column', gap: '.45rem' }}>
                  {(c.sections || []).map(s => (
                    <li key={s.id} className="between" style={{ padding: '.35rem .5rem', borderBottom: '1px solid #f1f5f9' }}>
                      <button type="button" className="link-btn" onClick={() => setSelectedSec(s)}>
                        Section {s.section_number} — {s.title}
                      </button>
                      <a className="btn sm" href={`/api/codification/sections/${s.id}/pdf`} target="_blank" rel="noreferrer">PDF</a>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </>
        )}
      </main>
    </div>
  );
}

createRoot(document.getElementById('code-root')).render(
  <React.StrictMode>
    <PublicCityCode />
  </React.StrictMode>,
);
