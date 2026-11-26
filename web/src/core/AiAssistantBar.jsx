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
  'gemini-3.8-flash-lite',
  'gemini-3.8-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-3.8-pro',
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
];

function renderInlineMarkdown(text) {
  const parts = [];
  const tokenRe = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\n]+\*)/g;
  let last = 0;
  let match;
  let idx = 0;
  while ((match = tokenRe.exec(text)) !== null) {
    if (match.index > last) {
      parts.push(text.slice(last, match.index));
    }
    const tok = match[0];
    if (tok.startsWith('**') && tok.endsWith('**')) {
      parts.push(<strong key={idx++}>{tok.slice(2, -2)}</strong>);
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
      parts.push(<em key={idx++}>{tok.slice(1, -1)}</em>);
    }
    last = match.index + tok.length;
  }
  if (last < text.length) {
    parts.push(text.slice(last));
  }
  return parts;
}

function MarkdownMessage({ text }) {
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
    model: 'gemini-3.8-flash',
    available_models: DEFAULT_MODELS,
    loading: true,
  });
  const [minimized, setMinimized] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [selectedModel, setSelectedModel] = useState('gemini-3.8-flash');
  const [apiKey, setApiKey] = useState('');
  const [savingKey, setSavingKey] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState([]);
  const chatEndRef = useRef(null);
  const showToast = useToast();

  useEffect(() => {
    api('/api/ai/status')
      .then((d) => {
        const m = d?.model || 'gemini-3.8-flash';
        setStatus({
          configured: !!d?.configured,
          can_configure: !!d?.can_configure,
          model: m,
          available_models: Array.isArray(d?.available_models) && d.available_models.length ? d.available_models : DEFAULT_MODELS,
          loading: false,
        });
        setSelectedModel(m);
        if (!d?.configured && d?.can_configure) setShowSettings(true);
      })
      .catch(() => setStatus((s) => ({ ...s, loading: false })));
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy, minimized]);

  async function handleRun(e) {
    e.preventDefault();
    const text = prompt.trim();
    if (!text || busy) return;
    const historyPayload = messages.map((m) => ({
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
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: res?.reply || 'Done.', actions },
      ]);
      if (actions.length > 0) {
        showToast(actions[0].summary, 'ok');
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

  async function handleSaveConfig(e) {
    e.preventDefault();
    if (!status.configured && !apiKey.trim()) {
      showToast('Enter a Gemini API key', 'error');
      return;
    }
    setSavingKey(true);
    try {
      const payload = { model: selectedModel };
      if (apiKey.trim()) payload.api_key = apiKey.trim();
      const res = await api('/api/ai/config', {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      setStatus((s) => ({ ...s, configured: !!res.configured, model: res.model }));
      setApiKey('');
      setShowSettings(false);
      showToast(`Saved Gemini settings (${res.model})`, 'ok');
    } catch (err) {
      showToast(err.message || 'Failed to verify Gemini settings', 'error');
    } finally {
      setSavingKey(false);
    }
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
      aria-label="AI Admin Assistant"
      style={{
        position: 'fixed',
        right: '1rem',
        bottom: '1rem',
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
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '.5rem',
          padding: '.55rem .8rem',
          background: '#0f2942',
          color: '#ffffff',
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
          {status.can_configure && (
            <button
              type="button"
              className="btn sm"
              onClick={() => setShowSettings((v) => !v)}
              style={{ padding: '.2rem .45rem', fontSize: '.74rem' }}
            >
              {showSettings ? 'Done' : 'Settings'}
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

      {showSettings && (
        <form
          onSubmit={handleSaveConfig}
          style={{
            padding: '.65rem .8rem',
            background: '#f8fafc',
            borderBottom: '1px solid #e2e8f0',
            display: 'grid',
            gap: '.45rem',
          }}
        >
          <label style={{ fontSize: '.78rem', fontWeight: 600, color: '#334155' }}>
            Gemini Model
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              style={{ marginTop: '.2rem', width: '100%' }}
            >
              {status.available_models.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: '.78rem', fontWeight: 600, color: '#334155' }}>
            Gemini API Key {status.configured ? '(leave blank to keep current)' : ''}
            <input
              type="password"
              aria-label="Gemini API Key"
              placeholder={status.configured ? '•••••••• (saved)' : 'Paste Gemini API key (AQ... or AIza...)'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              style={{ marginTop: '.2rem', width: '100%' }}
            />
          </label>
          <button type="submit" className="btn sm primary" disabled={savingKey}>
            {savingKey ? 'Verifying…' : 'Verify & Save'}
          </button>
        </form>
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
          placeholder={status.configured ? 'Type a command…' : (status.can_configure ? 'Open Settings to add API key…' : 'AI key not configured by admin…')}
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
