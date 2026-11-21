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
import { PublicFooter, PublicHeader, UrgentAlertBanner } from './core/PublicChrome.jsx';
import { applyTheme } from './core/theme.js';
import CodeLibraryViewer from './modules/codification/CodeLibraryViewer.jsx';

function PublicCityCode() {
  const [branding, setBranding] = useState({ city_title: '', has_city_logo: false });

  useEffect(() => {
    fetch('/api/branding').then(r => (r.ok ? r.json() : null)).then(b => {
      if (b) {
        setBranding(b);
        applyTheme(b);
        document.title = b.city_title ? `${b.city_title} - City Code` : 'City Code - DocketHall';
      }
    }).catch(() => {});
  }, []);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#f5f7fa' }}>
      <UrgentAlertBanner branding={branding} />
      <PublicHeader branding={branding} subtitle="City Code" logoHeight={56}>
        <a className="btn sm" href="/portal">Permits Portal</a>
        <a className="btn sm primary" href="/">Sign In</a>
      </PublicHeader>

      <main style={{ margin: '0 auto', width: '100%', maxWidth: '1440px', padding: '1rem 1.25rem', boxSizing: 'border-box' }}>
        <CodeLibraryViewer branding={branding} standalone />
      </main>
      <PublicFooter branding={branding} />
    </div>
  );
}

createRoot(document.getElementById('code-root')).render(
  <React.StrictMode>
    <PublicCityCode />
  </React.StrictMode>,
);
