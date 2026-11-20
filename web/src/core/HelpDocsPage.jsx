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

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, hasPermission } from './api.js';
import { DocketHallLogo } from './PublicChrome.jsx';
import { useToast } from './toast.jsx';

const AUDIENCE_LABELS = {
  all: 'All Users',
  public: 'Residents / Public',
  council: 'Council Members',
  staff: 'Staff',
  admin: 'Administrators',
};

function renderInline(text) {
  const tokens = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)]+\))/g;
  let last = 0;
  let m;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) tokens.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('**') && tok.endsWith('**')) {
      tokens.push(<strong key={key++}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith('`') && tok.endsWith('`')) {
      tokens.push(
        <code key={key++} style={{ background: '#f1f5f9', padding: '1px 5px', borderRadius: 4, fontSize: '.88em' }}>
          {tok.slice(1, -1)}
        </code>,
      );
    } else if (tok.startsWith('[')) {
      const lm = tok.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
      if (lm) {
        tokens.push(
          <a key={key++} href={lm[2]} target="_blank" rel="noreferrer" style={{ color: 'var(--cd-primary)' }}>
            {lm[1]}
          </a>,
        );
      } else {
        tokens.push(tok);
      }
    }
    last = re.lastIndex;
  }
  if (last < text.length) tokens.push(text.slice(last));
  return tokens;
}

function SimpleMarkdown({ text }) {
  const lines = (text || '').split(/\r?\n/);
  const blocks = [];
  let i = 0;
  let k = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) {
      i += 1;
      continue;
    }
    if (trimmed.startsWith('### ')) {
      blocks.push(<h4 key={k++} style={{ margin: '1rem 0 .4rem' }}>{renderInline(trimmed.slice(4))}</h4>);
      i += 1;
    } else if (trimmed.startsWith('## ')) {
      blocks.push(<h3 key={k++} style={{ margin: '1.15rem 0 .45rem', fontSize: '1.05rem' }}>{renderInline(trimmed.slice(3))}</h3>);
      i += 1;
    } else if (trimmed.startsWith('# ')) {
      blocks.push(<h2 key={k++} style={{ margin: '1.2rem 0 .5rem', fontSize: '1.2rem' }}>{renderInline(trimmed.slice(2))}</h2>);
      i += 1;
    } else if (/^[-*]\s+/.test(trimmed)) {
      const items = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push(<li key={items.length} style={{ marginBottom: '.25rem' }}>{renderInline(lines[i].trim().replace(/^[-*]\s+/, ''))}</li>);
        i += 1;
      }
      blocks.push(<ul key={k++} style={{ margin: '.4rem 0 .85rem', paddingLeft: '1.35rem' }}>{items}</ul>);
    } else if (/^\d+\.\s+/.test(trimmed)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(<li key={items.length} style={{ marginBottom: '.25rem' }}>{renderInline(lines[i].trim().replace(/^\d+\.\s+/, ''))}</li>);
        i += 1;
      }
      blocks.push(<ol key={k++} style={{ margin: '.4rem 0 .85rem', paddingLeft: '1.35rem' }}>{items}</ol>);
    } else {
      const para = [];
      while (
        i < lines.length &&
        lines[i].trim() &&
        !/^(#{1,3}\s|[-*]\s|\d+\.\s)/.test(lines[i].trim())
      ) {
        para.push(lines[i].trim());
        i += 1;
      }
      blocks.push(<p key={k++} style={{ margin: '.4rem 0 .85rem', lineHeight: 1.55 }}>{renderInline(para.join(' '))}</p>);
    }
  }

  return <div>{blocks}</div>;
}

const EMPTY_FORM = {
  slug: '',
  title: '',
  category: 'General',
  audience: 'all',
  sort_order: 100,
  body: '',
  is_published: true,
};

