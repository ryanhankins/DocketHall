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

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function HighlightText({ text, query }) {
  const str = String(text || '');
  const q = String(query || '').trim();
  if (!q || !str) return <>{str}</>;
  const re = new RegExp(`(${escapeRegex(q)})`, 'gi');
  const parts = str.split(re);
  if (parts.length === 1) return <>{str}</>;
  const ql = q.toLowerCase();
  return (
    <>
      {parts.map((part, idx) =>
        part.toLowerCase() === ql ? (
          <mark key={idx} style={{ background: '#fef08a', padding: '0 2px', borderRadius: 2 }}>
            {part}
          </mark>
        ) : (
          <React.Fragment key={idx}>{part}</React.Fragment>
        ),
      )}
    </>
  );
}

export function getSearchSnippet(section, query) {
  const q = String(query || '').trim();
  if (!q) return '';
  const ql = q.toLowerCase();
  const hay = section.body || section.summary || section.ordinance_ref || '';
  if (!hay) return '';
  const idx = hay.toLowerCase().indexOf(ql);
  if (idx === -1) return '';
  const start = Math.max(0, idx - 55);
  const end = Math.min(hay.length, idx + q.length + 85);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < hay.length ? '…' : '';
  return `${prefix}${hay.slice(start, end).replace(/\s+/g, ' ').trim()}${suffix}`;
}

export function buildSectionMap(chapters) {
  const map = new Map();
  for (const ch of chapters || []) {
    for (const sec of ch.sections || []) {
      const key = String(sec.section_number || '').trim().toLowerCase();
      if (key) {
        map.set(key, {
          ...sec,
          chapter_prefix: ch.code_prefix,
          chapter_title: ch.title,
        });
      }
    }
  }
  return map;
}

const CROSS_REF_RE = /((?:§+|Sections?|Secs?\.?)\s*([0-9]+(?:\.[0-9A-Za-z-]+)*))/gi;

export function LinkedCodeBody({ text, sectionMap, currentSectionId, onSelectSection, query }) {
  const str = String(text || '');
  if (!str) return null;
  const nodes = [];
  let lastIdx = 0;
  let match;
  CROSS_REF_RE.lastIndex = 0;
  while ((match = CROSS_REF_RE.exec(str)) !== null) {
    const fullMatch = match[1];
    const refNum = match[2].toLowerCase();
    const target = sectionMap?.get(refNum);
    if (!target || target.id === currentSectionId) continue;
    if (match.index > lastIdx) {
      nodes.push(
        <HighlightText key={`t-${lastIdx}`} text={str.slice(lastIdx, match.index)} query={query} />,
      );
    }
    nodes.push(
      <button
        key={`r-${match.index}`}
        type="button"
        className="link-btn"
        style={{ display: 'inline', padding: 0, font: 'inherit', fontWeight: 600 }}
        title={`Jump to Section ${target.section_number}: ${target.title}`}
        onClick={() => onSelectSection(target)}
      >
        <HighlightText text={fullMatch} query={query} />
      </button>,
    );
    lastIdx = match.index + fullMatch.length;
  }
  if (lastIdx < str.length) {
    nodes.push(<HighlightText key={`t-${lastIdx}`} text={str.slice(lastIdx)} query={query} />);
  }
  return <>{nodes}</>;
}
