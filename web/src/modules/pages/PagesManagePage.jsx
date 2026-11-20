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

import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../core/api.js';
import { getLinkTextWarnings } from '../../core/a11y.js';
import { useToast } from '../../core/toast.jsx';

const EMPTY_PAGE = {
  title: '',
  category: 'City Services',
  summary: '',
  body: '',
  sort_order: 0,
  is_public: true,
};

const EMPTY_LINK = {
  label: '',
  description: '',
  url: '',
  sort_order: 0,
  is_public: true,
};

export default function PagesManagePage() {
  const [tab, setTab] = useState('pages');
  const [pages, setPages] = useState([]);
  const [links, setLinks] = useState([]);

  const [pageForm, setPageForm] = useState({ ...EMPTY_PAGE });
  const [editPageId, setEditPageId] = useState(null);

  const [linkForm, setLinkForm] = useState({ ...EMPTY_LINK });
  const [editLinkId, setEditLinkId] = useState(null);

  const [busy, setBusy] = useState(false);
  const showToast = useToast();

  const loadAll = useCallback(async () => {
    const [pRows, lRows] = await Promise.all([
      api('/api/pages'),
      api('/api/pages/quick-links'),
    ]);
    setPages(Array.isArray(pRows) ? pRows : []);
    setLinks(Array.isArray(lRows) ? lRows : []);
  }, []);

  useEffect(() => {
    loadAll().catch((e) => showToast(e.message, 'error'));
  }, [loadAll, showToast]);

  const savePage = async (e) => {
    e.preventDefault();
    if (!pageForm.title.trim()) return;
    setBusy(true);
    try {
      const payload = {
        ...pageForm,
        title: pageForm.title.trim(),
        category: pageForm.category.trim() || 'City Services',
        summary: pageForm.summary.trim(),
        body: pageForm.body.trim(),
        sort_order: Number(pageForm.sort_order) || 0,
      };
      if (editPageId) {
        await api(`/api/pages/${editPageId}`, { method: 'PATCH', body: JSON.stringify(payload) });
        showToast('Page updated', 'ok');
      } else {
        await api('/api/pages', { method: 'POST', body: JSON.stringify(payload) });
        showToast('Page created', 'ok');
      }
      setEditPageId(null);
      setPageForm({ ...EMPTY_PAGE });
      await loadAll();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const saveLink = async (e) => {
    e.preventDefault();
    if (!linkForm.label.trim() || !linkForm.url.trim()) return;
    setBusy(true);
    try {
      const payload = {
        ...linkForm,
        label: linkForm.label.trim(),
        description: linkForm.description.trim(),
        url: linkForm.url.trim(),
        sort_order: Number(linkForm.sort_order) || 0,
      };
      if (editLinkId) {
        await api(`/api/pages/quick-links/${editLinkId}`, { method: 'PATCH', body: JSON.stringify(payload) });
        showToast('Quick link updated', 'ok');
      } else {
        await api('/api/pages/quick-links', { method: 'POST', body: JSON.stringify(payload) });
        showToast('Quick link added', 'ok');
      }
      setEditLinkId(null);
      setLinkForm({ ...EMPTY_LINK });
      await loadAll();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section id="section-pages-manage">
      <div className="between" style={{ marginBottom: '1rem' }}>
        <h1 style={{ margin: 0 }}>City Info Pages &amp; Quick Links</h1>
        <a href="/#pages" target="_blank" rel="noreferrer" className="btn sm">View Public Pages &amp; Links</a>
      </div>

      <div className="tabs">
        <button type="button" className={`btn sm${tab === 'pages' ? ' active' : ''}`} onClick={() => setTab('pages')}>
          City Info Pages ({pages.length})
        </button>
        <button type="button" className={`btn sm${tab === 'links' ? ' active' : ''}`} onClick={() => setTab('links')}>
          Quick Links ({links.length})
        </button>
      </div>

      {tab === 'pages' && (
        <>
          <div className="card">
            <h2>{editPageId ? 'Edit Info Page' : 'Create City Info Page'}</h2>
            <form onSubmit={savePage}>
              <div className="row" style={{ marginBottom: '.75rem' }}>
                <div className="field" style={{ flex: 2, minWidth: 220 }}>
                  <label htmlFor="pg-title">Page Title *</label>
                  <input id="pg-title" required placeholder="e.g. Trash & Recycling, Water Billing" value={pageForm.title} onChange={(e) => setPageForm((f) => ({ ...f, title: e.target.value }))} />
                </div>
                <div className="field" style={{ flex: 1, minWidth: 160 }}>
                  <label htmlFor="pg-cat">Category</label>
                  <input id="pg-cat" placeholder="e.g. City Services, Utilities" value={pageForm.category} onChange={(e) => setPageForm((f) => ({ ...f, category: e.target.value }))} />
                </div>
                <div className="field" style={{ width: 90 }}>
                  <label htmlFor="pg-sort">Order</label>
                  <input id="pg-sort" type="number" value={pageForm.sort_order} onChange={(e) => setPageForm((f) => ({ ...f, sort_order: e.target.value }))} />
                </div>
              </div>
              <div className="field" style={{ marginBottom: '.75rem' }}>
                <label htmlFor="pg-sum">Short Summary</label>
                <input id="pg-sum" value={pageForm.summary} onChange={(e) => setPageForm((f) => ({ ...f, summary: e.target.value }))} />
              </div>
              <div className="field" style={{ marginBottom: '.75rem' }}>
                <label htmlFor="pg-body">Page Content</label>
                <textarea id="pg-body" rows={6} value={pageForm.body} onChange={(e) => setPageForm((f) => ({ ...f, body: e.target.value }))} />
                {getLinkTextWarnings(pageForm.body).map((w) => (
                  <div key={w} className="muted" role="status" style={{ color: '#92400e', fontSize: '.82rem', marginTop: '.25rem' }}>{w}</div>
                ))}
              </div>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem', cursor: 'pointer', fontSize: '.9rem', marginBottom: '.85rem' }}>
                <input type="checkbox" style={{ width: 'auto', flexShrink: 0 }} checked={pageForm.is_public} onChange={(e) => setPageForm((f) => ({ ...f, is_public: e.target.checked }))} />
                <span>Published on Public Portal</span>
              </label>
              <div className="actions">
                <button type="submit" className="btn primary" disabled={busy}>
                  {busy ? 'Saving…' : (editPageId ? 'Save Page' : 'Publish Page')}
                </button>
                {editPageId && (
                  <button type="button" className="btn" onClick={() => { setEditPageId(null); setPageForm({ ...EMPTY_PAGE }); }}>
                    Cancel
                  </button>
                )}
              </div>
            </form>
          </div>

          <div className="card">
            <h2>Published &amp; Draft Pages ({pages.length})</h2>
            <table>
              <thead>
                <tr><th>Title</th><th>Category</th><th>Visibility</th><th style={{ width: 150 }}>Actions</th></tr>
              </thead>
              <tbody>
                {pages.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <strong>{p.title}</strong>
                      {p.summary && <div className="muted" style={{ fontSize: '.82rem' }}>{p.summary}</div>}
                    </td>
                    <td><span className="badge draft">{p.category}</span></td>
                    <td><span className={`badge ${p.is_public ? 'active' : 'disabled'}`}>{p.is_public ? 'Public' : 'Hidden'}</span></td>
                    <td>
                      <div className="actions">
                        <button type="button" className="btn sm" onClick={() => { setEditPageId(p.id); setPageForm({ ...p }); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Edit</button>
                        <button
                          type="button"
                          className="btn sm danger"
                          onClick={async () => {
                            if (!window.confirm(`Delete page "${p.title}"?`)) return;
                            await api(`/api/pages/${p.id}`, { method: 'DELETE' });
                            await loadAll();
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'links' && (
        <>
          <div className="card">
            <h2>{editLinkId ? 'Edit Quick Link' : 'Add Quick Link'}</h2>
            <form onSubmit={saveLink}>
              <div className="row" style={{ marginBottom: '.75rem' }}>
                <div className="field" style={{ flex: 1, minWidth: 180 }}>
                  <label htmlFor="ql-lbl">Button Label *</label>
                  <input id="ql-lbl" required placeholder="e.g. Pay Water Bill, Report Streetlight Outage" value={linkForm.label} onChange={(e) => setLinkForm((f) => ({ ...f, label: e.target.value }))} />
                  {getLinkTextWarnings(linkForm.label, { isStandaloneLabel: true }).map((w) => (
                    <div key={w} className="muted" role="status" style={{ color: '#92400e', fontSize: '.82rem', marginTop: '.25rem' }}>{w}</div>
                  ))}
                </div>
                <div className="field" style={{ flex: 2, minWidth: 220 }}>
                  <label htmlFor="ql-url">Target URL or Portal Path *</label>
                  <input id="ql-url" required placeholder="e.g. /portal, /#permits, or https://..." value={linkForm.url} onChange={(e) => setLinkForm((f) => ({ ...f, url: e.target.value }))} />
                </div>
                <div className="field" style={{ width: 90 }}>
                  <label htmlFor="ql-sort">Order</label>
                  <input id="ql-sort" type="number" value={linkForm.sort_order} onChange={(e) => setLinkForm((f) => ({ ...f, sort_order: e.target.value }))} />
                </div>
              </div>
              <div className="field" style={{ marginBottom: '.75rem' }}>
                <label htmlFor="ql-desc">Short Description (optional)</label>
                <input id="ql-desc" value={linkForm.description} onChange={(e) => setLinkForm((f) => ({ ...f, description: e.target.value }))} />
              </div>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem', cursor: 'pointer', fontSize: '.9rem', marginBottom: '.85rem' }}>
                <input type="checkbox" style={{ width: 'auto', flexShrink: 0 }} checked={linkForm.is_public} onChange={(e) => setLinkForm((f) => ({ ...f, is_public: e.target.checked }))} />
                <span>Visible on Public Portal</span>
              </label>
              <div className="actions">
                <button type="submit" className="btn primary" disabled={busy}>
                  {busy ? 'Saving…' : (editLinkId ? 'Save Link' : 'Add Quick Link')}
                </button>
                {editLinkId && (
                  <button type="button" className="btn" onClick={() => { setEditLinkId(null); setLinkForm({ ...EMPTY_LINK }); }}>
                    Cancel
                  </button>
                )}
              </div>
            </form>
          </div>

          <div className="card">
            <h2>Quick Links ({links.length})</h2>
            <table>
              <thead>
                <tr><th>Label</th><th>URL</th><th>Visibility</th><th style={{ width: 150 }}>Actions</th></tr>
              </thead>
              <tbody>
                {links.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <strong>{l.label}</strong>
                      {l.description && <div className="muted" style={{ fontSize: '.82rem' }}>{l.description}</div>}
                    </td>
                    <td className="muted" style={{ fontSize: '.84rem' }}>{l.url}</td>
                    <td><span className={`badge ${l.is_public ? 'active' : 'disabled'}`}>{l.is_public ? 'Public' : 'Hidden'}</span></td>
                    <td>
                      <div className="actions">
                        <button type="button" className="btn sm" onClick={() => { setEditLinkId(l.id); setLinkForm({ ...l }); }}>Edit</button>
                        <button
                          type="button"
                          className="btn sm danger"
                          onClick={async () => {
                            await api(`/api/pages/quick-links/${l.id}`, { method: 'DELETE' });
                            await loadAll();
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
