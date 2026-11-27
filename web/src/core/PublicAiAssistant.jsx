import React, { useEffect, useRef, useState } from 'react';

function SparkleIcon({ className = 'h-4 w-4' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3L12 3z" />
    </svg>
  );
}

function ChatIcon({ className = 'h-3.5 w-3.5' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function SendIcon({ className = 'h-3.5 w-3.5' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 2L11 13" />
      <path d="M22 2L15 22l-4-9-9-4 20-7z" />
    </svg>
  );
}

function TrashIcon({ className = 'h-4 w-4' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
    </svg>
  );
}

function CloseIcon({ className = 'h-4 w-4' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6L6 18" />
      <path d="M6 6l12 12" />
    </svg>
  );
}

const STARTER_PROMPTS = [
  'What are the rules for fence or setback permits?',
  'When is the next City Council meeting?',
  'Show recent public notices and announcements',
  'How do I contact city staff?',
];

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
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="public-ai-launcher"
        className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-full bg-slate-900 px-4 py-3 text-sm font-medium text-white shadow-lg ring-1 ring-white/15 transition hover:bg-slate-800"
      >
        <SparkleIcon className="h-4 w-4 text-amber-300" />
        <span>Ask City Assistant</span>
      </button>
    );
  }

  return (
    <div
      data-testid="public-ai-panel"
      className="fixed bottom-5 right-5 z-50 flex h-[32rem] max-h-[calc(100vh-2.5rem)] w-96 max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
    >
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-900 px-4 py-3 text-white">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10">
            <SparkleIcon className="h-4 w-4 text-amber-300" />
          </div>
          <div>
            <div className="text-sm font-semibold leading-tight">City Assistant</div>
            <div className="text-[11px] text-slate-300">Public records &amp; municipal code</div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setMessages([]);
                setError('');
              }}
              title="Clear conversation"
              className="rounded-lg p-1.5 text-slate-300 transition hover:bg-white/10 hover:text-white"
            >
              <TrashIcon className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setOpen(false)}
            title="Close assistant"
            className="rounded-lg p-1.5 text-slate-300 transition hover:bg-white/10 hover:text-white"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto bg-slate-50 p-4">
        {messages.length === 0 ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs leading-relaxed text-slate-600">
              Ask about published municipal code, upcoming public meetings, city notices, calendar events, forms, or staff directory info.
            </div>
            <div className="space-y-1.5">
              <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                Try asking
              </div>
              {STARTER_PROMPTS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => sendPrompt(q)}
                  className="flex w-full items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-xs text-slate-700 transition hover:border-slate-300 hover:bg-slate-100"
                >
                  <ChatIcon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                  <span>{q}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, idx) => (
            <div
              key={idx}
              className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed ${
                  m.role === 'user'
                    ? 'bg-slate-900 text-white'
                    : 'border border-slate-200 bg-white text-slate-800 shadow-sm'
                }`}
              >
                {m.text}
              </div>
            </div>
          ))
        )}
        {loading && (
          <div className="flex justify-start">
            <div className="rounded-2xl border border-slate-200 bg-white px-3.5 py-2 text-xs text-slate-500 shadow-sm">
              Searching public records…
            </div>
          </div>
        )}
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
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
        className="flex items-center gap-2 border-t border-slate-200 bg-white p-3"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a public question..."
          maxLength={2000}
          disabled={loading}
          className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-900 text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Send message"
        >
          <SendIcon className="h-3.5 w-3.5" />
        </button>
      </form>
    </div>
  );
}
