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
import { api, formatDate } from '../../core/api.js';
import { useToast } from '../../core/toast.jsx';
import RichTextEditor from '../../core/RichTextEditor.jsx';
import ModuleNotificationsCard from '../../core/ModuleNotificationsCard.jsx';

export const COMMENT_POLICY_OPTIONS = [
  { value: 'moderated', label: 'Moderated (requires approval)' },
  { value: 'open', label: 'Unmoderated (publish immediately)' },
  { value: 'disabled', label: 'No comments' },
];

export const RSS_POLICY_OPTIONS = [
  { value: 'always_ask', label: 'Always ask per post' },
  { value: 'include', label: 'Always include in RSS' },
  { value: 'exclude', label: 'Exclude from RSS' },
];

const POLICY_LABELS = {
  moderated: 'Moderated',
  open: 'Unmoderated',
  disabled: 'No comments',
  always_ask: 'Ask per post',
  include: 'Included',
  exclude: 'Excluded',
  inherit: 'Inherit category default',
};

const STATUS_BADGE = {
  published: { cls: 'active', label: 'Published' },
  draft: { cls: 'draft', label: 'Draft' },
  scheduled: { cls: '', style: { background: '#eff6ff', color: '#1d4ed8' }, label: 'Scheduled' },
  expired: { cls: 'disabled', label: 'Expired' },
  pending: { cls: '', style: { background: '#fef3c7', color: '#92400e' }, label: 'Pending' },
  approved: { cls: 'active', label: 'Approved' },
  rejected: { cls: 'disabled', label: 'Rejected' },
};

const EMPTY_CATEGORY = {
  name: '',
  description: '',
  header_text: '',
  comment_policy: 'moderated',
  allow_subscriptions: true,
  rss_policy: 'always_ask',
  show_on_home: true,
  sort_order: 0,
  is_public: true,
};

const EMPTY_POST = {
  category_id: '',
  title: '',
  author_name: '',
  lead_in: '',
  body: '',
  tags_text: '',
  publish_at: '',
  expires_at: '',
  is_featured: false,
  is_published: true,
  include_in_rss: true,
  comment_policy_override: 'inherit',
  notify_subscribers: false,
};

const BLOG_NOTIFICATION_EVENTS = [
  {
    key: 'blog_published',
    label: 'Blog Post Published',
    description: 'Sent to configured staff recipients whenever a blog article goes live.',
  },
  {
    key: 'blog_comment_pending',
    label: 'Resident Comment Awaiting Moderation',
    description: 'Sent to configured staff recipients when a resident submits a moderated comment.',
  },
];

