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
import { api, formatDate } from '../../core/api.js';
import { useToast } from '../../core/toast.jsx';
import ModuleNotificationsCard from '../../core/ModuleNotificationsCard.jsx';

export const NOTICE_CATEGORIES = [
  { value: 'news', label: 'City News' },
  { value: 'public_notice', label: 'Public Notice' },
  { value: 'bid', label: 'Bid / RFP' },
  { value: 'job', label: 'Job Opening' },
];

const CATEGORY_LABELS = Object.fromEntries(NOTICE_CATEGORIES.map((c) => [c.value, c.label]));

const EMPTY_FORM = {
  title: '',
  category: 'news',
  summary: '',
  body: '',
  department: '',
  contact_info: '',
  attachment_url: '',
  deadline_at: '',
  expires_at: '',
  is_pinned: false,
  is_published: true,
};

const NOTICE_NOTIFICATION_EVENTS = [
  {
    key: 'notices_published',
    label: 'New Public Notice / News / Bid Published',
    description: 'Sent to configured staff recipients whenever a published notice, news post, bid, or job is created.',
  },
];

export default function NoticesManagePage() {
  const [items, setItems] = useState([]);
  const [catFilter, setCatFilter] = useState('');
  const [q, setQ] = useState('');
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [editingId, setEditingId] = useState(null);
  const [attachFile, setAttachFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const showToast = useToast();

  const loadItems = useCallback(async () => {
    const params = new URLSearchParams();
    if (catFilter) params.set('category', catFilter);
    if (q.trim()) params.set('q', q.trim());
    const qs = params.toString() ? `?${params.toString()}` : '';
    const rows = await api(`/api/notices${qs}`);
    setItems(Array.isArray(rows) ? rows : []);
  }, [catFilter, q]);

  useEffect(() => {
    loadItems().catch((e) => showToast(e.message, 'error'));
  }, [loadItems, showToast]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      const payload = {
        ...form,
        title: form.title.trim(),
        summary: form.summary.trim(),
        body: form.body.trim(),
        department: form.department.trim(),
        contact_info: form.contact_info.trim(),
        attachment_url: form.attachment_url.trim(),
        deadline_at: form.deadline_at || '',
        expires_at: form.expires_at || '',
      };
      let saved;
      if (editingId) {
        saved = await api(`/api/notices/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        showToast('Post updated', 'ok');
      } else {
        saved = await api('/api/notices', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        showToast('Post created', 'ok');
      }
      if (attachFile && saved?.id) {
        const fd = new FormData();
        fd.append('file', attachFile);
        await api(`/api/notices/${saved.id}/attachment`, { method: 'POST', body: fd });
        setAttachFile(null);
      }
      setForm({ ...EMPTY_FORM });
      setEditingId(null);
      await loadItems();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (n) => {
    setEditingId(n.id);
    setForm({
      title: n.title || '',
      category: n.category || 'news',
      summary: n.summary || '',
      body: n.body || '',
      department: n.department || '',
      contact_info: n.contact_info || '',
      attachment_url: n.attachment_url || '',
      deadline_at: n.deadline_at || '',
      expires_at: n.expires_at || '',
      is_pinned: Boolean(n.is_pinned),
      is_published: Boolean(n.is_published),
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <section id="section-notices-manage">
      <div className="between" style={{ marginBottom: '1rem' }}>
        <h1 style={{ margin: 0 }}>News, Public Notices, Bids &amp; Jobs</h1>
        <a href="/#notices" target="_blank" rel="noreferrer" className="btn sm">View Public Notices</a>
      </div>

      <div className="card">
        <h2>{editingId ? 'Edit Post' : 'Create News, Notice, Bid, or Job Posting'}</h2>
        <form onSubmit={handleSubmit}>
          <div className="row" style={{ marginBottom: '.75rem' }}>
            <div className="field" style={{ flex: 2, minWidth: 220 }}>
              <label htmlFor="notice-title">Title *</label>
              <input
                id="notice-title"
                required
                placeholder="e.g. Public Hearing: Zoning Ordinance Amendment / Street Sweeping RFP"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 160 }}>
              <label htmlFor="notice-cat">Category</label>
              <select
                id="notice-cat"
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              >
                {NOTICE_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <div className="field" style={{ flex: 1, minWidth: 160 }}>
              <label htmlFor="notice-dept">Department (optional)</label>
              <input
                id="notice-dept"
                placeholder="e.g. Public Works, City Clerk"
                value={form.department}
                onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))}
              />
            </div>
          </div>

          <div className="field" style={{ marginBottom: '.75rem' }}>
            <label htmlFor="notice-summary">Short Summary (shown on list cards)</label>
            <input
              id="notice-summary"
              placeholder="1–2 sentence overview for residents or vendors..."
              value={form.summary}
              onChange={(e) => setForm((f) => ({ ...f, summary: e.target.value }))}
            />
          </div>

          <div className="field" style={{ marginBottom: '.75rem' }}>
            <label htmlFor="notice-body">Full Details</label>
            <textarea
              id="notice-body"
              rows={4}
              placeholder="Full announcement, hearing time/location, bid specifications, or job qualifications..."
              value={form.body}
              onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
            />
          </div>

          <div className="row" style={{ marginBottom: '.75rem' }}>
            <div className="field" style={{ flex: 1, minWidth: 180 }}>
              <label htmlFor="notice-contact">Contact / How to Apply or Submit</label>
              <input
                id="notice-contact"
                placeholder="e.g. clerk@city.gov or City Hall dropbox"
                value={form.contact_info}
                onChange={(e) => setForm((f) => ({ ...f, contact_info: e.target.value }))}
              />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 200 }}>
              <label htmlFor="notice-url">Attachment / PDF (URL or Upload)</label>
              <input
                id="notice-url"
                placeholder="https://... or upload below"
                value={form.attachment_url}
                onChange={(e) => setForm((f) => ({ ...f, attachment_url: e.target.value }))}
              />
              <input
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
                style={{ marginTop: 4, fontSize: '.8rem' }}
                onChange={(e) => setAttachFile(e.target.files?.[0] || null)}
              />
            </div>
            <div className="field" style={{ minWidth: 150 }}>
              <label htmlFor="notice-deadline">Deadline Date (Bids/Jobs)</label>
              <input
                id="notice-deadline"
                type="date"
                value={form.deadline_at}
                onChange={(e) => setForm((f) => ({ ...f, deadline_at: e.target.value }))}
              />
            </div>
            <div className="field" style={{ minWidth: 150 }}>
              <label htmlFor="notice-expires">Auto-Hide After Date</label>
              <input
                id="notice-expires"
                type="date"
                value={form.expires_at}
                onChange={(e) => setForm((f) => ({ ...f, expires_at: e.target.value }))}
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap', marginBottom: '.85rem' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem', cursor: 'pointer', fontSize: '.9rem' }}>
              <input
                type="checkbox"
                style={{ width: 'auto', flexShrink: 0 }}
                checked={form.is_published}
                onChange={(e) => setForm((f) => ({ ...f, is_published: e.target.checked }))}
              />
              <span>Published on Public Portal</span>
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem', cursor: 'pointer', fontSize: '.9rem' }}>
              <input
                type="checkbox"
                style={{ width: 'auto', flexShrink: 0 }}
                checked={form.is_pinned}
                onChange={(e) => setForm((f) => ({ ...f, is_pinned: e.target.checked }))}
              />
              <span>Pin to top</span>
            </label>
          </div>

          <div className="actions">
            <button type="submit" className="btn primary" disabled={saving}>
              {saving ? 'Saving…' : (editingId ? 'Save Changes' : 'Publish Post')}
            </button>
            {editingId && (
              <button
                type="button"
                className="btn"
                onClick={() => { setEditingId(null); setForm({ ...EMPTY_FORM }); }}
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      </div>

      <div className="card">
        <div className="between" style={{ marginBottom: '.85rem', flexWrap: 'wrap', gap: '.5rem' }}>
          <h2 style={{ margin: 0 }}>All Posts ({items.length})</h2>
          <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
            <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} style={{ width: 'auto' }}>
              <option value="">All Categories</option>
              {NOTICE_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
            <input
              placeholder="Search posts…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{ minWidth: 200 }}
            />
          </div>
        </div>

        {items.length === 0 ? (
          <p className="muted">No posts yet. Create your first news item, public notice, bid/RFP, or job posting above.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Category</th>
                <th>Deadline / Expires</th>
                <th>Status</th>
                <th style={{ width: 200 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((n) => (
                <tr key={n.id}>
                  <td>
                    <strong>{n.title}</strong>
                    {n.is_pinned && <span className="badge" style={{ marginLeft: '.4rem', background: '#fef3c7', color: '#92400e' }}>Pinned</span>}
                    {n.summary && <div className="muted" style={{ fontSize: '.82rem' }}>{n.summary}</div>}
                  </td>
                  <td><span className="badge draft">{CATEGORY_LABELS[n.category] || n.category}</span></td>
                  <td className="muted" style={{ fontSize: '.82rem' }}>
                    {n.deadline_at ? `Due: ${n.deadline_at}` : '—'}
                    {n.expires_at ? ` · Hides: ${n.expires_at}` : ''}
                    <div>Posted {formatDate(n.publish_at)}</div>
                  </td>
                  <td>
                    <span className={`badge ${n.is_published ? 'active' : 'disabled'}`}>
                      {n.is_published ? 'Published' : 'Draft'}
                    </span>
                  </td>
                  <td>
                    <div className="actions">
                      <button type="button" className="btn sm" onClick={() => startEdit(n)}>Edit</button>
                      <button
                        type="button"
                        className="btn sm"
                        onClick={async () => {
                          await api(`/api/notices/${n.id}`, {
                            method: 'PATCH',
                            body: JSON.stringify({ is_published: !n.is_published }),
                          });
                          await loadItems();
                        }}
                      >
                        {n.is_published ? 'Unpublish' : 'Publish'}
                      </button>
                      <button
                        type="button"
                        className="btn sm danger"
                        onClick={async () => {
                          if (!window.confirm(`Delete "${n.title}"?`)) return;
                          await api(`/api/notices/${n.id}`, { method: 'DELETE' });
                          await loadItems();
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
        )}
      </div>

      <ModuleNotificationsCard
        moduleId="notices"
        title="News & Notices Email Notifications"
        events={NOTICE_NOTIFICATION_EVENTS}
      />
    </section>
  );
}
