import React from 'react';

function renderTextWithLinks(text, keyPrefix, allowStaffLinks = false) {
  const linkRe = /((?:City\s+)?Code\s+§+\s*\d+(?:\.\d+)+(?:\([^)]+\))*|Sections?\s+\d+(?:\.\d+)+(?:\([^)]+\))*|§+\s*\d+(?:\.\d+)+(?:\([^)]+\))*|\b\d{3}\.\d{2,3}(?:\.\d+)?(?:\([^)]+\))*|\bPRM-\d{4}-\d{3,4}\b|\bCMP-\d{4}-\d{3,4}\b)/gi;
  const out = [];
  let last = 0;
  let m;
  let k = 0;
  while ((m = linkRe.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const raw = m[0];
    if (allowStaffLinks && /^PRM-/i.test(raw)) {
      out.push(
        <a
          key={`${keyPrefix}-p-${k++}`}
          href="#/app/permits-review"
          style={{ color: '#2563eb', textDecoration: 'underline', fontWeight: 600 }}
          title="Open Permit Review Queue"
        >
          {raw}
        </a>
      );
    } else if (allowStaffLinks && /^CMP-/i.test(raw)) {
      out.push(
        <a
          key={`${keyPrefix}-cmp-${k++}`}
          href="#/app/complaints-manage"
          style={{ color: '#2563eb', textDecoration: 'underline', fontWeight: 600 }}
          title="Open Complaints Management"
        >
          {raw}
        </a>
      );
    } else if (/^PRM-|^CMP-/i.test(raw)) {
      out.push(raw);
    } else {
      const secMatch = raw.match(/\d+(?:\.\d+)+/);
      const sec = secMatch ? secMatch[0] : '';
      out.push(
        <a
          key={`${keyPrefix}-c-${k++}`}
          href={`/code?sec=${encodeURIComponent(sec)}`}
          target="_blank"
          rel="noreferrer"
          style={{ color: '#2563eb', textDecoration: 'underline', fontWeight: 600 }}
          title={`Open City Code § ${sec}`}
        >
          {raw}
        </a>
      );
    }
    last = m.index + raw.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function normalizeSafeHref(rawHref) {
  const href = String(rawHref || '').trim();
  if (!href) return null;
  if (/^(https?:\/\/|\/|#)/i.test(href)) return href;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return null;
  return `/${href.replace(/^\.\//, '')}`;
}

function renderInlineMarkdown(text, allowStaffLinks = false, depth = 0) {
  const parts = [];
  const tokenRe = /(\*\*[^*]+\*\*|\[[^\]]+\]\([^)\s]+\)|`[^`]+`|\*[^*\n]+\*)/g;
  let last = 0;
  let match;
  let idx = 0;
  while ((match = tokenRe.exec(text)) !== null) {
    if (match.index > last) {
      parts.push(...renderTextWithLinks(text.slice(last, match.index), `t-${depth}-${idx++}`, allowStaffLinks));
    }
    const tok = match[0];
    if (tok.startsWith('**') && tok.endsWith('**')) {
      const inner = tok.slice(2, -2);
      parts.push(
        <strong key={`${depth}-${idx++}`}>
          {depth < 2 ? renderInlineMarkdown(inner, allowStaffLinks, depth + 1) : renderTextWithLinks(inner, `b-${depth}-${idx}`, allowStaffLinks)}
        </strong>
      );
    } else if (tok.startsWith('[') && tok.includes('](') && tok.endsWith(')')) {
      const splitIdx = tok.indexOf('](');
      const label = tok.slice(1, splitIdx);
      const safeHref = normalizeSafeHref(tok.slice(splitIdx + 2, -1));
      if (safeHref) {
        const isExt = safeHref.startsWith('http');
        parts.push(
          <a
            key={`${depth}-${idx++}`}
            href={safeHref}
            target={isExt || safeHref.startsWith('/code') ? '_blank' : undefined}
            rel={isExt || safeHref.startsWith('/code') ? 'noreferrer' : undefined}
            style={{ color: '#2563eb', textDecoration: 'underline' }}
          >
            {label}
          </a>
        );
      } else {
        parts.push(label);
      }
    } else if (tok.startsWith('`') && tok.endsWith('`')) {
      parts.push(
        <code
          key={`${depth}-${idx++}`}
          style={{
            background: '#f1f5f9',
            padding: '0.05rem 0.28rem',
            borderRadius: '4px',
            fontSize: '0.8em',
          }}
        >
          {tok.slice(1, -1)}
        </code>
      );
    } else if (tok.startsWith('*') && tok.endsWith('*')) {
      const inner = tok.slice(1, -1);
      parts.push(
        <em key={`${depth}-${idx++}`}>
          {depth < 2 ? renderInlineMarkdown(inner, allowStaffLinks, depth + 1) : renderTextWithLinks(inner, `i-${depth}-${idx}`, allowStaffLinks)}
        </em>
      );
    }
    last = match.index + tok.length;
  }
  if (last < text.length) {
    parts.push(...renderTextWithLinks(text.slice(last), `e-${depth}-${idx++}`, allowStaffLinks));
  }
  return parts;
}

export function MarkdownMessage({ text, allowStaffLinks = false }) {
  const lines = String(text || '').split(/\r?\n/);
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      blocks.push(
        <div key={blocks.length} style={{ fontWeight: 700, margin: '0.35rem 0 0.15rem' }}>
          {renderInlineMarkdown(headingMatch[2], allowStaffLinks)}
        </div>
      );
      i++;
      continue;
    }
    if (
      line.includes('|') &&
      i + 1 < lines.length &&
      /^\|?[\s:-]+\|[\s|:-]*$/.test(lines[i + 1].trim())
    ) {
      const splitRow = (rawLine) => {
        const trimmed = rawLine.trim().replace(/^\|/, '').replace(/\|$/, '');
        return trimmed.split('|').map((c) => c.trim());
      };
      const headers = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
        const cells = splitRow(lines[i]);
        while (cells.length < headers.length) cells.push('');
        rows.push(cells.slice(0, headers.length));
        i++;
      }
      blocks.push(
        <div key={blocks.length} style={{ overflowX: 'auto', margin: '0.35rem 0 0.5rem' }}>
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: '0.8em',
              border: '1px solid #cbd5e1',
              background: '#ffffff',
            }}
          >
            <thead>
              <tr style={{ background: '#f1f5f9' }}>
                {headers.map((h, hIdx) => (
                  <th
                    key={hIdx}
                    style={{
                      textAlign: 'left',
                      padding: '0.35rem 0.45rem',
                      border: '1px solid #cbd5e1',
                      fontWeight: 700,
                      color: '#0f172a',
                      verticalAlign: 'bottom',
                    }}
                  >
                    {renderInlineMarkdown(h, allowStaffLinks)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rIdx) => (
                <tr key={rIdx} style={{ background: rIdx % 2 === 1 ? '#f8fafc' : '#ffffff' }}>
                  {row.map((cell, cIdx) => (
                    <td
                      key={cIdx}
                      style={{
                        padding: '0.35rem 0.45rem',
                        border: '1px solid #cbd5e1',
                        verticalAlign: 'top',
                        color: '#1e293b',
                      }}
                    >
                      {renderInlineMarkdown(cell, allowStaffLinks)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }
    if (/^\s*[-*•]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*•]\s+/, ''));
        i++;
      }
      blocks.push(
        <ul key={blocks.length} style={{ margin: '0.25rem 0', paddingLeft: '1.15rem' }}>
          {items.map((it, k) => (
            <li key={k} style={{ marginBottom: '0.15rem' }}>{renderInlineMarkdown(it, allowStaffLinks)}</li>
          ))}
        </ul>
      );
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
        i++;
      }
      blocks.push(
        <ol key={blocks.length} style={{ margin: '0.25rem 0', paddingLeft: '1.25rem' }}>
          {items.map((it, k) => (
            <li key={k} style={{ marginBottom: '0.15rem' }}>{renderInlineMarkdown(it, allowStaffLinks)}</li>
          ))}
        </ol>
      );
      continue;
    }
    const paraLines = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,3})\s+/.test(lines[i]) &&
      !/^\s*[-*•]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !(lines[i].includes('|') && i + 1 < lines.length && /^\|?[\s:-]+\|[\s|:-]*$/.test(lines[i + 1].trim()))
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={blocks.length} style={{ margin: '0 0 0.35rem' }}>
        {paraLines.map((pl, k) => (
          <React.Fragment key={k}>
            {k > 0 && <br />}
            {renderInlineMarkdown(pl, allowStaffLinks)}
          </React.Fragment>
        ))}
      </p>
    );
  }
  return <div style={{ lineHeight: 1.45 }}>{blocks}</div>;
}

export default MarkdownMessage;