function toDatetimeLocalValue(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function BlogManagePage({ initialTab = 'posts' }) {
  const [tab, setTab] = useState(initialTab || 'posts');
  const [categories, setCategories] = useState([]);
  const [posts, setPosts] = useState([]);
  const [commentData, setCommentData] = useState({ items: [], counts: { pending: 0, approved: 0, rejected: 0 } });

  const [homeBlogEnabled, setHomeBlogEnabled] = useState(true);
  const [homeBlogCount, setHomeBlogCount] = useState(3);
  const [homeBlogStyle, setHomeBlogStyle] = useState('cards');
  const [homeBlogPosition, setHomeBlogPosition] = useState('below_services');
  const [homeBlogHeading, setHomeBlogHeading] = useState('');
  const [savingHomeBlog, setSavingHomeBlog] = useState(false);

  useEffect(() => {
    setTab(initialTab || 'posts');
  }, [initialTab]);

  const [catFilter, setCatFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [q, setQ] = useState('');
  const [commentFilter, setCommentFilter] = useState('pending');

  const [postForm, setPostForm] = useState({ ...EMPTY_POST });
  const [editPostId, setEditPostId] = useState(null);
  const [editingPostObj, setEditingPostObj] = useState(null);
  const [postImageFile, setPostImageFile] = useState(null);
  const [postImageInputKey, setPostImageInputKey] = useState(0);

  const [catForm, setCatForm] = useState({ ...EMPTY_CATEGORY });
  const [editCatId, setEditCatId] = useState(null);
  const [editingCatObj, setEditingCatObj] = useState(null);
  const [catImageFile, setCatImageFile] = useState(null);
  const [catImageInputKey, setCatImageInputKey] = useState(0);

  const [saving, setSaving] = useState(false);
  const showToast = useToast();

  const loadCategories = useCallback(async () => {
    const rows = await api('/api/blog/categories');
    const list = Array.isArray(rows) ? rows : [];
    setCategories(list);
    setPostForm((f) => {
      if (f.category_id || !list.length) return f;
      return { ...f, category_id: String(list[0].id) };
    });
  }, []);

  const loadPosts = useCallback(async () => {
    const params = new URLSearchParams();
    if (catFilter) params.set('category_id', catFilter);
    if (statusFilter) params.set('status', statusFilter);
    if (q.trim()) params.set('q', q.trim());
    const qs = params.toString() ? `?${params.toString()}` : '';
    const rows = await api(`/api/blog/posts${qs}`);
    setPosts(Array.isArray(rows) ? rows : []);
  }, [catFilter, statusFilter, q]);

  const loadComments = useCallback(async () => {
    const qs = commentFilter ? `?status=${encodeURIComponent(commentFilter)}` : '?status=all';
    const d = await api(`/api/blog/comments${qs}`);
    setCommentData({
      items: Array.isArray(d?.items) ? d.items : [],
      counts: d?.counts || { pending: 0, approved: 0, rejected: 0 },
    });
  }, [commentFilter]);

  useEffect(() => {
    loadCategories().catch((e) => showToast(e.message, 'error'));
  }, [loadCategories, showToast]);

  useEffect(() => {
    loadPosts().catch((e) => showToast(e.message, 'error'));
  }, [loadPosts, showToast]);

  useEffect(() => {
    loadComments().catch((e) => showToast(e.message, 'error'));
  }, [loadComments, showToast]);

  useEffect(() => {
    api('/api/branding')
      .then((b) => {
        setHomeBlogEnabled(b?.home_blog_enabled !== false);
        setHomeBlogCount(Number(b?.home_blog_count) || 3);
        setHomeBlogStyle(b?.home_blog_style === 'full' ? 'full' : 'cards');
        setHomeBlogPosition(b?.home_blog_position === 'above_services' ? 'above_services' : 'below_services');
        setHomeBlogHeading(b?.home_blog_heading || '');
      })
      .catch(() => {});
  }, []);

  const handleSaveHomeBlogSettings = async (e) => {
    e.preventDefault();
    setSavingHomeBlog(true);
    try {
      const saved = await api('/api/branding/home-text', {
        method: 'PUT',
        body: JSON.stringify({
          home_blog_enabled: homeBlogEnabled,
          home_blog_count: Math.max(1, Math.min(20, Number(homeBlogCount) || 3)),
          home_blog_style: homeBlogStyle,
          home_blog_position: homeBlogPosition,
          home_blog_heading: homeBlogHeading.trim(),
        }),
      });
      setHomeBlogEnabled(saved?.home_blog_enabled !== false);
      setHomeBlogCount(Number(saved?.home_blog_count) || 3);
      setHomeBlogStyle(saved?.home_blog_style === 'full' ? 'full' : 'cards');
      setHomeBlogPosition(saved?.home_blog_position === 'above_services' ? 'above_services' : 'below_services');
      setHomeBlogHeading(saved?.home_blog_heading || '');
      showToast('Main page blog display settings saved', 'ok');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSavingHomeBlog(false);
    }
  };

  const selectedCategory = useMemo(
    () => categories.find((c) => String(c.id) === String(postForm.category_id)) || null,
    [categories, postForm.category_id]
  );

  const parsedTagsPreview = useMemo(
    () => (postForm.tags_text || '').split(',').map((t) => t.trim()).filter(Boolean),
    [postForm.tags_text]
  );

  const resetPostForm = () => {
    setEditPostId(null);
    setEditingPostObj(null);
    setPostImageFile(null);
    setPostImageInputKey((k) => k + 1);
    setPostForm({
      ...EMPTY_POST,
      category_id: categories[0] ? String(categories[0].id) : '',
    });
  };

  const handleSavePost = async (e) => {
    e.preventDefault();
    if (!postForm.title.trim()) return;
    const catId = Number(postForm.category_id);
    if (!catId) {
      showToast('Create or select a blog category first', 'error');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        category_id: catId,
        title: postForm.title.trim(),
        author_name: postForm.author_name.trim(),
        lead_in: postForm.lead_in.trim(),
        body: postForm.body.trim(),
        tags: postForm.tags_text,
        publish_at: postForm.publish_at ? new Date(postForm.publish_at).toISOString() : null,
        expires_at: postForm.expires_at || '',
        is_featured: Boolean(postForm.is_featured),
        is_published: Boolean(postForm.is_published),
        include_in_rss: Boolean(postForm.include_in_rss),
        comment_policy_override: postForm.comment_policy_override || 'inherit',
        notify_subscribers: Boolean(postForm.notify_subscribers && postForm.is_published),
      };
      let saved;
      if (editPostId) {
        saved = await api(`/api/blog/posts/${editPostId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        showToast('Blog post updated', 'ok');
      } else {
        saved = await api('/api/blog/posts', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        showToast('Blog post saved', 'ok');
      }
      if (postImageFile && saved?.id) {
        const fd = new FormData();
        fd.append('file', postImageFile);
        await api(`/api/blog/posts/${saved.id}/image`, { method: 'POST', body: fd });
      }
      resetPostForm();
      await Promise.all([loadPosts(), loadCategories()]);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const startEditPost = (p) => {
    setTab('posts');
    setEditPostId(p.id);
    setEditingPostObj(p);
    setPostImageFile(null);
    setPostImageInputKey((k) => k + 1);
    setPostForm({
      category_id: String(p.category_id),
      title: p.title || '',
      author_name: p.author_name || '',
      lead_in: p.lead_in || '',
      body: p.body || '',
      tags_text: Array.isArray(p.tags) ? p.tags.join(', ') : '',
      publish_at: toDatetimeLocalValue(p.publish_at),
      expires_at: p.expires_at || '',
      is_featured: Boolean(p.is_featured),
      is_published: Boolean(p.is_published),
      include_in_rss: Boolean(p.include_in_rss),
      comment_policy_override: p.comment_policy_override || 'inherit',
      notify_subscribers: false,
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const resetCategoryForm = () => {
    setEditCatId(null);
    setEditingCatObj(null);
    setCatImageFile(null);
    setCatImageInputKey((k) => k + 1);
    setCatForm({ ...EMPTY_CATEGORY });
  };

  const handleSaveCategory = async (e) => {
    e.preventDefault();
    if (!catForm.name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        ...catForm,
        name: catForm.name.trim(),
        description: catForm.description.trim(),
        header_text: catForm.header_text.trim(),
        sort_order: Number(catForm.sort_order) || 0,
      };
      let saved;
      if (editCatId) {
        saved = await api(`/api/blog/categories/${editCatId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        showToast('Blog category updated', 'ok');
      } else {
        saved = await api('/api/blog/categories', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        showToast('Blog category created', 'ok');
      }
      if (catImageFile && saved?.id) {
        const fd = new FormData();
        fd.append('file', catImageFile);
        await api(`/api/blog/categories/${saved.id}/image`, { method: 'POST', body: fd });
      }
      resetCategoryForm();
      await Promise.all([loadCategories(), loadPosts()]);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const startEditCategory = (c) => {
    setTab('categories');
    setEditCatId(c.id);
    setEditingCatObj(c);
    setCatImageFile(null);
    setCatImageInputKey((k) => k + 1);
    setCatForm({
      name: c.name || '',
      description: c.description || '',
      header_text: c.header_text || '',
      comment_policy: c.comment_policy || 'moderated',
      allow_subscriptions: Boolean(c.allow_subscriptions),
      rss_policy: c.rss_policy || 'always_ask',
      show_on_home: Boolean(c.show_on_home),
      sort_order: Number(c.sort_order) || 0,
      is_public: Boolean(c.is_public),
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const pendingCount = commentData.counts?.pending || 0;

  return (
    <section id="section-blog-manage">
      <div className="between" style={{ marginBottom: '1rem' }}>
        <h1 style={{ margin: 0 }}>Blog &amp; Community Articles</h1>
        <div className="actions">
          <a href="/api/blog/rss.xml" target="_blank" rel="noreferrer" className="btn sm">RSS Feed XML</a>
          <a href="/blog" target="_blank" rel="noreferrer" className="btn sm">View Public Blog</a>
        </div>
      </div>

      <div className="tabs">
        <button
          type="button"
          className={`btn sm${tab === 'posts' ? ' active' : ''}`}
          onClick={() => setTab('posts')}
        >
          Blog Posts ({posts.length})
        </button>
        <button
          type="button"
          className={`btn sm${tab === 'categories' ? ' active' : ''}`}
          onClick={() => setTab('categories')}
        >
          Categories &amp; Custom Headers ({categories.length})
        </button>
        <button
          type="button"
          className={`btn sm${tab === 'comments' ? ' active' : ''}`}
          onClick={() => setTab('comments')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem' }}
        >
          <span>Comment Moderation</span>
          {pendingCount > 0 && (
            <span className="badge" style={{ background: '#fef3c7', color: '#92400e' }}>{pendingCount}</span>
          )}
        </button>
        <button
          type="button"
          className={`btn sm${tab === 'settings' ? ' active' : ''}`}
          onClick={() => setTab('settings')}
        >
          Main Page Display &amp; Settings
        </button>
      </div>

      {tab === 'posts' && (
        <>
          <div className="card">
            <h2>{editPostId ? 'Edit Blog Post' : 'Create Blog Post'}</h2>
            {categories.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                Create a blog category first under the <strong>Categories &amp; Custom Headers</strong> tab before adding posts.
              </p>
            ) : (
              <form onSubmit={handleSavePost}>
                <div className="row" style={{ marginBottom: '.75rem' }}>
                  <div className="field" style={{ flex: 2, minWidth: 230 }}>
                    <label htmlFor="blog-post-title">Post Title *</label>
                    <input
                      id="blog-post-title"
                      required
                      placeholder="e.g. Spring Parks Improvement Schedule & Trail Updates"
                      value={postForm.title}
                      onChange={(e) => setPostForm((f) => ({ ...f, title: e.target.value }))}
                    />
                  </div>
                  <div className="field" style={{ flex: 1, minWidth: 180 }}>
                    <label htmlFor="blog-post-cat">Blog Category *</label>
                    <select
                      id="blog-post-cat"
                      value={postForm.category_id}
                      onChange={(e) => setPostForm((f) => ({ ...f, category_id: e.target.value }))}
                    >
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="field" style={{ flex: 1, minWidth: 160 }}>
                    <label htmlFor="blog-post-author">Author / Department Byline</label>
                    <input
                      id="blog-post-author"
                      placeholder="e.g. City Administrator"
                      value={postForm.author_name}
                      onChange={(e) => setPostForm((f) => ({ ...f, author_name: e.target.value }))}
                    />
                  </div>
                </div>

                <div className="field" style={{ marginBottom: '.75rem' }}>
                  <label htmlFor="blog-post-lead">Lead-In Summary (displayed on Blog overview &amp; RSS preview)</label>
                  <textarea
                    id="blog-post-lead"
                    rows={2}
                    placeholder="Concise 1–2 sentence introduction shown in feed cards..."
                    value={postForm.lead_in}
                    onChange={(e) => setPostForm((f) => ({ ...f, lead_in: e.target.value }))}
                  />
                </div>

                <div style={{ marginBottom: '.75rem' }}>
                  <RichTextEditor
                    id="blog-post-body"
                    label="Full Post Content (Rich Custom Formatting)"
                    rows={10}
                    placeholder="Write your article using headings, bullet lists, callouts, links, or dividers..."
                    value={postForm.body}
                    onChange={(next) => setPostForm((f) => ({ ...f, body: next }))}
                    helpText="Supports headings (H2/H3), bold, italic, bullet/numbered lists, quote callouts, links, and horizontal dividers."
                  />
                </div>

                <div className="row" style={{ marginBottom: '.75rem' }}>
                  <div className="field" style={{ flex: 2, minWidth: 220 }}>
                    <label htmlFor="blog-post-tags">Tags (comma-separated keywords)</label>
                    <input
                      id="blog-post-tags"
                      placeholder="e.g. Public Works, Parks, Budget"
                      value={postForm.tags_text}
                      onChange={(e) => setPostForm((f) => ({ ...f, tags_text: e.target.value }))}
                    />
                    {parsedTagsPreview.length > 0 && (
                      <div style={{ display: 'flex', gap: '.3rem', flexWrap: 'wrap', marginTop: '.25rem' }}>
                        {parsedTagsPreview.map((t, idx) => (
                          <span key={`${t}-${idx}`} className="badge draft">{t}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="field" style={{ minWidth: 190 }}>
                    <label htmlFor="blog-post-start">Start Display Date / Time</label>
                    <input
                      id="blog-post-start"
                      type="datetime-local"
                      value={postForm.publish_at}
                      onChange={(e) => setPostForm((f) => ({ ...f, publish_at: e.target.value }))}
                    />
                  </div>
                  <div className="field" style={{ minWidth: 160 }}>
                    <label htmlFor="blog-post-stop">Stop Display Date (optional)</label>
                    <input
                      id="blog-post-stop"
                      type="date"
                      value={postForm.expires_at}
                      onChange={(e) => setPostForm((f) => ({ ...f, expires_at: e.target.value }))}
                    />
                  </div>
                </div>

                <div className="row" style={{ marginBottom: '.75rem', alignItems: 'flex-start' }}>
                  <div className="field" style={{ flex: 1, minWidth: 230 }}>
                    <label htmlFor="blog-post-img">Featured Cover Image (PNG, JPEG, GIF, WEBP)</label>
                    <input
                      key={postImageInputKey}
                      id="blog-post-img"
                      type="file"
                      accept="image/png,image/jpeg,image/gif,image/webp,.png,.jpg,.jpeg,.gif,.webp"
                      onChange={(e) => setPostImageFile(e.target.files?.[0] || null)}
                    />
                    {editingPostObj?.has_image && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginTop: '.35rem' }}>
                        <img
                          src={`${editingPostObj.image_url}?v=${editingPostObj.updated_at || ''}`}
                          alt={editingPostObj.title}
                          style={{ height: 48, width: 72, objectFit: 'cover', borderRadius: 4, border: '1px solid #cbd5e1' }}
                        />
                        <button
                          type="button"
                          className="btn sm danger"
                          onClick={async () => {
                            const updated = await api(`/api/blog/posts/${editingPostObj.id}/image`, { method: 'DELETE' });
                            setEditingPostObj(updated);
                            await loadPosts();
                            showToast('Cover image removed', 'ok');
                          }}
                        >
                          Remove Image
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="field" style={{ flex: 1, minWidth: 200 }}>
                    <label htmlFor="blog-post-comments">Comment Setting Override</label>
                    <select
                      id="blog-post-comments"
                      value={postForm.comment_policy_override}
                      onChange={(e) => setPostForm((f) => ({ ...f, comment_policy_override: e.target.value }))}
                    >
                      <option value="inherit">
                        Inherit Category ({POLICY_LABELS[selectedCategory?.comment_policy || 'moderated']})
                      </option>
                      {COMMENT_POLICY_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap', marginBottom: '.85rem' }}>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem', cursor: 'pointer', fontSize: '.9rem' }}>
                    <input
                      type="checkbox"
                      style={{ width: 'auto', flexShrink: 0 }}
                      checked={postForm.is_published}
                      onChange={(e) => setPostForm((f) => ({ ...f, is_published: e.target.checked }))}
                    />
                    <span>Published on Public Portal</span>
                  </label>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem', cursor: 'pointer', fontSize: '.9rem' }}>
                    <input
                      type="checkbox"
                      style={{ width: 'auto', flexShrink: 0 }}
                      checked={postForm.is_featured}
                      onChange={(e) => setPostForm((f) => ({ ...f, is_featured: e.target.checked }))}
                    />
                    <span>Pin / Feature Post</span>
                  </label>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem', cursor: 'pointer', fontSize: '.9rem' }}>
                    <input
                      type="checkbox"
                      style={{ width: 'auto', flexShrink: 0 }}
                      disabled={selectedCategory?.rss_policy === 'include' || selectedCategory?.rss_policy === 'exclude'}
                      checked={
                        selectedCategory?.rss_policy === 'include'
                          ? true
                          : (selectedCategory?.rss_policy === 'exclude' ? false : postForm.include_in_rss)
                      }
                      onChange={(e) => setPostForm((f) => ({ ...f, include_in_rss: e.target.checked }))}
                    />
                    <span>
                      Include in RSS Feed
                      {selectedCategory?.rss_policy === 'include' && ' (Forced by Category)'}
                      {selectedCategory?.rss_policy === 'exclude' && ' (Excluded by Category)'}
                    </span>
                  </label>
                  {selectedCategory?.allow_subscriptions !== false && (
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem', cursor: 'pointer', fontSize: '.9rem' }}>
                      <input
                        type="checkbox"
                        style={{ width: 'auto', flexShrink: 0 }}
                        disabled={!postForm.is_published}
                        checked={postForm.notify_subscribers && postForm.is_published}
                        onChange={(e) => setPostForm((f) => ({ ...f, notify_subscribers: e.target.checked }))}
                      />
                      <span>Notify Blog Subscribers on Save</span>
                    </label>
                  )}
                </div>

                <div className="actions">
                  <button type="submit" className="btn primary" disabled={saving}>
                    {saving ? 'Saving…' : (editPostId ? 'Save Changes' : (postForm.is_published ? 'Save & Publish Post' : 'Save Draft'))}
                  </button>
                  {editPostId && (
                    <button type="button" className="btn" onClick={resetPostForm}>
                      Cancel
                    </button>
                  )}
                </div>
              </form>
            )}
          </div>

          <div className="card">
            <div className="between" style={{ marginBottom: '.85rem', flexWrap: 'wrap', gap: '.5rem' }}>
              <h2 style={{ margin: 0 }}>All Blog Posts ({posts.length})</h2>
              <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
                <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} style={{ width: 'auto' }}>
                  <option value="">All Categories</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ width: 'auto' }}>
                  <option value="">All Statuses</option>
                  <option value="published">Published</option>
                  <option value="draft">Draft</option>
                  <option value="scheduled">Scheduled</option>
                  <option value="expired">Expired</option>
                </select>
                <input
                  placeholder="Search posts or tags…"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  style={{ minWidth: 200 }}
                />
              </div>
            </div>

            {posts.length === 0 ? (
              <p className="muted">No matching blog posts yet.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Post</th>
                    <th>Category</th>
                    <th>Display Window</th>
                    <th>Comments</th>
                    <th>Status</th>
                    <th style={{ width: 210 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {posts.map((p) => {
                    const st = STATUS_BADGE[p.computed_status] || STATUS_BADGE.draft;
                    return (
                      <tr key={p.id}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem' }}>
                            {p.has_image && (
                              <img
                                src={`${p.image_url}?v=${p.updated_at || ''}`}
                                alt=""
                                style={{ width: 46, height: 36, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }}
                              />
                            )}
                            <div>
                              <strong>{p.title}</strong>
                              {p.is_featured && (
                                <span className="badge" style={{ marginLeft: '.35rem', background: '#fef3c7', color: '#92400e' }}>
                                  Featured
                                </span>
                              )}
                              {p.lead_in && <div className="muted" style={{ fontSize: '.81rem' }}>{p.lead_in}</div>}
                              {Array.isArray(p.tags) && p.tags.length > 0 && (
                                <div style={{ display: 'flex', gap: '.25rem', flexWrap: 'wrap', marginTop: '.2rem' }}>
                                  {p.tags.map((t) => (
                                    <span key={t} className="badge draft" style={{ fontSize: '.72rem' }}>{t}</span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td><span className="badge draft">{p.category_name}</span></td>
                        <td className="muted" style={{ fontSize: '.82rem' }}>
                          <div>Start: {formatDate(p.publish_at)}</div>
                          {p.expires_at && <div>Stop: {p.expires_at}</div>}
                          <div>RSS: {p.in_rss ? 'Yes' : 'No'}</div>
                        </td>
                        <td className="muted" style={{ fontSize: '.82rem' }}>
                          <div>{POLICY_LABELS[p.effective_comment_policy] || p.effective_comment_policy}</div>
                          <div>
                            {p.approved_comment_count} approved
                            {p.pending_comment_count > 0 ? ` · ${p.pending_comment_count} pending` : ''}
                          </div>
                        </td>
                        <td>
                          <span className={`badge ${st.cls || ''}`} style={st.style}>
                            {st.label}
                          </span>
                        </td>
                        <td>
                          <div className="actions">
                            <button type="button" className="btn sm" onClick={() => startEditPost(p)}>Edit</button>
                            <button
                              type="button"
                              className="btn sm"
                              onClick={async () => {
                                await api(`/api/blog/posts/${p.id}`, {
                                  method: 'PATCH',
                                  body: JSON.stringify({ is_published: !p.is_published }),
                                });
                                await Promise.all([loadPosts(), loadCategories()]);
                              }}
                            >
                              {p.is_published ? 'Unpublish' : 'Publish'}
                            </button>
                            <button
                              type="button"
                              className="btn sm danger"
                              onClick={async () => {
                                if (!window.confirm(`Delete post "${p.title}"?`)) return;
                                await api(`/api/blog/posts/${p.id}`, { method: 'DELETE' });
                                await Promise.all([loadPosts(), loadCategories()]);
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {tab === 'categories' && (
        <>
          <div className="card">
            <h2>{editCatId ? 'Edit Blog Category' : 'Add Blog Category'}</h2>
            <form onSubmit={handleSaveCategory}>
              <div className="row" style={{ marginBottom: '.75rem' }}>
                <div className="field" style={{ flex: 2, minWidth: 210 }}>
                  <label htmlFor="blog-cat-name">Blog Category Name *</label>
                  <input
                    id="blog-cat-name"
                    required
                    placeholder="e.g. Mayor's Corner, Public Works Updates"
                    value={catForm.name}
                    onChange={(e) => setCatForm((f) => ({ ...f, name: e.target.value }))}
                  />
                </div>
                <div className="field" style={{ flex: 1, minWidth: 180 }}>
                  <label htmlFor="blog-cat-comments">Comments Option</label>
                  <select
                    id="blog-cat-comments"
                    value={catForm.comment_policy}
                    onChange={(e) => setCatForm((f) => ({ ...f, comment_policy: e.target.value }))}
                  >
                    {COMMENT_POLICY_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div className="field" style={{ flex: 1, minWidth: 180 }}>
                  <label htmlFor="blog-cat-rss">RSS Feed Behavior</label>
                  <select
                    id="blog-cat-rss"
                    value={catForm.rss_policy}
                    onChange={(e) => setCatForm((f) => ({ ...f, rss_policy: e.target.value }))}
                  >
                    {RSS_POLICY_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div className="field" style={{ width: 90 }}>
                  <label htmlFor="blog-cat-order">Order</label>
                  <input
                    id="blog-cat-order"
                    type="number"
                    value={catForm.sort_order}
                    onChange={(e) => setCatForm((f) => ({ ...f, sort_order: e.target.value }))}
                  />
                </div>
              </div>

              <div className="field" style={{ marginBottom: '.75rem' }}>
                <label htmlFor="blog-cat-desc">Short Description</label>
                <input
                  id="blog-cat-desc"
                  placeholder="Brief summary of what this blog category covers..."
                  value={catForm.description}
                  onChange={(e) => setCatForm((f) => ({ ...f, description: e.target.value }))}
                />
              </div>

              <div style={{ marginBottom: '.75rem' }}>
                <RichTextEditor
                  id="blog-cat-header"
                  label="Custom Page / Category Header Text"
                  rows={6}
                  placeholder="Add custom formatted text shown at the top of this blog category page..."
                  value={catForm.header_text}
                  onChange={(next) => setCatForm((f) => ({ ...f, header_text: next }))}
                  helpText="Appears above posts whenever residents filter or browse this category."
                />
              </div>

              <div className="field" style={{ marginBottom: '.75rem' }}>
                <label htmlFor="blog-cat-img">Category Banner Image (PNG, JPEG, GIF, WEBP)</label>
                <input
                  key={catImageInputKey}
                  id="blog-cat-img"
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp,.png,.jpg,.jpeg,.gif,.webp"
                  style={{ width: 'auto' }}
                  onChange={(e) => setCatImageFile(e.target.files?.[0] || null)}
                />
                {editingCatObj?.has_image && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginTop: '.35rem' }}>
                    <img
                      src={`${editingCatObj.image_url}?v=${editingCatObj.updated_at || ''}`}
                      alt={editingCatObj.name}
                      style={{ height: 52, width: 96, objectFit: 'cover', borderRadius: 4, border: '1px solid #cbd5e1' }}
                    />
                    <button
                      type="button"
                      className="btn sm danger"
                      onClick={async () => {
                        const updated = await api(`/api/blog/categories/${editingCatObj.id}/image`, { method: 'DELETE' });
                        setEditingCatObj(updated);
                        await loadCategories();
                        showToast('Category image removed', 'ok');
                      }}
                    >
                      Remove Image
                    </button>
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap', marginBottom: '.85rem' }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem', cursor: 'pointer', fontSize: '.9rem' }}>
                  <input
                    type="checkbox"
                    style={{ width: 'auto', flexShrink: 0 }}
                    checked={catForm.is_public}
                    onChange={(e) => setCatForm((f) => ({ ...f, is_public: e.target.checked }))}
                  />
                  <span>Visible on Public Portal</span>
                </label>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem', cursor: 'pointer', fontSize: '.9rem' }}>
                  <input
                    type="checkbox"
                    style={{ width: 'auto', flexShrink: 0 }}
                    checked={catForm.allow_subscriptions}
                    onChange={(e) => setCatForm((f) => ({ ...f, allow_subscriptions: e.target.checked }))}
                  />
                  <span>Allow Email Subscriptions</span>
                </label>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem', cursor: 'pointer', fontSize: '.9rem' }}>
                  <input
                    type="checkbox"
                    style={{ width: 'auto', flexShrink: 0 }}
                    checked={catForm.show_on_home}
                    onChange={(e) => setCatForm((f) => ({ ...f, show_on_home: e.target.checked }))}
                  />
                  <span>Show Posts on Portal Homepage Feed</span>
                </label>
              </div>

              <div className="actions">
                <button type="submit" className="btn primary" disabled={saving}>
                  {saving ? 'Saving…' : (editCatId ? 'Save Category' : 'Add Category')}
                </button>
                {editCatId && (
                  <button type="button" className="btn" onClick={resetCategoryForm}>
                    Cancel
                  </button>
                )}
              </div>
            </form>
          </div>

          <div className="card">
            <h2>Blog Categories ({categories.length})</h2>
            <table>
              <thead>
                <tr>
                  <th>Name &amp; Description</th>
                  <th>Comments</th>
                  <th>RSS Policy</th>
                  <th>Posts</th>
                  <th>Visibility</th>
                  <th style={{ width: 210 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {categories.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <strong>{c.name}</strong>
                      {c.description && <div className="muted" style={{ fontSize: '.81rem' }}>{c.description}</div>}
                    </td>
                    <td><span className="badge draft">{POLICY_LABELS[c.comment_policy] || c.comment_policy}</span></td>
                    <td><span className="badge draft">{POLICY_LABELS[c.rss_policy] || c.rss_policy}</span></td>
                    <td className="muted">{c.published_count} published / {c.post_count} total</td>
                    <td>
                      <span className={`badge ${c.is_public ? 'active' : 'disabled'}`}>
                        {c.is_public ? 'Public' : 'Hidden'}
                      </span>
                    </td>
                    <td>
                      <div className="actions">
                        <a
                          href={`/api/blog/rss.xml?category=${encodeURIComponent(c.slug)}`}
                          target="_blank"
                          rel="noreferrer"
                          className="btn sm"
                        >
                          RSS
                        </a>
                        <button type="button" className="btn sm" onClick={() => startEditCategory(c)}>Edit</button>
                        <button
                          type="button"
                          className="btn sm danger"
                          onClick={async () => {
                            if (!window.confirm(`Delete category "${c.name}" and all of its posts and comments?`)) return;
                            await api(`/api/blog/categories/${c.id}`, { method: 'DELETE' });
                            await Promise.all([loadCategories(), loadPosts(), loadComments()]);
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

      {tab === 'comments' && (
        <div className="card">
          <div className="between" style={{ marginBottom: '.85rem', flexWrap: 'wrap', gap: '.5rem' }}>
            <h2 style={{ margin: 0 }}>Resident Comment Moderation</h2>
            <div className="actions">
              {[
                { key: 'pending', label: `Pending (${commentData.counts.pending || 0})` },
                { key: 'approved', label: `Approved (${commentData.counts.approved || 0})` },
                { key: 'rejected', label: `Rejected (${commentData.counts.rejected || 0})` },
                { key: 'all', label: 'All' },
              ].map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  className={`btn sm${commentFilter === opt.key ? ' primary' : ''}`}
                  onClick={() => setCommentFilter(opt.key)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {commentData.items.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>No comments in this queue.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Author</th>
                  <th>Post</th>
                  <th>Comment</th>
                  <th>Status</th>
                  <th style={{ width: 220 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {commentData.items.map((cm) => {
                  const st = STATUS_BADGE[cm.status] || STATUS_BADGE.pending;
                  return (
                    <tr key={cm.id}>
                      <td>
                        <strong>{cm.author_name}</strong>
                        {cm.author_email && <div className="muted" style={{ fontSize: '.8rem' }}>{cm.author_email}</div>}
                        <div className="muted" style={{ fontSize: '.78rem' }}>{formatDate(cm.created_at)}</div>
                      </td>
                      <td>
                        <div style={{ fontWeight: 500 }}>{cm.post_title}</div>
                        <div className="muted" style={{ fontSize: '.78rem' }}>{cm.category_name}</div>
                      </td>
                      <td style={{ whiteSpace: 'pre-wrap', maxWidth: 340, fontSize: '.88rem' }}>{cm.body}</td>
                      <td>
                        <span className={`badge ${st.cls || ''}`} style={st.style}>{st.label}</span>
                      </td>
                      <td>
                        <div className="actions">
                          {cm.status !== 'approved' && (
                            <button
                              type="button"
                              className="btn sm primary"
                              onClick={async () => {
                                await api(`/api/blog/comments/${cm.id}`, {
                                  method: 'PATCH',
                                  body: JSON.stringify({ status: 'approved' }),
                                });
                                await Promise.all([loadComments(), loadPosts()]);
                              }}
                            >
                              Approve
                            </button>
                          )}
                          {cm.status !== 'rejected' && (
                            <button
                              type="button"
                              className="btn sm"
                              onClick={async () => {
                                await api(`/api/blog/comments/${cm.id}`, {
                                  method: 'PATCH',
                                  body: JSON.stringify({ status: 'rejected' }),
                                });
                                await Promise.all([loadComments(), loadPosts()]);
                              }}
                            >
                              Reject
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn sm danger"
                            onClick={async () => {
                              await api(`/api/blog/comments/${cm.id}`, { method: 'DELETE' });
                              await Promise.all([loadComments(), loadPosts()]);
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'settings' && (
        <>
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Main Page Blog Feed Display</h2>
            <p className="muted" style={{ marginTop: 0, fontSize: '.88rem' }}>
              Control whether recent blog entries appear on the public main page, how many entries to show, and how they are presented.
              Only categories with <strong>Show Posts on Portal Homepage Feed</strong> enabled appear on the main page.
            </p>
            <form onSubmit={handleSaveHomeBlogSettings}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginBottom: homeBlogEnabled ? '.85rem' : '1rem', cursor: 'pointer', fontWeight: 600 }}>
                <input
                  type="checkbox"
                  style={{ width: 'auto' }}
                  checked={homeBlogEnabled}
                  onChange={(e) => setHomeBlogEnabled(e.target.checked)}
                />
                <span>Show recent blog entries on the main page</span>
              </label>
              {homeBlogEnabled && (
                <div className="row" style={{ marginBottom: '1rem' }}>
                  <div className="field" style={{ width: 150 }}>
                    <label htmlFor="blog-adm-home-count">Entries to Show (1–20)</label>
                    <input
                      id="blog-adm-home-count"
                      type="number"
                      min={1}
                      max={20}
                      value={homeBlogCount}
                      onChange={(e) => setHomeBlogCount(e.target.value)}
                    />
                  </div>
                  <div className="field" style={{ flex: 1, minWidth: 180 }}>
                    <label htmlFor="blog-adm-home-style">Display Style</label>
                    <select
                      id="blog-adm-home-style"
                      value={homeBlogStyle}
                      onChange={(e) => setHomeBlogStyle(e.target.value)}
                    >
                      <option value="cards">Summary Cards</option>
                      <option value="full">Full Blog Entries</option>
                    </select>
                  </div>
                  <div className="field" style={{ flex: 1, minWidth: 180 }}>
                    <label htmlFor="blog-adm-home-pos">Placement</label>
                    <select
                      id="blog-adm-home-pos"
                      value={homeBlogPosition}
                      onChange={(e) => setHomeBlogPosition(e.target.value)}
                    >
                      <option value="below_services">Below City Services</option>
                      <option value="above_services">Above City Services</option>
                    </select>
                  </div>
                  <div className="field" style={{ flex: 1, minWidth: 200 }}>
                    <label htmlFor="blog-adm-home-heading">Section Heading (optional)</label>
                    <input
                      id="blog-adm-home-heading"
                      placeholder="Latest from the Blog"
                      value={homeBlogHeading}
                      onChange={(e) => setHomeBlogHeading(e.target.value)}
                    />
                  </div>
                </div>
              )}
              <button type="submit" className="btn primary" disabled={savingHomeBlog}>
                {savingHomeBlog ? 'Saving…' : 'Save Display Settings'}
              </button>
            </form>
          </div>

          <ModuleNotificationsCard
            moduleId="blog"
            title="Blog Email Notifications"
            events={BLOG_NOTIFICATION_EVENTS}
          />
        </>
      )}
    </section>
  );
}