export default function HelpDocsPage({ me }) {
  const canManage = hasPermission(me, 'settings.manage');
  const [docs, setDocs] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [search, setSearch] = useState('');
  const [audienceFilter, setAudienceFilter] = useState('');
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const showToast = useToast();

  const loadDocs = useCallback(async () => {
    const rows = await api('/api/docs');
    const list = Array.isArray(rows) ? rows : [];
    setDocs(list);
    setSelectedId(prev => (prev && list.some(d => d.id === prev) ? prev : list[0]?.id ?? null));
  }, []);

  useEffect(() => {
    loadDocs().catch(e => showToast(e.message, 'error'));
  }, [loadDocs, showToast]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return docs.filter((d) => {
      if (audienceFilter && d.audience !== audienceFilter) return false;
      if (!q) return true;
      return (
        (d.title || '').toLowerCase().includes(q) ||
        (d.category || '').toLowerCase().includes(q) ||
        (d.body || '').toLowerCase().includes(q)
      );
    });
  }, [docs, search, audienceFilter]);

  const grouped = useMemo(() => {
    const map = new Map();
    for (const d of filtered) {
      const cat = d.category || 'General';
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat).push(d);
    }
    return Array.from(map.entries());
  }, [filtered]);

  const selectedDoc = useMemo(
    () => docs.find(d => d.id === selectedId) || filtered[0] || null,
    [docs, filtered, selectedId],
  );

  const startNew = () => {
    setForm({ ...EMPTY_FORM });
    setSelectedId(null);
    setEditing(true);
  };

  const startEdit = (doc) => {
    setForm({
      slug: doc.slug || '',
      title: doc.title || '',
      category: doc.category || 'General',
      audience: doc.audience || 'all',
      sort_order: doc.sort_order ?? 100,
      body: doc.body || '',
      is_published: doc.is_published !== false,
    });
    setEditing(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        ...form,
        sort_order: Number(form.sort_order) || 100,
      };
      const saved = selectedId && editing
        ? await api(`/api/docs/${selectedId}`, { method: 'PUT', body: JSON.stringify(payload) })
        : await api('/api/docs', { method: 'POST', body: JSON.stringify(payload) });
      showToast('Documentation saved', 'ok');
      setEditing(false);
      await loadDocs();
      if (saved?.id) setSelectedId(saved.id);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleDelete = async (doc) => {
    if (!window.confirm(`Delete "${doc.title}"?`)) return;
    try {
      await api(`/api/docs/${doc.id}`, { method: 'DELETE' });
      showToast('Documentation deleted', 'ok');
      setEditing(false);
      setSelectedId(null);
      await loadDocs();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  return (
    <section id="section-help">
      <div className="between" style={{ marginBottom: '1rem' }}>
        <div>
          <h1 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '.5rem' }}>
            <DocketHallLogo size={28} />
            <span>User Guide &amp; Documentation</span>
          </h1>
          <p className="muted" style={{ margin: '.25rem 0 0' }}>
            Instructions for using DocketHall across roles and modules.
          </p>
        </div>
        {canManage && !editing && (
          <button type="button" className="btn primary" onClick={startNew}>
            + New Guide
          </button>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(230px, 280px) minmax(0, 1fr)', gap: '1rem', alignItems: 'start' }}>
        <div className="card" style={{ marginBottom: 0 }}>
          <div className="field" style={{ marginBottom: '.65rem' }}>
            <input
              aria-label="Search help guides"
              placeholder="Search guides…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="field" style={{ marginBottom: '.85rem' }}>
            <select aria-label="Filter help topics by audience" value={audienceFilter} onChange={(e) => setAudienceFilter(e.target.value)}>
              <option value="">All Audiences</option>
              {Object.entries(AUDIENCE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>

          {!grouped.length ? (
            <p className="muted" style={{ margin: 0 }}>No matching guides.</p>
          ) : grouped.map(([cat, list]) => (
            <div key={cat} style={{ marginBottom: '.85rem' }}>
              <div style={{ fontSize: '.74rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: '#616e7c', marginBottom: '.35rem' }}>
                {cat}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '.25rem' }}>
                {list.map((d) => {
                  const active = !editing && selectedDoc?.id === d.id;
                  return (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => { setEditing(false); setSelectedId(d.id); }}
                      style={{
                        textAlign: 'left',
                        border: 0,
                        borderRadius: 6,
                        padding: '.45rem .6rem',
                        cursor: 'pointer',
                        background: active ? 'var(--cd-tint)' : 'transparent',
                        color: active ? 'var(--cd-primary)' : '#1f2933',
                        fontWeight: active ? 600 : 400,
                        fontSize: '.9rem',
                      }}
                    >
                      {d.title}
                      {!d.is_published && <span className="badge draft" style={{ marginLeft: 6 }}>Draft</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="card" style={{ marginBottom: 0 }}>
          {editing ? (
            <form onSubmit={handleSave}>
              <h2 style={{ marginTop: 0 }}>{selectedId ? 'Edit Guide' : 'New Guide'}</h2>
              <div className="row" style={{ marginBottom: '.75rem' }}>
                <div className="field" style={{ flex: 2, minWidth: 220 }}>
                  <label htmlFor="doc-title">Title</label>
                  <input
                    id="doc-title"
                    required
                    value={form.title}
                    onChange={(e) => setForm(f => ({ ...f, title: e.target.value }))}
                  />
                </div>
                <div className="field" style={{ flex: 1, minWidth: 160 }}>
                  <label htmlFor="doc-category">Category</label>
                  <input
                    id="doc-category"
                    value={form.category}
                    onChange={(e) => setForm(f => ({ ...f, category: e.target.value }))}
                  />
                </div>
              </div>
              <div className="row" style={{ marginBottom: '.75rem' }}>
                <div className="field" style={{ flex: 1, minWidth: 160 }}>
                  <label htmlFor="doc-audience">Audience</label>
                  <select
                    id="doc-audience"
                    value={form.audience}
                    onChange={(e) => setForm(f => ({ ...f, audience: e.target.value }))}
                  >
                    {Object.entries(AUDIENCE_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>
                <div className="field" style={{ flex: 1, minWidth: 150 }}>
                  <label htmlFor="doc-slug">Slug (optional)</label>
                  <input
                    id="doc-slug"
                    placeholder="auto-generated"
                    value={form.slug}
                    onChange={(e) => setForm(f => ({ ...f, slug: e.target.value }))}
                  />
                </div>
                <div className="field" style={{ width: 110 }}>
                  <label htmlFor="doc-order">Order</label>
                  <input
                    id="doc-order"
                    type="number"
                    value={form.sort_order}
                    onChange={(e) => setForm(f => ({ ...f, sort_order: e.target.value }))}
                  />
                </div>
              </div>
              <div className="field" style={{ marginBottom: '.75rem' }}>
                <label htmlFor="doc-body">Content (supports ## headings, - bullets, 1. numbered steps, **bold**, `code`, [links](https://...))</label>
                <textarea
                  id="doc-body"
                  rows={14}
                  value={form.body}
                  onChange={(e) => setForm(f => ({ ...f, body: e.target.value }))}
                />
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginBottom: '1rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  style={{ width: 'auto' }}
                  checked={form.is_published}
                  onChange={(e) => setForm(f => ({ ...f, is_published: e.target.checked }))}
                />
                <span>Published</span>
              </label>
              <div className="actions">
                <button type="submit" className="btn primary">Save Guide</button>
                <button type="button" className="btn" onClick={() => setEditing(false)}>Cancel</button>
              </div>
            </form>
          ) : selectedDoc ? (
            <div>
              <div className="between" style={{ marginBottom: '.75rem', borderBottom: '1px solid var(--cd-border)', paddingBottom: '.75rem' }}>
                <div>
                  <h2 style={{ margin: '0 0 .35rem', fontSize: '1.2rem' }}>{selectedDoc.title}</h2>
                  <div className="actions">
                    <span className="badge" style={{ background: 'var(--cd-tint)', color: 'var(--cd-primary)' }}>
                      {selectedDoc.category}
                    </span>
                    <span className="badge" style={{ background: '#f1f5f9', color: '#334155' }}>
                      {AUDIENCE_LABELS[selectedDoc.audience] || selectedDoc.audience}
                    </span>
                    {!selectedDoc.is_published && <span className="badge draft">Draft</span>}
                  </div>
                </div>
                {canManage && (
                  <div className="actions">
                    <button type="button" className="btn sm" onClick={() => startEdit(selectedDoc)}>Edit</button>
                    <button type="button" className="btn sm danger" onClick={() => handleDelete(selectedDoc)}>Delete</button>
                  </div>
                )}
              </div>
              <SimpleMarkdown text={selectedDoc.body} />
            </div>
          ) : (
            <p className="muted" style={{ margin: 0 }}>Select a guide on the left to read.</p>
          )}
        </div>
      </div>
    </section>
  );
}
