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

import React, { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { useToast } from './toast.jsx';

const DEFAULT_MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-3.8-flash',
  'gemini-3.8-pro',
];

function renderTextWithLinks(text, keyPrefix) {
  const linkRe = /((?:City\s+)?Code\s+§+\s*\d+(?:\.\d+)+(?:\([^)]+\))*|Sections?\s+\d+(?:\.\d+)+(?:\([^)]+\))*|§+\s*\d+(?:\.\d+)+(?:\([^)]+\))*|\b\d{3}\.\d{2,3}(?:\.\d+)?(?:\([^)]+\))*|\bPRM-\d{4}-\d{3,4}\b|\bCMP-\d{4}-\d{3,4}\b)/gi;
  const out = [];
  let last = 0;
  let m;
  let k = 0;
  while ((m = linkRe.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const raw = m[0];
    if (/^PRM-/i.test(raw)) {
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
    } else if (/^CMP-/i.test(raw)) {
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

function renderInlineMarkdown(text) {
  const parts = [];
  const tokenRe = /(\[[^\]]+\]\((?:https?:\/\/|\/|#)[^)]+\)|\*\*[^*]+\*\*|`[^`]+`|\*[^*\n]+\*)/g;
  let last = 0;
  let match;
  let idx = 0;
  while ((match = tokenRe.exec(text)) !== null) {
    if (match.index > last) {
      parts.push(...renderTextWithLinks(text.slice(last, match.index), `t-${idx++}`));
    }
    const tok = match[0];
    if (tok.startsWith('[') && tok.includes('](') && tok.endsWith(')')) {
      const splitIdx = tok.indexOf('](');
      const label = tok.slice(1, splitIdx);
      const href = tok.slice(splitIdx + 2, -1);
      const isExt = href.startsWith('http');
      parts.push(
        <a
          key={idx++}
          href={href}
          target={isExt || href.startsWith('/code') ? '_blank' : undefined}
          rel={isExt || href.startsWith('/code') ? 'noreferrer' : undefined}
          style={{ color: '#2563eb', textDecoration: 'underline' }}
        >
          {label}
        </a>
      );
    } else if (tok.startsWith('**') && tok.endsWith('**')) {
      parts.push(<strong key={idx++}>{renderTextWithLinks(tok.slice(2, -2), `b-${idx}`)}</strong>);
    } else if (tok.startsWith('`') && tok.endsWith('`')) {
      parts.push(
        <code
          key={idx++}
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
      parts.push(<em key={idx++}>{renderTextWithLinks(tok.slice(1, -1), `i-${idx}`)}</em>);
    }
    last = match.index + tok.length;
  }
  if (last < text.length) {
    parts.push(...renderTextWithLinks(text.slice(last), `e-${idx++}`));
  }
  return parts;
}

export function MarkdownMessage({ text }) {
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
        <div key={blocks.length} style={{ fontWeight: 700, margin: '0.25rem 0 0.15rem' }}>
          {renderInlineMarkdown(headingMatch[2])}
        </div>
      );
      i++;
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
            <li key={k} style={{ marginBottom: '0.15rem' }}>{renderInlineMarkdown(it)}</li>
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
            <li key={k} style={{ marginBottom: '0.15rem' }}>{renderInlineMarkdown(it)}</li>
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
      !/^\s*\d+\.\s+/.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={blocks.length} style={{ margin: '0 0 0.35rem' }}>
        {paraLines.map((pl, k) => (
          <React.Fragment key={k}>
            {k > 0 && <br />}
            {renderInlineMarkdown(pl)}
          </React.Fragment>
        ))}
      </p>
    );
  }
  return <div style={{ lineHeight: 1.45 }}>{blocks}</div>;
}

export default function AiAssistantBar({ onNavigate }) {
  const [status, setStatus] = useState({
    configured: false,
    can_configure: false,
    model: 'gemini-3.8-flash',
    available_models: DEFAULT_MODELS,
    loading: true,
  });
  const [minimized, setMinimized] = useState(false);
  const [pos, setPos] = useState(null);
  const [dragging, setDragging] = useState(false);
  const asideRef = useRef(null);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState([]);
  const chatEndRef = useRef(null);
  const showToast = useToast();

  useEffect(() => {
    const loadStatus = () => {
      api('/api/ai/status')
        .then((d) => {
          setStatus({
            configured: !!d?.configured,
            can_configure: !!d?.can_configure,
            model: d?.model || 'gemini-3.8-flash',
            available_models: Array.isArray(d?.available_models) && d.available_models.length ? d.available_models : DEFAULT_MODELS,
            loading: false,
          });
        })
        .catch(() => setStatus((s) => ({ ...s, loading: false })));
    };
    loadStatus();
    window.addEventListener('dockethall:ai-config-changed', loadStatus);
    return () => window.removeEventListener('dockethall:ai-config-changed', loadStatus);
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy, minimized]);

  const messagesRef = useRef([]);
  const busyRef = useRef(false);
  messagesRef.current = messages;
  busyRef.current = busy;

  async function runPrompt(rawText) {
    const text = String(rawText || '').trim();
    if (!text || busyRef.current) return;
    const historyPayload = messagesRef.current.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      text: m.text,
    }));
    setMessages((prev) => [...prev, { role: 'user', text }]);
    setPrompt('');
    setBusy(true);
    try {
      const res = await api('/api/ai/command', {
        method: 'POST',
        body: JSON.stringify({ prompt: text, history: historyPayload }),
      });
      const actions = Array.isArray(res?.actions) ? res.actions : [];
      const pendingActions = Array.isArray(res?.pending_actions) ? res.pending_actions : [];
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: res?.reply || 'Done.', actions, pendingActions },
      ]);
      if (actions.length > 0) {
        showToast(actions[0].summary, 'ok');
        window.dispatchEvent(new CustomEvent('dockethall:ai-action', { detail: actions }));
        if (actions[0].route) {
          onNavigate?.(actions[0].route);
        }
      }
    } catch (err) {
      const msg = err.message || 'AI request failed';
      setMessages((prev) => [...prev, { role: 'assistant', text: `Error: ${msg}`, isError: true }]);
      showToast(msg, 'error');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const onAiAsk = (ev) => {
      const p = ev?.detail?.prompt;
      if (!p) return;
      setMinimized(false);
      runPrompt(p);
    };
    window.addEventListener('dockethall:ai-ask', onAiAsk);
    return () => window.removeEventListener('dockethall:ai-ask', onAiAsk);
  }, []);

  async function handleRun(e) {
    e.preventDefault();
    await runPrompt(prompt);
  }

  async function handleConfirm(msgIndex, pendingActions) {
    if (busy || !Array.isArray(pendingActions) || pendingActions.length === 0) return;
    setBusy(true);
    try {
      const res = await api('/api/ai/confirm', {
        method: 'POST',
        body: JSON.stringify({
          pending_actions: pendingActions.map((p) => ({ tool: p.tool, args: p.args || {} })),
        }),
      });
      const actions = Array.isArray(res?.actions) ? res.actions : [];
      setMessages((prev) => [
        ...prev.map((m, idx) => (idx === msgIndex ? { ...m, resolvedState: 'confirmed' } : m)),
        { role: 'assistant', text: res?.reply || 'Done.', actions },
      ]);
      if (actions.length > 0) {
        showToast(actions[0].summary, 'ok');
        window.dispatchEvent(new CustomEvent('dockethall:ai-action', { detail: actions }));
        if (actions[0].route) {
          onNavigate?.(actions[0].route);
        }
      }
    } catch (err) {
      const msg = err.message || 'Failed to apply proposed changes';
      setMessages((prev) => [...prev, { role: 'assistant', text: `Error: ${msg}`, isError: true }]);
      showToast(msg, 'error');
    } finally {
      setBusy(false);
    }
  }

  function handleCancel(msgIndex) {
    if (busy) return;
    setMessages((prev) => [
      ...prev.map((m, idx) => (idx === msgIndex ? { ...m, resolvedState: 'cancelled' } : m)),
      { role: 'assistant', text: 'Cancelled — no changes were made.' },
    ]);
  }

  function handleTitleBarPointerDown(e) {
    if (e.button !== 0 || e.target.closest('button')) return;
    const box = asideRef.current?.getBoundingClientRect();
    if (!box) return;
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const origX = box.left;
    const origY = box.top;
    setDragging(true);

    const onMove = (ev) => {
      const maxX = Math.max(8, window.innerWidth - box.width - 8);
      const maxY = Math.max(8, window.innerHeight - box.height - 8);
      const nx = Math.min(Math.max(8, origX + (ev.clientX - startX)), maxX);
      const ny = Math.min(Math.max(8, origY + (ev.clientY - startY)), maxY);
      setPos({ x: nx, y: ny });
    };

    const onUp = () => {
      setDragging(false);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  if (status.loading) return null;

  if (minimized) {
    return (
      <div
        style={{
          position: 'fixed',
          right: '1rem',
          bottom: '1rem',
          zIndex: 950,
        }}
      >
        <button
          type="button"
          className="btn primary"
          onClick={() => setMinimized(false)}
          aria-label="Restore AI Assistant window"
          style={{
            borderRadius: '999px',
            boxShadow: '0 8px 24px rgba(15, 41, 66, 0.28)',
            padding: '.55rem 1rem',
            fontWeight: 600,
          }}
        >
          AI Assistant{messages.length > 0 ? ` (${messages.length})` : ''} &#9650;
        </button>
      </div>
    );
  }

  return (
    <aside
      ref={asideRef}
      aria-label="AI Admin Assistant"
      style={{
        position: 'fixed',
        ...(pos ? { left: `${pos.x}px`, top: `${pos.y}px` } : { right: '1rem', bottom: '1rem' }),
        width: 'min(420px, calc(100vw - 1.5rem))',
        maxHeight: 'min(560px, calc(100vh - 2rem))',
        zIndex: 950,
        display: 'flex',
        flexDirection: 'column',
        background: '#ffffff',
        border: '1px solid #cbd5e1',
        borderRadius: '10px',
        boxShadow: '0 14px 36px rgba(15, 23, 42, 0.22)',
        overflow: 'hidden',
      }}
    >
      <div
        onPointerDown={handleTitleBarPointerDown}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '.5rem',
          padding: '.55rem .8rem',
          background: '#0f2942',
          color: '#ffffff',
          cursor: dragging ? 'grabbing' : 'grab',
          userSelect: 'none',
          touchAction: 'none',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <strong style={{ fontSize: '.9rem', display: 'block' }}>AI Admin Assistant</strong>
          <span style={{ fontSize: '.74rem', opacity: 0.85 }}>{status.model}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.3rem', flexShrink: 0 }}>
          {messages.length > 0 && (
            <button
              type="button"
              className="btn sm"
              onClick={() => setMessages([])}
              title="Clear chat"
              style={{ padding: '.2rem .45rem', fontSize: '.74rem' }}
            >
              Clear
            </button>
          )}
          <button
            type="button"
            className="btn sm"
            onClick={() => setMinimized(true)}
            aria-label="Minimize AI Assistant window"
            title="Minimize"
            style={{ padding: '.2rem .5rem', fontSize: '.78rem', fontWeight: 700 }}
          >
            &minus;
          </button>
        </div>
      </div>

      {!status.configured && (
        <div
          style={{
            padding: '.6rem .75rem',
            background: '#fffbeb',
            borderBottom: '1px solid #fde68a',
            fontSize: '.8rem',
            color: '#92400e',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '.5rem',
            flexWrap: 'wrap',
          }}
        >
          <span>Gemini API key is not configured.</span>
          {status.can_configure && (
            <button
              type="button"
              className="btn sm"
              onClick={() => onNavigate?.('/app/integrations')}
              style={{ fontSize: '.74rem', padding: '.2rem .5rem' }}
            >
              Email &amp; Integrations &rarr;
            </button>
          )}
        </div>
      )}

      <div
        style={{
          flex: 1,
          minHeight: '170px',
          maxHeight: '320px',
          overflowY: 'auto',
          padding: '.75rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '.55rem',
          background: '#f8fafc',
        }}
      >
        {messages.length === 0 ? (
          <div className="muted" style={{ fontSize: '.82rem', lineHeight: 1.45 }}>
            Ask me to perform admin tasks, such as:
            <ul style={{ margin: '.35rem 0 0 1.1rem', padding: 0 }}>
              <li>&ldquo;Create an agenda entitled Special Meeting for December 1 at 6pm&rdquo;</li>
              <li>&ldquo;Post a notice about leaf pickup next Monday&rdquo;</li>
              <li>&ldquo;Add a backlog todo to review snowplowing contract&rdquo;</li>
            </ul>
          </div>
        ) : (
          messages.map((m, i) => (
            <div
              key={i}
              style={{
                alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '88%',
                padding: '.48rem .7rem',
                borderRadius: '8px',
                fontSize: '.84rem',
                lineHeight: 1.4,
                background: m.role === 'user' ? '#0f2942' : (m.isError ? '#fef2f2' : '#ffffff'),
                color: m.role === 'user' ? '#ffffff' : (m.isError ? '#991b1b' : '#0f172a'),
                border: m.role === 'user' ? 'none' : `1px solid ${m.isError ? '#fecaca' : '#e2e8f0'}`,
              }}
            >
              {m.role === 'user' || m.isError ? (
                <div style={{ whiteSpace: 'pre-wrap' }}>{m.text}</div>
              ) : (
                <MarkdownMessage text={m.text} />
              )}
              {Array.isArray(m.pendingActions) && m.pendingActions.length > 0 && (
                <div
                  style={{
                    marginTop: '.45rem',
                    padding: '.45rem .55rem',
                    background: '#f8fafc',
                    border: '1px solid #cbd5e1',
                    borderRadius: '6px',
                  }}
                >
                  <div style={{ fontSize: '.75rem', fontWeight: 700, color: '#334155', marginBottom: '.25rem' }}>
                    Proposed Changes:
                  </div>
                  <ul style={{ margin: '0 0 .45rem 1.05rem', padding: 0, fontSize: '.78rem', color: '#1e293b' }}>
                    {m.pendingActions.map((pa, j) => (
                      <li key={j}>{pa.summary}</li>
                    ))}
                  </ul>
                  {!m.resolvedState ? (
                    <div style={{ display: 'flex', gap: '.4rem' }}>
                      <button
                        type="button"
                        className="btn sm primary"
                        disabled={busy}
                        onClick={() => handleConfirm(i, m.pendingActions)}
                        style={{ fontSize: '.75rem', padding: '.22rem .6rem' }}
                      >
                        Confirm
                      </button>
                      <button
                        type="button"
                        className="btn sm"
                        disabled={busy}
                        onClick={() => handleCancel(i)}
                        style={{ fontSize: '.75rem', padding: '.22rem .6rem' }}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <span className="muted" style={{ fontSize: '.74rem', fontWeight: 600 }}>
                      {m.resolvedState === 'confirmed' ? '✓ Confirmed' : '✕ Cancelled'}
                    </span>
                  )}
                </div>
              )}
              {Array.isArray(m.actions) && m.actions.length > 0 && (
                <div style={{ display: 'flex', gap: '.35rem', flexWrap: 'wrap', marginTop: '.4rem' }}>
                  {m.actions.map((act, j) => (
                    act.route ? (
                      <button
                        key={j}
                        type="button"
                        className="btn sm"
                        style={{ fontSize: '.75rem', padding: '.2rem .5rem' }}
                        onClick={() => onNavigate?.(act.route)}
                      >
                        Open &rarr;
                      </button>
                    ) : null
                  ))}
                </div>
              )}
            </div>
          ))
        )}
        {busy && (
          <div className="muted" style={{ fontSize: '.8rem', alignSelf: 'flex-start' }}>
            Working…
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      <form
        onSubmit={handleRun}
        style={{
          display: 'flex',
          gap: '.45rem',
          padding: '.6rem .75rem',
          borderTop: '1px solid #e2e8f0',
          background: '#ffffff',
        }}
      >
        <input
          type="text"
          aria-label="AI Admin Command"
          placeholder={status.configured ? 'Type a command…' : 'Configure Gemini key in Email & Integrations…'}
          value={prompt}
          disabled={!status.configured || busy}
          onChange={(e) => setPrompt(e.target.value)}
          style={{ flex: 1, minWidth: 0 }}
        />
        <button type="submit" className="btn sm primary" disabled={!status.configured || busy || !prompt.trim()}>
          Send
        </button>
      </form>
    </aside>
  );
}
