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

import React from 'react';

const SERVICE_STYLES = {
  agendas: { color: '#2563eb', bg: '#eff6ff', border: '#bfdbfe' },
  permits: { color: '#059669', bg: '#ecfdf5', border: '#a7f3d0' },
  codification: { color: '#7c3aed', bg: '#f5f3ff', border: '#ddd6fe' },
  records: { color: '#d97706', bg: '#fffbeb', border: '#fde68a' },
  complaints: { color: '#dc2626', bg: '#fef2f2', border: '#fecaca' },
  calendar: { color: '#0284c7', bg: '#f0f9ff', border: '#bae6fd' },
};

function renderGlyph(id, size) {
  const props = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': 'true',
  };

  switch (id) {
    case 'agendas':
      // Calendar with date lines
      return (
        <svg {...props}>
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4M8 2v4M3 10h18M8 14h8M8 18h5" />
        </svg>
      );
    case 'permits':
      // Clipboard with checkmark
      return (
        <svg {...props}>
          <rect x="8" y="2" width="8" height="4" rx="1" />
          <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
          <path d="m9 14 2 2 4-4" />
        </svg>
      );
    case 'codification':
      // Open municipal code book
      return (
        <svg {...props}>
          <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
          <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
        </svg>
      );
    case 'records':
      // File cabinet / archive box
      return (
        <svg {...props}>
          <rect x="2" y="4" width="20" height="5" rx="1" />
          <path d="M4 9v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9" />
          <path d="M10 13h4" />
        </svg>
      );
    case 'complaints':
      // Shield with alert exclamation
      return (
        <svg {...props}>
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          <path d="M12 8v4M12 16h.01" />
        </svg>
      );
    case 'calendar':
      // Calendar with clock/booking dot
      return (
        <svg {...props}>
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4M8 2v4M3 10h18" />
          <circle cx="12" cy="15" r="2" />
        </svg>
      );
    default:
      return null;
  }
}

export default function ServiceIcon({ id, size = 20, badge = false }) {
  const theme = SERVICE_STYLES[id];
  if (!theme) return null;
  const glyph = renderGlyph(id, size);
  if (!badge) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', color: theme.color, flexShrink: 0 }}>
        {glyph}
      </span>
    );
  }
  const box = size + 16;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: box,
        height: box,
        borderRadius: 10,
        background: theme.bg,
        border: `1px solid ${theme.border}`,
        color: theme.color,
        flexShrink: 0,
      }}
    >
      {glyph}
    </span>
  );
}
