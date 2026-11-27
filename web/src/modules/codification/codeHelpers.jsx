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

export function slugifyAnchor(raw) {
  const clean = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return clean ? `sub-${clean}` : 'sub-item';
}

const MINOR_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'from', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);

function toReadableHeading(raw) {
  const clean = String(raw || '').replace(/[.:]+$/, '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  if (clean !== clean.toUpperCase()) return clean;
  const words = clean.split(' ');
  return words
    .map((w, idx) => {
      const lw = w.toLowerCase();
      if (idx > 0 && idx < words.length - 1 && MINOR_WORDS.has(lw)) return lw;
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(' ');
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

export function flattenTreeSections(sections, chapter, ancestors = []) {
  const out = [];
  for (const sec of sections || []) {
    const enriched = {
      ...sec,
      chapter_id: chapter.id,
      chapter_prefix: chapter.code_prefix,
      chapter_title: chapter.title,
      ancestors,
    };
    out.push(enriched);
    if (Array.isArray(sec.children) && sec.children.length > 0) {
      out.push(
        ...flattenTreeSections(sec.children, chapter, [
          ...ancestors,
          { id: sec.id, section_number: sec.section_number, title: sec.title, node_type: sec.node_type || 'section' },
        ]),
      );
    }
  }
  return out;
}

export function buildSectionMap(chapters) {
  const map = new Map();
  for (const ch of chapters || []) {
    for (const enriched of flattenTreeSections(ch.sections || [], ch, [])) {
      const key = String(enriched.section_number || '').trim().toLowerCase();
      if (key && !map.has(key)) {
        map.set(key, enriched);
      }
    }
  }
  return map;
}

const ARTICLE_BLOCK_RE = /^(ARTICLE|DIVISION|PART)\s+([IVXLCM0-9]+)\.?\s*(?:[-–—.]\s*)?(.*)$/i;
const SUBSECTION_PUNCT_RE = /^((?:Sec(?:tion)?\.?|§)\s*[0-9]+(?:[-.][0-9A-Za-z]+)*|\d{1,3}\.\d{1,3}\.\d{1,4}[A-Za-z]?|\d{1,4}[A-Za-z]?\.\d{2,4}[A-Za-z]?|\d{1,3}-\d{1,4}[A-Za-z]?)\.?\s+([A-Z][A-Za-z0-9\s,&/'()-]{1,90}?[.:])\s*(.*)$/;
const SUBSECTION_CAPS_RE = /^(\d{1,3}\.\d{1,3}\.\d{1,4}[A-Za-z]?|\d{1,4}[A-Za-z]?\.\d{2,4}[A-Za-z]?|\d{1,3}-\d{1,4}[A-Za-z]?)\.?\s+([A-Z][A-Z0-9\s,&/'()-]{2,80}?)(?:\s+(?=[A-Z][a-z])(.*)|$)$/;
const SUBD_HEAD_RE = /^(Subd(?:ivision)?\.?\s*\d+[A-Za-z]?)\.?\s+([A-Z][A-Za-z0-9\s,&/'()-]{1,80}?[.:])\s*(.*)$/i;
const HISTORY_BLOCK_RE = /^["'(]?(?:AMENDED|ADOPTED|ENACTED|REPEALED|ADDED|UPDATED)\s+BY\s+ORD|^\((?:Ord\.?|Code\s+\d{4}|Prior\s+Code|Res\.?|State\s+Law)/i;
const ORDAINING_BLOCK_RE = /^The\s+(?:City\s+)?Council\s+of\s+.+does\s+ordain/i;
const CLAUSE_L1_RE = /^(\([a-z]{1,2}\)|Subd\.?\s*\d+\.?|[A-Z]\.)\s+(.*)$/i;
const CLAUSE_L2_RE = /^(\(\d{1,3}\)|\d{1,3}\.)\s+(.*)$/;
const CLAUSE_L3_RE = /^(\([A-Z]{1,2}\)|\([ivxlcdm]{1,5}\)|[•●▪▫◦-])\s+(.*)$/;

function parseMarkdownTableBlock(block) {
  const lines = String(block || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return null;
  if (!lines[0].includes('|') || !/^\|?[\s:-]+\|[\s|:-]*$/.test(lines[1])) {
    return null;
  }
  const splitRow = (line) => {
    const trimmed = line.replace(/^\|/, '').replace(/\|$/, '');
    return trimmed.split('|').map((c) => c.trim());
  };
  const headers = splitRow(lines[0]);
  if (!headers.length) return null;
  const rows = lines.slice(2).map((l) => {
    const cells = splitRow(l);
    while (cells.length < headers.length) cells.push('');
    return cells.slice(0, headers.length);
  });
  return { type: 'table', headers, rows };
}

export function parseStructuredCodeBody(body) {
  const raw = String(body || '').trim();
  if (!raw) return [];
  const rawBlocks = raw.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const out = [];

  for (const block of rawBlocks) {
    const tbl = parseMarkdownTableBlock(block);
    if (tbl) {
      out.push(tbl);
      continue;
    }
    let m;
    if ((m = block.match(ARTICLE_BLOCK_RE))) {
      out.push({
        type: 'article',
        label: `${m[1].toUpperCase()} ${m[2].toUpperCase()}${m[3]?.trim() ? ` — ${toReadableHeading(m[3])}` : ''}`,
        raw: block,
      });
      continue;
    }

    if ((m = block.match(HISTORY_BLOCK_RE))) {
      out.push({ type: 'history', text: block });
      continue;
    }

    if (ORDAINING_BLOCK_RE.test(block)) {
      out.push({ type: 'ordaining', text: block });
      continue;
    }

    if ((m = block.match(SUBSECTION_PUNCT_RE)) || (m = block.match(SUBD_HEAD_RE)) || (m = block.match(SUBSECTION_CAPS_RE))) {
      const num = m[1].trim();
      const heading = m[2].trim();
      const rest = (m[3] || '').trim();
      out.push({
        type: 'subsection',
        id: slugifyAnchor(num),
        number: num,
        heading,
        readableHeading: toReadableHeading(heading),
        text: rest,
      });
      continue;
    }

    if ((m = block.match(CLAUSE_L3_RE))) {
      if (/^\([a-z]\)/.test(m[1]) && !/^\([ivx]+\)$/.test(m[1])) {
        out.push({ type: 'clause', level: 1, marker: m[1], text: m[2] });
      } else {
        out.push({ type: 'clause', level: 3, marker: m[1], text: m[2] });
      }
      continue;
    }

    if ((m = block.match(CLAUSE_L2_RE))) {
      out.push({ type: 'clause', level: 2, marker: m[1], text: m[2] });
      continue;
    }

    if ((m = block.match(CLAUSE_L1_RE))) {
      out.push({ type: 'clause', level: 1, marker: m[1], text: m[2] });
      continue;
    }

    out.push({ type: 'paragraph', text: block });
  }
  return out;
}

export function extractSubsectionsForToc(section) {
  const blocks = parseStructuredCodeBody(section?.body || '');
  return blocks
    .filter((b) => b.type === 'subsection')
    .map((b) => ({
      id: b.id,
      number: b.number,
      label: b.readableHeading || b.heading,
    }));
}

const CROSS_REF_RE = /((?:§+|Sections?|Secs?\.?|Chapters?|Ch\.?)\s*([0-9]+[A-Za-z]?(?:[-.][0-9A-Za-z]+)*))/gi;

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
    let target = sectionMap?.get(refNum);
    let anchorId = null;
    if (!target && refNum.includes('.')) {
      const baseNum = refNum.split('.')[0];
      target = sectionMap?.get(baseNum);
      if (target) anchorId = slugifyAnchor(refNum);
    }
    if (!target || (target.id === currentSectionId && !anchorId)) continue;
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
        onClick={() => onSelectSection?.(target, anchorId)}
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

export function StructuredCodeBody({
  text,
  sectionMap,
  currentSectionId,
  onSelectSection,
  query = '',
  onCopyAnchor,
}) {
  const blocks = parseStructuredCodeBody(text);
  if (!blocks.length) return null;
  return (
    <div className="code-lib-body">
      {blocks.map((blk, idx) => {
        if (blk.type === 'article') {
          return (
            <h4 key={idx} className="code-lib-article-heading">
              <HighlightText text={blk.label} query={query} />
            </h4>
          );
        }
        if (blk.type === 'history') {
          return (
            <p key={idx} className="code-lib-history">
              <HighlightText text={blk.text} query={query} />
            </p>
          );
        }
        if (blk.type === 'ordaining') {
          return (
            <p key={idx} className="code-lib-ordaining">
              <HighlightText text={blk.text} query={query} />
            </p>
          );
        }
        if (blk.type === 'subsection') {
          return (
            <div key={idx} id={blk.id} className="code-lib-subsection">
              <div className="code-lib-subsection-head">
                <strong className="code-lib-sub-num">
                  <HighlightText text={blk.number} query={query} />
                </strong>{' '}
                <strong className="code-lib-sub-title">
                  <HighlightText text={blk.heading} query={query} />
                </strong>
                {onCopyAnchor && (
                  <button
                    type="button"
                    className="code-lib-anchor-btn"
                    title={`Copy direct link to ${blk.number}`}
                    aria-label={`Copy link to subsection ${blk.number}`}
                    onClick={() => onCopyAnchor(blk.id)}
                  >
                    #
                  </button>
                )}
              </div>
              {blk.text && (
                <p className="code-lib-subsection-text">
                  <LinkedCodeBody
                    text={blk.text}
                    sectionMap={sectionMap}
                    currentSectionId={currentSectionId}
                    onSelectSection={onSelectSection}
                    query={query}
                  />
                </p>
              )}
            </div>
          );
        }
        if (blk.type === 'table') {
          return (
            <div
              key={idx}
              className="code-lib-table-wrap"
              style={{ overflowX: 'auto', margin: '0.65rem 0 0.9rem' }}
            >
              <table
                className="code-lib-table"
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: '0.88rem',
                  border: '1px solid #cbd5e1',
                  background: '#ffffff',
                }}
              >
                <thead>
                  <tr style={{ background: 'var(--cd-tint, #f1f5f9)' }}>
                    {blk.headers.map((h, hIdx) => (
                      <th
                        key={hIdx}
                        style={{
                          textAlign: 'left',
                          padding: '0.55rem 0.7rem',
                          border: '1px solid #cbd5e1',
                          fontWeight: 700,
                          color: '#0f172a',
                          verticalAlign: 'bottom',
                        }}
                      >
                        <HighlightText text={h} query={query} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {blk.rows.map((row, rIdx) => (
                    <tr
                      key={rIdx}
                      style={{ background: rIdx % 2 === 1 ? '#f8fafc' : '#ffffff' }}
                    >
                      {row.map((cell, cIdx) => (
                        <td
                          key={cIdx}
                          style={{
                            padding: '0.5rem 0.7rem',
                            border: '1px solid #cbd5e1',
                            verticalAlign: 'top',
                            color: '#1e293b',
                          }}
                        >
                          <LinkedCodeBody
                            text={cell}
                            sectionMap={sectionMap}
                            currentSectionId={currentSectionId}
                            onSelectSection={onSelectSection}
                            query={query}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        if (blk.type === 'clause') {
          return (
            <div key={idx} className={`code-lib-clause code-lib-clause-l${blk.level}`}>
              <span className="code-lib-clause-marker">{blk.marker}</span>
              <div className="code-lib-clause-body">
                <LinkedCodeBody
                  text={blk.text}
                  sectionMap={sectionMap}
                  currentSectionId={currentSectionId}
                  onSelectSection={onSelectSection}
                  query={query}
                />
              </div>
            </div>
          );
        }
        return (
          <p key={idx} className="code-lib-para">
            <LinkedCodeBody
              text={blk.text}
              sectionMap={sectionMap}
              currentSectionId={currentSectionId}
              onSelectSection={onSelectSection}
              query={query}
            />
          </p>
        );
      })}
    </div>
  );
}
