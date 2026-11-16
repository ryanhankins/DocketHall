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

export default function GeneralPrefsPage({ onBrandingChange }) {
  const [cityTitle, setCityTitle] = useState('');
  const [hasLogo, setHasLogo] = useState(false);
  const [logoVer, setLogoVer] = useState(() => Date.now());
  const [dragOver, setDragOver] = useState(false);
  const [msg, setMsg] = useState({ text: '', isError: false });

  useEffect(() => {
    api('/api/branding')
      .then((b) => {
        setCityTitle(b.city_title || '');
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
        body: JSON.stringify({ city_title: cityTitle.trim() }),
      });
      setCityTitle(saved.city_title || '');
      setMsg({ text: 'General preferences saved.', isError: false });
      onBrandingChange?.({ cityTitle: saved.city_title || '', hasLogo, logoVer });
    } catch (err) {
      setMsg({ text: err.message, isError: true });
    }
  };

  return (
    <section id="section-preferences-general">
      <h1>General Preferences</h1>
      <div className="card">
        <p className="muted" style={{ marginTop: 0 }}>
          Site-wide branding shown at the top of each page and on the sign-in screen.
        </p>
        <form onSubmit={handleSave}>
          <div className="field" style={{ marginBottom: '.9rem' }}>
            <label htmlFor="pref-city-title">City Title (appears before CivicDesk at the top of each page)</label>
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
          <button type="submit" className="btn primary">Save General Preferences</button>
          {msg.text && (
            <div className={msg.isError ? 'error-msg' : 'ok-msg'} role="status">{msg.text}</div>
          )}
        </form>
      </div>
    </section>
  );
}
