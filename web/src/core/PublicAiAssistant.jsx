import React, { useEffect, useRef, useState } from 'react';
import MarkdownMessage from './MarkdownMessage.jsx';

const STARTER_PROMPTS = [
  'What are the rules for fence or setback permits?',
  'When is the next City Council meeting?',
  'Show recent public notices and announcements',
  'How do I contact city staff?',
];

function SparkleIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3L12 3z" />
    </svg>
  );
}

export default function PublicAiAssistant({ activeTab = 'home' }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState({ loaded: false, enabled: false, configured: false });
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const endRef = useRef(null);

  useEffect(() => {
    let active = true;
    fetch('/api/ai/public/status')
      .then((res) => (res.ok ? res.json() : { enabled: false, configured: false }))
      .then((data) => {
        if (active) {
          setStatus({
            loaded: true,
            enabled: Boolean(data?.enabled),
            configured: Boolean(data?.configured),
          });
        }
      })
      .catch(() => {
        if (active) {
          setStatus({ loaded: true, enabled: false, configured: false });
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (open) {
      endRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, loading, open]);

  if (!status.loaded || !status.enabled || !status.configured) {
    return null;
  }

  async function sendPrompt(rawText) {
    const text = (rawText ?? input).trim();
    if (!text || loading) return;

    const history = messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      text: m.text,
    }));

    setMessages((prev) => [...prev, { role: 'user', text }]);
    setInput('');
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/ai/public/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: text,
          history,
          page_context: { route: '/', title: activeTab || 'home' },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.detail || `Request failed (${res.status})`);
      }
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: data.reply || 'No response returned.' },
      ]);
    } catch (err) {
      setError(err.message || 'Unable to reach the assistant right now.');
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <div
        style={{
          position: 'fixed',
          right: '1.25rem',
          bottom: '1.25rem',
          zIndex: 950,
        }}
      >
        <button
          type="button"
          className="btn primary"
          onClick={() => setOpen(true)}
          data-testid="public-ai-launcher"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '.45rem',
            borderRadius: '999px',
            boxShadow: '0 8px 24px rgba(15, 41, 66, 0.28)',
            padding: '.6rem 1.05rem',
            fontWeight: 600,
          }}
        >
          <SparkleIcon size={16} />
          <span>Ask City Assistant</span>
        </button>
      </div>
    );
  }

  return (
    <aside
      data-testid="public-ai-panel"
      aria-label="City Assistant"
      style={{
        position: 'fixed',
        right: '1rem',
        bottom: '1rem',
        width: 'min(400px, calc(100vw - 1.5rem))',
        height: 'min(520px, calc(100vh - 2rem))',
        zIndex: 950,
        display: 'flex',
        flexDirection: 'column',
        background: '#ffffff',
        border: '1px solid #cbd5e1',
        borderRadius: '12px',
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
          padding: '.65rem .85rem',
          background: 'var(--cd-primary, #0f2942)',
          color: '#ffffff',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', minWidth: 0 }}>
          <SparkleIcon size={17} />
          <div style={{ minWidth: 0 }}>
            <strong style={{ fontSize: '.92rem', display: 'block', lineHeight: 1.2 }}>City Assistant</strong>
            <span style={{ fontSize: '.74rem', opacity: 0.85 }}>Public records &amp; municipal code</span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.25rem' }}>
          {messages.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setMessages([]);
                setError('');
              }}
              title="Clear conversation"
              style={{
                background: 'rgba(255,255,255,0.14)',
                color: '#ffffff',
                border: 'none',
                borderRadius: '6px',
                padding: '.25rem .5rem',
                fontSize: '.75rem',
                cursor: 'pointer',
              }}
            >
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={() => setOpen(false)}
            title="Close assistant"
            aria-label="Close assistant"
            style={{
              background: 'rgba(255,255,255,0.14)',
              color: '#ffffff',
              border: 'none',
              borderRadius: '6px',
              padding: '.25rem .55rem',
              fontSize: '.85rem',
              lineHeight: 1,
              cursor: 'pointer',
            }}
          >
            &times;
          </button>
        </div>
      </div>

      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          background: '#f8fafc',
          padding: '.85rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '.6rem',
        }}
      >
        {messages.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.65rem' }}>
            <div
              style={{
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: '10px',
                padding: '.65rem .75rem',
                fontSize: '.82rem',
                color: '#475569',
                lineHeight: 1.45,
              }}
            >
              Ask about published municipal code, upcoming public meetings, city notices, calendar events, forms, or staff directory info.
            </div>
            <div style={{ fontSize: '.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em', color: '#64748b' }}>
              Try asking
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.4rem' }}>
              {STARTER_PROMPTS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => sendPrompt(q)}
                  style={{
                    textAlign: 'left',
                    background: '#ffffff',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    padding: '.5rem .7rem',
                    fontSize: '.82rem',
                    color: '#1e293b',
                    cursor: 'pointer',
                  }}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, idx) => (
            <div
              key={idx}
              style={{
                display: 'flex',
                justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
              }}
            >
              <div
                style={{
                  maxWidth: '88%',
                  borderRadius: '12px',
                  padding: '.55rem .75rem',
                  fontSize: '.83rem',
                  lineHeight: 1.45,
                  ...(m.role === 'user'
                    ? { background: 'var(--cd-primary, #0f2942)', color: '#ffffff', whiteSpace: 'pre-wrap' }
                    : { background: '#ffffff', border: '1px solid #e2e8f0', color: '#0f172a' }),
                }}
              >
                {m.role === 'user' ? m.text : <MarkdownMessage text={m.text} />}
              </div>
            </div>
          ))
        )}
        {loading && (
          <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
            <div
              style={{
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: '12px',
                padding: '.5rem .75rem',
                fontSize: '.8rem',
                color: '#64748b',
              }}
            >
              Searching public records…
            </div>
          </div>
        )}
        {error && (
          <div
            style={{
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: '8px',
              padding: '.5rem .75rem',
              fontSize: '.8rem',
              color: '#b91c1c',
            }}
          >
            {error}
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          sendPrompt();
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '.45rem',
          borderTop: '1px solid #e2e8f0',
          background: '#ffffff',
          padding: '.6rem .75rem',
        }}
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a public question..."
          maxLength={2000}
          disabled={loading}
          style={{
            flex: 1,
            margin: 0,
            padding: '.45rem .65rem',
            fontSize: '.84rem',
            borderRadius: '8px',
            border: '1px solid #cbd5e1',
          }}
        />
        <button
          type="submit"
          className="btn primary"
          disabled={loading || !input.trim()}
          style={{ padding: '.45rem .8rem', borderRadius: '8px', fontSize: '.84rem' }}
        >
          Send
        </button>
      </form>
    </aside>
  );
}
