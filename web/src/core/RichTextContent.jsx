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

function isSafeLinkUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return false;
  return /^(https?:\/\/|mailto:|\/|#)/i.test(s);
}

function isSafeImageUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return false;
  return /^(https?:\/\/|\/)/i.test(s);
}

function renderInline(text, keyPrefix = 'in') {
  const src = String(text || '');
  const nodes = [];
  const tokenRe = /!\[([^\]]*)\]\(([^)\s]+)\)|\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|`([^`\n]+)`/g;
  let lastIdx = 0;
  let match;
  let idx = 0;

  while ((match = tokenRe.exec(src)) !== null) {
    if (match.index > lastIdx) {
      nodes.push(src.slice(lastIdx, match.index));
    }
    const key = `${keyPrefix}-${idx++}`;
    if (match[1] !== undefined || match[2] !== undefined) {
      const alt = match[1] || '';
      const imgUrl = match[2] || '';
      if (isSafeImageUrl(imgUrl)) {
        nodes.push(
          <img
            key={key}
            src={imgUrl}
            alt={alt || 'Embedded article image'}
            style={{ maxWidth: '100%', borderRadius: 6, margin: '.35rem 0', display: 'block' }}
          />
        );
      } else {
        nodes.push(match[0]);
      }
    } else if (match[3] !== undefined && match[4] !== undefined) {
      const label = match[3];
      const href = match[4];
      if (isSafeLinkUrl(href)) {
        const isExternal = /^https?:\/\//i.test(href);
        nodes.push(
          <a
            key={key}
            href={href}
            target={isExternal ? '_blank' : undefined}
            rel={isExternal ? 'noreferrer' : undefined}
          >
            {label}
          </a>
        );
      } else {
        nodes.push(label);
      }
    } else if (match[5] !== undefined) {
      nodes.push(<strong key={key}>{match[5]}</strong>);
    } else if (match[6] !== undefined) {
      nodes.push(<em key={key}>{match[6]}</em>);
    } else if (match[7] !== undefined) {
      nodes.push(<code key={key}>{match[7]}</code>);
    }
    lastIdx = tokenRe.lastIndex;
  }

  if (lastIdx < src.length) {
    nodes.push(src.slice(lastIdx));
  }
  return nodes;
}

function renderLinesWithBreaks(lines, keyPrefix) {
  const out = [];
  lines.forEach((line, idx) => {
    if (idx > 0) out.push(<br key={`${keyPrefix}-br-${idx}`} />);
    out.push(...renderInline(line, `${keyPrefix}-l-${idx}`));
  });
  return out;
}

export default function RichTextContent({ text, className = '', style = {} }) {
  const raw = String(text || '').replace(/\r\n/g, '\n');
  if (!raw.trim()) return null;

  const lines = raw.split('\n');
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    if (/^([-*_])\1{2,}$/.test(trimmed)) {
      blocks.push(<hr key={`hr-${i}`} />);
      i += 1;
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const content = renderInline(headingMatch[2], `hd-${i}`);
      if (level === 1) blocks.push(<h2 key={`h-${i}`}>{content}</h2>);
      else if (level === 2) blocks.push(<h3 key={`h-${i}`}>{content}</h3>);
      else blocks.push(<h4 key={`h-${i}`}>{content}</h4>);
      i += 1;
      continue;
    }

    if (trimmed.startsWith('>')) {
      const quoteLines = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
        i += 1;
      }
      blocks.push(
        <blockquote key={`bq-${i}`}>
          {renderLinesWithBreaks(quoteLines, `bq-${i}`)}
        </blockquote>
      );
      continue;
    }

    if (/^[-*•]\s+/.test(trimmed)) {
      const items = [];
      while (i < lines.length && /^[-*•]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*•]\s+/, ''));
        i += 1;
      }
      blocks.push(
        <ul key={`ul-${i}`}>
          {items.map((item, idx) => (
            <li key={`uli-${i}-${idx}`}>{renderInline(item, `uli-${i}-${idx}`)}</li>
          ))}
        </ul>
      );
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ''));
        i += 1;
      }
      blocks.push(
        <ol key={`ol-${i}`}>
          {items.map((item, idx) => (
            <li key={`oli-${i}-${idx}`}>{renderInline(item, `oli-${i}-${idx}`)}</li>
          ))}
        </ol>
      );
      continue;
    }

    const paraLines = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^#{1,3}\s+/.test(lines[i].trim()) &&
      !/^[-*•]\s+/.test(lines[i].trim()) &&
      !/^\d+\.\s+/.test(lines[i].trim()) &&
      !lines[i].trim().startsWith('>') &&
      !/^([-*_])\1{2,}$/.test(lines[i].trim())
    ) {
      paraLines.push(lines[i]);
      i += 1;
    }
    blocks.push(
      <p key={`p-${i}`}>
        {renderLinesWithBreaks(paraLines, `p-${i}`)}
      </p>
    );
  }

  return (
    <div className={`rich-content${className ? ` ${className}` : ''}`} style={style}>
      {blocks}
    </div>
  );
}
