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

export const DEFAULT_THEME = {
  theme_primary: '#2563eb',
  theme_secondary: '#1d4ed8',
  theme_tint: '#e6f0ff',
  theme_bg: '#f3f5f8',
  theme_surface: '#ffffff',
  theme_header_bg: '#ffffff',
};

export const THEME_PRESETS = [
  {
    id: 'default',
    label: 'DocketHall Blue (Default)',
    colors: { ...DEFAULT_THEME },
  },
  {
    id: 'birchwood',
    label: 'Birchwood Forest',
    colors: {
      theme_primary: '#2d4a2d',
      theme_secondary: '#4a7c59',
      theme_tint: '#e8f0e8',
      theme_bg: '#f4f7f4',
      theme_surface: '#ffffff',
      theme_header_bg: '#ffffff',
    },
  },
];

function isDarkHex(hex) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec((hex || '').trim());
  if (!m) return false;
  const r = parseInt(m[1], 16) / 255;
  const g = parseInt(m[2], 16) / 255;
  const b = parseInt(m[3], 16) / 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum < 0.45;
}

function relativeLuminance(hex) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec((hex || '').trim());
  if (!m) return null;
  const toLin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * toLin(parseInt(m[1], 16))
    + 0.7152 * toLin(parseInt(m[2], 16))
    + 0.0722 * toLin(parseInt(m[3], 16));
}

export function contrastRatio(hexA, hexB) {
  const l1 = relativeLuminance(hexA);
  const l2 = relativeLuminance(hexB);
  if (l1 === null || l2 === null) return null;
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

export function getThemeContrastWarnings(theme = {}) {
  const primary = theme.theme_primary || DEFAULT_THEME.theme_primary;
  const secondary = theme.theme_secondary || DEFAULT_THEME.theme_secondary;
  const tint = theme.theme_tint || DEFAULT_THEME.theme_tint;
  const bg = theme.theme_bg || DEFAULT_THEME.theme_bg;
  const surface = theme.theme_surface || DEFAULT_THEME.theme_surface;
  const headerBg = theme.theme_header_bg || DEFAULT_THEME.theme_header_bg;

  const checks = [
    { a: primary, b: '#ffffff', min: 4.5, desc: `Primary Accent (${primary}) with white button text` },
    { a: primary, b: surface, min: 4.5, desc: `Primary Accent (${primary}) links on Card Surface (${surface})` },
    { a: primary, b: tint, min: 4.5, desc: `Primary Accent (${primary}) text on Soft Highlight (${tint})` },
    { a: secondary, b: surface, min: 3.0, desc: `Secondary Accent (${secondary}) focus/border on Card Surface (${surface})` },
    { a: '#1f2933', b: surface, min: 4.5, desc: `Body text (#1f2933) on Card Surface (${surface})` },
    { a: '#616e7c', b: surface, min: 4.5, desc: `Muted text (#616e7c) on Card Surface (${surface})` },
    { a: '#1f2933', b: bg, min: 4.5, desc: `Body text (#1f2933) on Page Background (${bg})` },
    {
      a: isDarkHex(headerBg) ? '#ffffff' : '#18181c',
      b: headerBg,
      min: 4.5,
      desc: `Header text on Header Background (${headerBg})`,
    },
  ];

  const warnings = [];
  for (const c of checks) {
    const ratio = contrastRatio(c.a, c.b);
    if (ratio !== null && ratio < c.min) {
      warnings.push(`${c.desc}: ${ratio.toFixed(2)}:1 (WCAG 2.1 AA requires >= ${c.min}:1)`);
    }
  }
  return warnings;
}

export function applyTheme(theme = {}) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement.style;
  const primary = theme.theme_primary || DEFAULT_THEME.theme_primary;
  const secondary = theme.theme_secondary || DEFAULT_THEME.theme_secondary;
  const tint = theme.theme_tint || DEFAULT_THEME.theme_tint;
  const bg = theme.theme_bg || DEFAULT_THEME.theme_bg;
  const surface = theme.theme_surface || DEFAULT_THEME.theme_surface;
  const headerBg = theme.theme_header_bg || DEFAULT_THEME.theme_header_bg;
  const darkHeader = isDarkHex(headerBg);

  root.setProperty('--cd-primary', primary);
  root.setProperty('--cd-secondary', secondary);
  root.setProperty('--cd-tint', tint);
  root.setProperty('--cd-bg', bg);
  root.setProperty('--cd-surface', surface);
  root.setProperty('--cd-header-bg', headerBg);
  root.setProperty('--cd-header-text', darkHeader ? '#ffffff' : '#18181c');
  root.setProperty('--cd-header-muted', darkHeader ? 'rgba(255, 255, 255, 0.85)' : '#52606d');
  root.setProperty('--cd-border', `color-mix(in srgb, ${secondary} 28%, #d9e2ec)`);
}
