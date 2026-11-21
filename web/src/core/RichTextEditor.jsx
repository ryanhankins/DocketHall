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

import React, { useRef, useState } from 'react';
import { getLinkTextWarnings } from './a11y.js';
import RichTextContent from './RichTextContent.jsx';

export default function RichTextEditor({
  id,
  label,
  value,
  onChange,
  rows = 8,
  placeholder = '',
  helpText = '',
  required = false,
}) {
  const [mode, setMode] = useState('write');
  const taRef = useRef(null);
  const current = String(value || '');

  const applyEdit = (buildNext) => {
    const el = taRef.current;
    const start = el ? el.selectionStart : current.length;
    const end = el ? el.selectionEnd : current.length;
    const selected = current.slice(start, end);
    const { text, selStart, selEnd } = buildNext(current, start, end, selected);
    onChange(text);
    requestAnimationFrame(() => {
      if (!taRef.current) return;
      taRef.current.focus();
      if (typeof selStart === 'number' && typeof selEnd === 'number') {
        taRef.current.setSelectionRange(selStart, selEnd);
      }
    });
  };

  const wrapSelection = (before, after, fallback = 'text') => {
    applyEdit((src, start, end, selected) => {
      const inner = selected || fallback;
      const inserted = `${before}${inner}${after}`;
      const next = `${src.slice(0, start)}${inserted}${src.slice(end)}`;
      return {
        text: next,
        selStart: start + before.length,
        selEnd: start + before.length + inner.length,
      };
    });
  };

  const prefixLine = (prefix, fallback = 'Item') => {
    applyEdit((src, start, end, selected) => {
      const lineStart = src.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
      const chunk = selected || fallback;
      const formatted = chunk
        .split('\n')
        .map((ln) => `${prefix}${ln}`)
        .join('\n');
      const targetStart = selected ? start : lineStart;
      const next = `${src.slice(0, targetStart)}${formatted}${src.slice(end)}`;
      return {
        text: next,
        selStart: targetStart + prefix.length,
        selEnd: targetStart + formatted.length,
      };
    });
  };

  const insertLink = () => {
    const url = window.prompt('Enter link URL (https://..., /#..., or mailto:...):', 'https://');
    if (!url || !url.trim()) return;
    const cleanUrl = url.trim();
    applyEdit((src, start, end, selected) => {
      const labelText = selected || 'Descriptive Link Text';
      const snippet = `[${labelText}](${cleanUrl})`;
      const next = `${src.slice(0, start)}${snippet}${src.slice(end)}`;
      return {
        text: next,
        selStart: start + 1,
        selEnd: start + 1 + labelText.length,
      };
    });
  };

  const insertDivider = () => {
    applyEdit((src, start, end) => {
      const needBefore = start > 0 && src[start - 1] !== '\n' ? '\n\n' : (start > 1 && src[start - 2] !== '\n' ? '\n' : '');
      const snippet = `${needBefore}---\n\n`;
      const next = `${src.slice(0, start)}${snippet}${src.slice(end)}`;
      const pos = start + snippet.length;
      return { text: next, selStart: pos, selEnd: pos };
    });
  };

  const warnings = getLinkTextWarnings(current);

  return (
    <div className="field">
      <div className="between" style={{ gap: '.5rem', marginBottom: '.2rem' }}>
        {label ? <label htmlFor={id}>{label}{required ? ' *' : ''}</label> : <span />}
        <div className="actions" style={{ gap: '.3rem' }}>
          <button
            type="button"
            className={`btn sm${mode === 'write' ? ' primary' : ''}`}
            onClick={() => setMode('write')}
          >
            Write
          </button>
          <button
            type="button"
            className={`btn sm${mode === 'preview' ? ' primary' : ''}`}
            onClick={() => setMode('preview')}
          >
            Preview
          </button>
        </div>
      </div>

      {mode === 'write' ? (
        <>
          <div className="rte-toolbar" role="toolbar" aria-label="Text formatting tools">
            <button type="button" className="rte-btn" title="Heading 2" onClick={() => prefixLine('## ', 'Section Heading')}>H2</button>
            <button type="button" className="rte-btn" title="Heading 3" onClick={() => prefixLine('### ', 'Subheading')}>H3</button>
            <button type="button" className="rte-btn" title="Bold" onClick={() => wrapSelection('**', '**', 'bold text')}><strong>B</strong></button>
            <button type="button" className="rte-btn" title="Italic" onClick={() => wrapSelection('*', '*', 'italic text')}><em>I</em></button>
            <button type="button" className="rte-btn" title="Bullet List" onClick={() => prefixLine('- ', 'List item')}>• List</button>
            <button type="button" className="rte-btn" title="Numbered List" onClick={() => prefixLine('1. ', 'Step one')}>1. List</button>
            <button type="button" className="rte-btn" title="Callout / Quote" onClick={() => prefixLine('> ', 'Callout note')}>Quote</button>
            <button type="button" className="rte-btn" title="Insert Link" onClick={insertLink}>Link</button>
            <button type="button" className="rte-btn" title="Insert Divider" onClick={insertDivider}>Divider</button>
          </div>
          <textarea
            ref={taRef}
            id={id}
            rows={rows}
            required={required}
            placeholder={placeholder}
            value={current}
            onChange={(e) => onChange(e.target.value)}
            style={{ borderTopLeftRadius: 0, borderTopRightRadius: 0 }}
          />
        </>
      ) : (
        <div className="rte-preview">
          {current.trim()
            ? <RichTextContent text={current} />
            : <p className="muted" style={{ margin: 0 }}>Nothing to preview yet.</p>}
        </div>
      )}

      {helpText && (
        <div className="muted" style={{ fontSize: '.78rem', marginTop: '.2rem' }}>{helpText}</div>
      )}
      {warnings.map((w) => (
        <div key={w} className="muted" role="status" style={{ color: '#92400e', fontSize: '.82rem', marginTop: '.25rem' }}>
          {w}
        </div>
      ))}
    </div>
  );
}
