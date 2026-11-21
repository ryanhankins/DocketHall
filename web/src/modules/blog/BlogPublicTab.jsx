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
import { formatDate } from '../../core/api.js';
import ServiceIcon from '../../core/ServiceIcon.jsx';
import RichTextContent from '../../core/RichTextContent.jsx';
import RichTextEditor from '../../core/RichTextEditor.jsx';

const COMMENT_POLICY_LABELS = {
  disabled: 'Comments Closed',
  moderated: 'Moderated Comments',
  open: 'Open Comments',
};

async function jsonReq(url, opts = {}) {
  const res = await fetch(url, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `Request failed (${res.status})`);
  return data;
}

export default function BlogPublicTab({ me, initialPostSlug = '', onSlugChange }) {
  const canManage = Boolean(
    me && Array.isArray(me.permissions) && (me.permissions.includes('*') || me.permissions.includes('blog.manage'))
  );

  const [liveEdit, setLiveEdit] = useState(false);
  const [categories, setCategories] = useState([]);
  const [posts, setPosts] = useState([]);
  const [tags, setTags] = useState([]);
  const [loading, setLoading] = useState(true);

  const [selectedCat, setSelectedCat] = useState('');
  const [selectedTag, setSelectedTag] = useState('');
  const [q, setQ] = useState('');

  const [activePostSlug, setActivePostSlug] = useState(initialPostSlug || '');
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [cName, setCName] = useState('');
  const [cEmail, setCEmail] = useState('');
  const [cBody, setCBody] = useState('');
  const [cWebsite, setCWebsite] = useState('');
  const [cBusy, setCBusy] = useState(false);
  const [cMsg, setCMsg] = useState({ text: '', isError: false });

  const [subOpen, setSubOpen] = useState(false);
  const [subEmail, setSubEmail] = useState('');
  const [subBusy, setSubBusy] = useState(false);
  const [subMsg, setSubMsg] = useState({ text: '', isError: false });

  const [postModal, setPostModal] = useState(null);
  const [catModal, setCatModal] = useState(null);
  const [modalBusy, setModalBusy] = useState(false);
  const [modalErr, setModalErr] = useState('');

  useEffect(() => {
    if (initialPostSlug !== undefined && initialPostSlug !== activePostSlug) {
      setActivePostSlug(initialPostSlug || '');
    }
  }, [initialPostSlug, activePostSlug]);

  const selectPostSlug = useCallback((slug) => {
    setActivePostSlug(slug || '');
    onSlugChange?.(slug || '');
  }, [onSlugChange]);

  const loadFeed = useCallback(async () => {
    setLoading(true);
    try {
      if (liveEdit && canManage) {
        const [cats, allPosts] = await Promise.all([
          jsonReq('/api/blog/categories'),
          jsonReq(`/api/blog/posts${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`),
        ]);
        const catList = Array.isArray(cats) ? cats : [];
        let postList = Array.isArray(allPosts) ? allPosts : [];
        if (selectedCat) {
          postList = postList.filter((p) => p.category_slug === selectedCat);
        }
        if (selectedTag) {
          postList = postList.filter((p) => (p.tags || []).some((t) => t.toLowerCase() === selectedTag.toLowerCase()));
        }
        const tagSet = new Map();
        (Array.isArray(allPosts) ? allPosts : []).forEach((p) => {
          (p.tags || []).forEach((t) => {
            if (t && !tagSet.has(t.toLowerCase())) tagSet.set(t.toLowerCase(), t);
          });
        });
        setCategories(catList);
        setPosts(postList);
        setTags(Array.from(tagSet.values()).sort((a, b) => a.localeCompare(b)));
      } else {
        const params = new URLSearchParams();
        if (selectedCat) params.set('category', selectedCat);
        if (selectedTag) params.set('tag', selectedTag);
        if (q.trim()) params.set('q', q.trim());
        const qs = params.toString() ? `?${params.toString()}` : '';
        const d = await jsonReq(`/api/blog/public${qs}`);
        setCategories(Array.isArray(d.categories) ? d.categories : []);
        setPosts(Array.isArray(d.posts) ? d.posts : []);
        setTags(Array.isArray(d.tags) ? d.tags : []);
      }
    } catch {
      setCategories([]);
      setPosts([]);
      setTags([]);
    } finally {
      setLoading(false);
    }
  }, [liveEdit, canManage, selectedCat, selectedTag, q]);

  useEffect(() => {
    loadFeed();
  }, [loadFeed]);

  const loadPostDetail = useCallback(async () => {
    if (!activePostSlug) {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    setCMsg({ text: '', isError: false });
    try {
      const previewQs = canManage ? '?preview=1' : '';
      const d = await jsonReq(`/api/blog/public/posts/${encodeURIComponent(activePostSlug)}${previewQs}`);
      setDetail(d);
    } catch {
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, [activePostSlug, canManage]);

  useEffect(() => {
    loadPostDetail();
  }, [loadPostDetail]);

  const activeCategoryObj = useMemo(
    () => categories.find((c) => c.slug === selectedCat) || null,
    [categories, selectedCat]
  );

  const openNewPostModal = () => {
    const defaultCat = activeCategoryObj?.id || categories[0]?.id || '';
    setModalErr('');
    setPostModal({
      id: null,
      category_id: String(defaultCat),
      title: '',
      author_name: me?.username || '',
      lead_in: '',
      body: '',
      tags_text: '',
      is_featured: false,
      is_published: true,
      include_in_rss: true,
      notify_subscribers: false,
    });
  };

  const openEditPostModal = (post) => {
    setModalErr('');
    setPostModal({
      id: post.id,
      category_id: String(post.category_id),
      title: post.title || '',
      author_name: post.author_name || '',
      lead_in: post.lead_in || '',
      body: post.body || '',
      tags_text: Array.isArray(post.tags) ? post.tags.join(', ') : '',
      is_featured: Boolean(post.is_featured),
      is_published: Boolean(post.is_published),
      include_in_rss: Boolean(post.include_in_rss),
      notify_subscribers: false,
    });
  };

  const savePostModal = async (e) => {
    e.preventDefault();
    if (!postModal || !postModal.title.trim()) return;
    setModalBusy(true);
    setModalErr('');
    try {
      const payload = {
        category_id: Number(postModal.category_id),
        title: postModal.title.trim(),
        author_name: postModal.author_name.trim(),
        lead_in: postModal.lead_in.trim(),
        body: postModal.body.trim(),
        tags: postModal.tags_text,
        is_featured: Boolean(postModal.is_featured),
        is_published: Boolean(postModal.is_published),
        include_in_rss: Boolean(postModal.include_in_rss),
        notify_subscribers: Boolean(postModal.notify_subscribers && postModal.is_published),
      };
      const saved = postModal.id
        ? await jsonReq(`/api/blog/posts/${postModal.id}`, { method: 'PATCH', body: JSON.stringify(payload) })
        : await jsonReq('/api/blog/posts', { method: 'POST', body: JSON.stringify(payload) });
      setPostModal(null);
      await loadFeed();
      if (activePostSlug && saved?.slug) {
        selectPostSlug(saved.slug);
        await loadPostDetail();
      }
    } catch (err) {
      setModalErr(err.message);
    } finally {
      setModalBusy(false);
    }
  };

  const saveCatModal = async (e) => {
    e.preventDefault();
    if (!catModal || !catModal.name.trim()) return;
    setModalBusy(true);
    setModalErr('');
    try {
      await jsonReq(`/api/blog/categories/${catModal.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: catModal.name.trim(),
          description: catModal.description.trim(),
          header_text: catModal.header_text.trim(),
          comment_policy: catModal.comment_policy,
          rss_policy: catModal.rss_policy,
        }),
      });
      setCatModal(null);
      await Promise.all([loadFeed(), loadPostDetail()]);
    } catch (err) {
      setModalErr(err.message);
    } finally {
      setModalBusy(false);
    }
  };

  const handleCommentSubmit = async (e) => {
    e.preventDefault();
    if (!detail?.post?.id) return;
    setCBusy(true);
    setCMsg({ text: '', isError: false });
    try {
      const res = await jsonReq(`/api/blog/public/posts/${detail.post.id}/comments`, {
        method: 'POST',
        body: JSON.stringify({
          author_name: cName.trim(),
          author_email: cEmail.trim(),
          body: cBody.trim(),
          website: cWebsite,
        }),
      });
      setCName('');
      setCEmail('');
      setCBody('');
      setCWebsite('');
      setCMsg({ text: res.message || 'Comment submitted.', isError: false });
      await loadPostDetail();
    } catch (err) {
      setCMsg({ text: err.message, isError: true });
    } finally {
      setCBusy(false);
    }
  };

  const handleSubscribe = async (e) => {
    e.preventDefault();
    if (!subEmail.trim()) return;
    setSubBusy(true);
    setSubMsg({ text: '', isError: false });
    try {
      const res = await jsonReq('/api/subscriptions/subscribe', {
        method: 'POST',
        body: JSON.stringify({ email: subEmail.trim(), topics: ['blog'] }),
      });
      setSubEmail('');
      setSubMsg({ text: res.message || 'Subscribed to blog email alerts.', isError: false });
    } catch (err) {
      setSubMsg({ text: err.message, isError: true });
    } finally {
      setSubBusy(false);
    }
  };

  const rssUrl = selectedCat
    ? `/api/blog/rss.xml?category=${encodeURIComponent(selectedCat)}`
    : '/api/blog/rss.xml';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {canManage && (
        <div
          className="card"
          style={{
            background: liveEdit ? '#fff7ed' : '#f8fafc',
            borderColor: liveEdit ? '#fb923c' : '#cbd5e1',
            padding: '.75rem 1rem',
            marginBottom: 0,
          }}
        >
          <div className="between" style={{ gap: '.65rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.65rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                className={`btn sm${liveEdit ? ' primary' : ''}`}
                onClick={() => setLiveEdit((v) => !v)}
              >
                {liveEdit ? 'Live Edit: ON' : 'Live Edit: OFF'}
              </button>
              <span className="muted" style={{ fontSize: '.85rem' }}>
                {liveEdit
                  ? 'Live Edit active — create posts, edit custom category headers, and publish directly on this page.'
                  : 'Turn on Live Edit to add posts or customize page text right from this view.'}
              </span>
            </div>
            <div className="actions">
              {liveEdit && (
                <button type="button" className="btn sm primary" onClick={openNewPostModal}>
                  + New Blog Post
                </button>
              )}
              <a href="/app#blog-manage" className="btn sm">Blog Workspace →</a>
            </div>
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 0 }}>
        <div className="between" style={{ gap: '.75rem', marginBottom: '.75rem' }}>
          <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
            <ServiceIcon id="blog" size={20} badge />
            <span>Blog &amp; Community Updates</span>
          </h2>
          <div className="actions">
            <input
              type="search"
              placeholder="Search blog posts…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{ minWidth: 190 }}
            />
            <a href={rssUrl} target="_blank" rel="noreferrer" className="btn sm">
              RSS Feed
            </a>
            <button type="button" className="btn sm" onClick={() => setSubOpen((v) => !v)}>
              {subOpen ? 'Close Subscribe' : 'Subscribe by Email'}
            </button>
          </div>
        </div>

        {subOpen && (
          <form
            onSubmit={handleSubscribe}
            style={{
              background: '#f8fafc',
              border: '1px solid #cbd5e1',
              borderRadius: 8,
              padding: '.75rem .9rem',
              marginBottom: '.75rem',
            }}
          >
            <div className="row" style={{ alignItems: 'center', gap: '.5rem' }}>
              <input
                type="email"
                required
                placeholder="Enter your email for new blog post alerts…"
                value={subEmail}
                onChange={(e) => setSubEmail(e.target.value)}
                style={{ flex: 1, minWidth: 220 }}
              />
              <button type="submit" className="btn sm primary" disabled={subBusy}>
                {subBusy ? 'Subscribing…' : 'Subscribe'}
              </button>
            </div>
            {subMsg.text && (
              <div className={subMsg.isError ? 'error-msg' : 'ok-msg'} role="status">
                {subMsg.text}
              </div>
            )}
          </form>
        )}

        <div className="actions" style={{ marginBottom: tags.length ? '.55rem' : 0 }}>
          <button
            type="button"
            className={`btn sm${selectedCat === '' ? ' primary' : ''}`}
            onClick={() => { setSelectedCat(''); selectPostSlug(''); }}
          >
            All Categories
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`btn sm${selectedCat === c.slug ? ' primary' : ''}`}
              onClick={() => { setSelectedCat(c.slug); selectPostSlug(''); }}
            >
              {c.name} ({liveEdit ? c.post_count : c.published_count})
            </button>
          ))}
        </div>

        {tags.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '.35rem', flexWrap: 'wrap', paddingTop: '.25rem' }}>
            <span className="muted" style={{ fontSize: '.8rem' }}>Tags:</span>
            {selectedTag && (
              <button
                type="button"
                className="btn sm"
                onClick={() => setSelectedTag('')}
              >
                Clear Tag ({selectedTag}) ×
              </button>
            )}
            {tags.map((t) => (
              <button
                key={t}
                type="button"
                className={`btn sm${selectedTag.toLowerCase() === t.toLowerCase() ? ' primary' : ''}`}
                style={{ fontSize: '.78rem', padding: '.2rem .5rem' }}
                onClick={() => {
                  setSelectedTag((prev) => (prev.toLowerCase() === t.toLowerCase() ? '' : t));
                  selectPostSlug('');
                }}
              >
                #{t}
              </button>
            ))}
          </div>
        )}
      </div>

      {!activePostSlug && activeCategoryObj && (activeCategoryObj.header_text || activeCategoryObj.description || activeCategoryObj.has_image || (liveEdit && canManage)) && (
        <div className="card" style={{ marginBottom: 0, borderLeft: '4px solid var(--cd-primary)' }}>
          <div className="between" style={{ marginBottom: '.45rem' }}>
            <h3 style={{ margin: 0, fontSize: '1.12rem' }}>{activeCategoryObj.name}</h3>
            {liveEdit && canManage && (
              <button
                type="button"
                className="btn sm"
                onClick={() => {
                  setModalErr('');
                  setCatModal({
                    id: activeCategoryObj.id,
                    name: activeCategoryObj.name || '',
                    description: activeCategoryObj.description || '',
                    header_text: activeCategoryObj.header_text || '',
                    comment_policy: activeCategoryObj.comment_policy || 'moderated',
                    rss_policy: activeCategoryObj.rss_policy || 'always_ask',
                  });
                }}
              >
                Edit Category &amp; Custom Text
              </button>
            )}
          </div>
          {activeCategoryObj.has_image && (
            <img
              src={`${activeCategoryObj.image_url}?v=${activeCategoryObj.updated_at || ''}`}
              alt={activeCategoryObj.name}
              style={{ width: '100%', maxHeight: 240, objectFit: 'cover', borderRadius: 6, marginBottom: '.75rem' }}
            />
          )}
          {activeCategoryObj.description && (
            <p className="muted" style={{ margin: '0 0 .5rem', fontSize: '.92rem' }}>{activeCategoryObj.description}</p>
          )}
          {activeCategoryObj.header_text && <RichTextContent text={activeCategoryObj.header_text} />}
        </div>
      )}

      {activePostSlug ? (
        <div className="card" style={{ marginBottom: 0 }}>
          <div className="between" style={{ marginBottom: '.85rem' }}>
            <button type="button" className="btn sm" onClick={() => selectPostSlug('')}>
              ← Back to All Posts
            </button>
            <div className="actions">
              <button
                type="button"
                className="btn sm"
                onClick={() => {
                  const url = `${location.origin}/#blog/${activePostSlug}`;
                  navigator.clipboard?.writeText(url).catch(() => {});
                }}
              >
                Copy Link
              </button>
              {liveEdit && canManage && detail?.post && (
                <button type="button" className="btn sm primary" onClick={() => openEditPostModal(detail.post)}>
                  Edit This Post
                </button>
              )}
            </div>
          </div>

          {detailLoading ? (
            <p className="muted">Loading article…</p>
          ) : !detail?.post ? (
            <p className="muted">This blog post could not be found.</p>
          ) : (
            <article>
              <div style={{ display: 'flex', gap: '.45rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '.45rem' }}>
                <span className="badge draft">{detail.post.category_name}</span>
                {detail.post.is_featured && (
                  <span className="badge" style={{ background: '#fef3c7', color: '#92400e' }}>Featured</span>
                )}
                {detail.post.computed_status !== 'published' && (
                  <span className="badge disabled">{detail.post.computed_status}</span>
                )}
                <span className="muted" style={{ fontSize: '.85rem' }}>
                  {formatDate(detail.post.publish_at)}
                  {detail.post.author_name ? ` · By ${detail.post.author_name}` : ''}
                </span>
              </div>

              <h1 style={{ margin: '0 0 .6rem', fontSize: '1.55rem' }}>{detail.post.title}</h1>

              {detail.post.lead_in && (
                <p style={{ fontSize: '1.03rem', color: '#475569', lineHeight: 1.5, margin: '0 0 .85rem' }}>
                  {detail.post.lead_in}
                </p>
              )}

              {detail.post.has_image && (
                <img
                  src={`${detail.post.image_url}?v=${detail.post.updated_at || ''}`}
                  alt={detail.post.title}
                  className="blog-cover-img"
                />
              )}

              <RichTextContent text={detail.post.body} />

              {Array.isArray(detail.post.tags) && detail.post.tags.length > 0 && (
                <div style={{ display: 'flex', gap: '.35rem', flexWrap: 'wrap', marginTop: '1rem', paddingTop: '.85rem', borderTop: '1px solid #e2e8f0' }}>
                  <span className="muted" style={{ fontSize: '.82rem' }}>Tags:</span>
                  {detail.post.tags.map((t) => (
                    <button
                      key={t}
                      type="button"
                      className="btn sm"
                      style={{ fontSize: '.78rem', padding: '.15rem .45rem' }}
                      onClick={() => {
                        setSelectedTag(t);
                        selectPostSlug('');
                      }}
                    >
                      #{t}
                    </button>
                  ))}
                </div>
              )}

              <div style={{ marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid #e2e8f0' }}>
                <div className="between" style={{ marginBottom: '.65rem' }}>
                  <h2 style={{ margin: 0, fontSize: '1.1rem' }}>
                    Resident Comments ({detail.comments?.length || 0})
                  </h2>
                  <span className="muted" style={{ fontSize: '.82rem' }}>
                    {COMMENT_POLICY_LABELS[detail.post.effective_comment_policy] || 'Comments'}
                  </span>
                </div>

                {detail.post.effective_comment_policy === 'disabled' ? (
                  <p className="muted" style={{ margin: 0 }}>Comments are disabled for this post.</p>
                ) : (
                  <>
                    {detail.comments?.length > 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '.65rem', marginBottom: '1.1rem' }}>
                        {detail.comments.map((cm) => (
                          <div
                            key={cm.id}
                            style={{
                              padding: '.75rem .9rem',
                              borderRadius: 8,
                              background: '#f8fafc',
                              border: '1px solid #e2e8f0',
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '.5rem', marginBottom: '.25rem' }}>
                              <strong style={{ fontSize: '.92rem' }}>{cm.author_name}</strong>
                              <span className="muted" style={{ fontSize: '.8rem' }}>{formatDate(cm.created_at)}</span>
                            </div>
                            <div style={{ whiteSpace: 'pre-wrap', fontSize: '.92rem', lineHeight: 1.5 }}>{cm.body}</div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="muted" style={{ margin: '0 0 1rem' }}>No approved comments yet. Be the first to share a comment below.</p>
                    )}

                    <form
                      onSubmit={handleCommentSubmit}
                      style={{
                        background: '#f8fafc',
                        border: '1px solid #cbd5e1',
                        borderRadius: 8,
                        padding: '.9rem 1rem',
                      }}
                    >
                      <h3 style={{ margin: '0 0 .65rem', fontSize: '1rem' }}>Leave a Comment</h3>
                      <div className="row" style={{ marginBottom: '.65rem' }}>
                        <div className="field" style={{ flex: 1, minWidth: 180 }}>
                          <label htmlFor="blog-cm-name">Your Name *</label>
                          <input
                            id="blog-cm-name"
                            required
                            maxLength={120}
                            value={cName}
                            onChange={(e) => setCName(e.target.value)}
                          />
                        </div>
                        <div className="field" style={{ flex: 1, minWidth: 180 }}>
                          <label htmlFor="blog-cm-email">Email (optional, never shown publicly)</label>
                          <input
                            id="blog-cm-email"
                            type="email"
                            maxLength={254}
                            value={cEmail}
                            onChange={(e) => setCEmail(e.target.value)}
                          />
                        </div>
                      </div>
                      <input
                        type="text"
                        tabIndex={-1}
                        autoComplete="off"
                        aria-hidden="true"
                        style={{ position: 'absolute', left: '-9999px', width: 1, height: 1 }}
                        value={cWebsite}
                        onChange={(e) => setCWebsite(e.target.value)}
                      />
                      <div className="field" style={{ marginBottom: '.75rem' }}>
                        <label htmlFor="blog-cm-body">Comment *</label>
                        <textarea
                          id="blog-cm-body"
                          required
                          rows={3}
                          maxLength={4000}
                          placeholder={
                            detail.post.effective_comment_policy === 'moderated'
                              ? 'Comments are reviewed by staff before appearing publicly...'
                              : 'Share your thoughts on this article...'
                          }
                          value={cBody}
                          onChange={(e) => setCBody(e.target.value)}
                        />
                      </div>
                      <button type="submit" className="btn primary" disabled={cBusy}>
                        {cBusy ? 'Submitting…' : 'Submit Comment'}
                      </button>
                      {cMsg.text && (
                        <div className={cMsg.isError ? 'error-msg' : 'ok-msg'} role="status">
                          {cMsg.text}
                        </div>
                      )}
                    </form>
                  </>
                )}
              </div>
            </article>
          )}
        </div>
      ) : loading ? (
        <div className="card"><p className="muted" style={{ margin: 0 }}>Loading blog articles…</p></div>
      ) : posts.length === 0 ? (
        <div className="card"><p className="muted" style={{ margin: 0 }}>No published blog posts match your filters yet.</p></div>
      ) : (
        <div className="blog-card-grid">
          {posts.map((p) => (
            <div key={p.id} className="card" style={{ marginBottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
              <div>
                {p.has_image && (
                  <img
                    src={`${p.image_url}?v=${p.updated_at || ''}`}
                    alt={p.title}
                    style={{ width: '100%', height: 180, objectFit: 'cover', borderRadius: 6, marginBottom: '.75rem' }}
                  />
                )}
                <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '.4rem' }}>
                  <span className="badge draft">{p.category_name}</span>
                  {p.is_featured && (
                    <span className="badge" style={{ background: '#fef3c7', color: '#92400e' }}>Featured</span>
                  )}
                  {p.computed_status !== 'published' && (
                    <span className="badge disabled">{p.computed_status}</span>
                  )}
                  <span className="muted" style={{ fontSize: '.82rem' }}>{formatDate(p.publish_at)}</span>
                </div>
                <h3 style={{ margin: '0 0 .4rem', fontSize: '1.15rem' }}>{p.title}</h3>
                {p.lead_in && (
                  <p className="muted" style={{ margin: '0 0 .65rem', fontSize: '.92rem', lineHeight: 1.5 }}>{p.lead_in}</p>
                )}
                {Array.isArray(p.tags) && p.tags.length > 0 && (
                  <div style={{ display: 'flex', gap: '.3rem', flexWrap: 'wrap', marginBottom: '.65rem' }}>
                    {p.tags.map((t) => (
                      <span key={t} className="badge draft" style={{ fontSize: '.74rem' }}>#{t}</span>
                    ))}
                  </div>
                )}
              </div>

              <div className="between" style={{ paddingTop: '.55rem', borderTop: '1px solid #e2e8f0', gap: '.5rem' }}>
                <span className="muted" style={{ fontSize: '.82rem' }}>
                  {p.effective_comment_policy === 'disabled'
                    ? 'Comments disabled'
                    : `${p.approved_comment_count} comment${p.approved_comment_count === 1 ? '' : 's'}`}
                </span>
                <div className="actions">
                  {liveEdit && canManage && (
                    <button type="button" className="btn sm" onClick={() => openEditPostModal(p)}>
                      Edit
                    </button>
                  )}
                  <button type="button" className="btn sm primary" onClick={() => selectPostSlug(p.slug)}>
                    Read Full Post →
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {postModal && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 120,
            background: 'rgba(15, 23, 42, .45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1rem',
          }}
        >
          <div className="card" style={{ width: '100%', maxWidth: 740, maxHeight: '90vh', overflowY: 'auto', marginBottom: 0 }}>
            <div className="between" style={{ marginBottom: '.75rem' }}>
              <h2 style={{ margin: 0 }}>{postModal.id ? 'Live Edit: Blog Post' : 'Live Edit: New Blog Post'}</h2>
              <button type="button" className="btn sm" onClick={() => setPostModal(null)}>Close</button>
            </div>
            <form onSubmit={savePostModal}>
              <div className="row" style={{ marginBottom: '.75rem' }}>
                <div className="field" style={{ flex: 2, minWidth: 220 }}>
                  <label htmlFor="live-post-title">Post Title *</label>
                  <input
                    id="live-post-title"
                    required
                    value={postModal.title}
                    onChange={(e) => setPostModal((m) => ({ ...m, title: e.target.value }))}
                  />
                </div>
                <div className="field" style={{ flex: 1, minWidth: 160 }}>
                  <label htmlFor="live-post-cat">Category *</label>
                  <select
                    id="live-post-cat"
                    value={postModal.category_id}
                    onChange={(e) => setPostModal((m) => ({ ...m, category_id: e.target.value }))}
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="row" style={{ marginBottom: '.75rem' }}>
                <div className="field" style={{ flex: 1, minWidth: 180 }}>
                  <label htmlFor="live-post-author">Author / Byline</label>
                  <input
                    id="live-post-author"
                    value={postModal.author_name}
                    onChange={(e) => setPostModal((m) => ({ ...m, author_name: e.target.value }))}
                  />
                </div>
                <div className="field" style={{ flex: 1, minWidth: 180 }}>
                  <label htmlFor="live-post-tags">Tags (comma-separated)</label>
                  <input
                    id="live-post-tags"
                    value={postModal.tags_text}
                    onChange={(e) => setPostModal((m) => ({ ...m, tags_text: e.target.value }))}
                  />
                </div>
              </div>
              <div className="field" style={{ marginBottom: '.75rem' }}>
                <label htmlFor="live-post-lead">Lead-In Summary</label>
                <textarea
                  id="live-post-lead"
                  rows={2}
                  value={postModal.lead_in}
                  onChange={(e) => setPostModal((m) => ({ ...m, lead_in: e.target.value }))}
                />
              </div>
              <div style={{ marginBottom: '.75rem' }}>
                <RichTextEditor
                  id="live-post-body"
                  label="Full Post Content"
                  rows={8}
                  value={postModal.body}
                  onChange={(next) => setPostModal((m) => ({ ...m, body: next }))}
                />
              </div>
              <div style={{ display: 'flex', gap: '1.1rem', flexWrap: 'wrap', marginBottom: '.85rem' }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem', cursor: 'pointer', fontSize: '.9rem' }}>
                  <input
                    type="checkbox"
                    style={{ width: 'auto' }}
                    checked={postModal.is_published}
                    onChange={(e) => setPostModal((m) => ({ ...m, is_published: e.target.checked }))}
                  />
                  <span>Publish Immediately</span>
                </label>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem', cursor: 'pointer', fontSize: '.9rem' }}>
                  <input
                    type="checkbox"
                    style={{ width: 'auto' }}
                    checked={postModal.is_featured}
                    onChange={(e) => setPostModal((m) => ({ ...m, is_featured: e.target.checked }))}
                  />
                  <span>Featured</span>
                </label>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem', cursor: 'pointer', fontSize: '.9rem' }}>
                  <input
                    type="checkbox"
                    style={{ width: 'auto' }}
                    checked={postModal.include_in_rss}
                    onChange={(e) => setPostModal((m) => ({ ...m, include_in_rss: e.target.checked }))}
                  />
                  <span>Include in RSS</span>
                </label>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem', cursor: 'pointer', fontSize: '.9rem' }}>
                  <input
                    type="checkbox"
                    style={{ width: 'auto' }}
                    disabled={!postModal.is_published}
                    checked={postModal.notify_subscribers && postModal.is_published}
                    onChange={(e) => setPostModal((m) => ({ ...m, notify_subscribers: e.target.checked }))}
                  />
                  <span>Notify Subscribers</span>
                </label>
              </div>
              {modalErr && <div className="error-msg" role="alert" style={{ marginBottom: '.65rem' }}>{modalErr}</div>}
              <div className="actions">
                <button type="submit" className="btn primary" disabled={modalBusy}>
                  {modalBusy ? 'Saving…' : 'Save Post'}
                </button>
                <button type="button" className="btn" onClick={() => setPostModal(null)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {catModal && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 120,
            background: 'rgba(15, 23, 42, .45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1rem',
          }}
        >
          <div className="card" style={{ width: '100%', maxWidth: 680, maxHeight: '90vh', overflowY: 'auto', marginBottom: 0 }}>
            <div className="between" style={{ marginBottom: '.75rem' }}>
              <h2 style={{ margin: 0 }}>Live Edit: Category &amp; Custom Text</h2>
              <button type="button" className="btn sm" onClick={() => setCatModal(null)}>Close</button>
            </div>
            <form onSubmit={saveCatModal}>
              <div className="field" style={{ marginBottom: '.75rem' }}>
                <label htmlFor="live-cat-name">Category Name *</label>
                <input
                  id="live-cat-name"
                  required
                  value={catModal.name}
                  onChange={(e) => setCatModal((m) => ({ ...m, name: e.target.value }))}
                />
              </div>
              <div className="field" style={{ marginBottom: '.75rem' }}>
                <label htmlFor="live-cat-desc">Short Description</label>
                <input
                  id="live-cat-desc"
                  value={catModal.description}
                  onChange={(e) => setCatModal((m) => ({ ...m, description: e.target.value }))}
                />
              </div>
              <div style={{ marginBottom: '.75rem' }}>
                <RichTextEditor
                  id="live-cat-header"
                  label="Custom Header Text on Category Page"
                  rows={6}
                  value={catModal.header_text}
                  onChange={(next) => setCatModal((m) => ({ ...m, header_text: next }))}
                />
              </div>
              {modalErr && <div className="error-msg" role="alert" style={{ marginBottom: '.65rem' }}>{modalErr}</div>}
              <div className="actions">
                <button type="submit" className="btn primary" disabled={modalBusy}>
                  {modalBusy ? 'Saving…' : 'Save Category Text'}
                </button>
                <button type="button" className="btn" onClick={() => setCatModal(null)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
