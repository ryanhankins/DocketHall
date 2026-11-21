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

function SectionEditor({ section, onBack, onSaved }) {
  const [secNum, setSecNum] = useState(section.section_number);
  const [title, setTitle] = useState(section.title);
  const [ordinance, setOrdinance] = useState(section.ordinance_ref || '');
  const [effDate, setEffDate] = useState(section.effective_date || '');
  const [summary, setSummary] = useState(section.summary || '');
  const [body, setBody] = useState(section.body || '');
  const [sourceUrl, setSourceUrl] = useState(section.source_pdf_url || '');
  const [published, setPublished] = useState(!!section.is_published);
  const [changeSummary, setChangeSummary] = useState('');
  const [revisions, setRevisions] = useState([]);
  const [busy, setBusy] = useState(false);
  const showToast = useToast();

  const loadRevisions = useCallback(async () => {
    const list = await api(`/api/codification/sections/${section.id}/revisions`);
    setRevisions(Array.isArray(list) ? list : []);
  }, [section.id]);

  useEffect(() => {
    loadRevisions().catch(() => {});
  }, [loadRevisions]);

  const handleSave = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/api/codification/sections/${section.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          section_number: secNum.trim(),
          title: title.trim(),
          ordinance_ref: ordinance.trim(),
          effective_date: effDate.trim(),
          summary: summary.trim(),
          body,
          source_pdf_url: sourceUrl.trim(),
          is_published: published,
          change_summary: changeSummary.trim(),
        }),
      });
      setChangeSummary('');
      showToast(`Saved Section ${secNum}`, 'ok');
      await loadRevisions();
      await onSaved();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section id="section-codification-admin">
      <div className="between" style={{ marginBottom: '.85rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.65rem', flexWrap: 'wrap' }}>
          <button type="button" className="btn sm" onClick={onBack}>&larr; All Code Chapters</button>
          <h1 style={{ margin: 0 }}>Section {section.section_number} — {section.title}</h1>
        </div>
        <div className="actions">
          <a className="btn sm" href={`/api/codification/sections/${section.id}/pdf`} target="_blank" rel="noreferrer">View Section PDF</a>
          <a className="btn sm" href="/code" target="_blank" rel="noreferrer">Public City Code</a>
        </div>
      </div>

      <div className="card">
        <form onSubmit={handleSave}>
          <div className="row" style={{ marginBottom: '.75rem' }}>
            <div className="field" style={{ minWidth: '120px' }}>
              <label>Section #</label>
              <input required value={secNum} onChange={(e) => setSecNum(e.target.value)} />
            </div>
            <div className="field" style={{ flex: 2, minWidth: '220px' }}>
              <label>Section Title</label>
              <input required value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="field" style={{ flex: 1, minWidth: '150px' }}>
              <label>Ordinance Ref</label>
              <input placeholder="e.g. Ord. 2024-03" value={ordinance} onChange={(e) => setOrdinance(e.target.value)} />
            </div>
            <div className="field">
              <label>Effective Date</label>
              <input type="date" value={effDate} onChange={(e) => setEffDate(e.target.value)} />
            </div>
          </div>

          <div className="field" style={{ marginBottom: '.75rem' }}>
            <label>Official PDF URL (external or fallback)</label>
            <input placeholder="https://..." value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} />
          </div>

          <div className="field" style={{ marginBottom: '.75rem' }}>
            <label>Summary / Scope</label>
            <input placeholder="Brief description of this code section" value={summary} onChange={(e) => setSummary(e.target.value)} />
          </div>

          <div className="field" style={{ marginBottom: '.75rem' }}>
            <label>Codified Text</label>
            <textarea rows={10} placeholder="Enter full codified ordinance text here..." value={body} onChange={(e) => setBody(e.target.value)} />
          </div>

          <div className="row" style={{ marginBottom: '.85rem', alignItems: 'center' }}>
            <div className="field" style={{ flex: 2, minWidth: '220px' }}>
              <label>Amendment / Change Summary (for revision log)</label>
              <input placeholder="e.g. Updated setback table per Ord. 2026-01" value={changeSummary} onChange={(e) => setChangeSummary(e.target.value)} />
            </div>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem', cursor: 'pointer' }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={published} onChange={(e) => setPublished(e.target.checked)} />
              <span>Published in Public City Code</span>
            </label>
          </div>

          <div className="between">
            <button type="submit" className="btn primary" disabled={busy}>Save Section</button>
            <div className="actions">
              <button
                type="button"
                className="btn sm"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const res = await api(`/api/codification/sections/${section.id}/extract-pdf`, { method: 'POST' });
                    if (res.text) {
                      setBody(res.text);
                      if (!changeSummary.trim()) setChangeSummary(`Imported text from PDF (${res.pages} page(s))`);
                      showToast(`Extracted text from ${res.pages} PDF page(s) — review and click Save Section`, 'ok');
                    } else {
                      showToast('No extractable text found in PDF (it may be a scanned image)', 'error');
                    }
                  } catch (err) {
                    showToast(err.message, 'error');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Import Text from PDF
              </button>
              <input
                id={`sec-pdf-up-${section.id}`}
                type="file"
                accept="application/pdf,.pdf"
                hidden
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const fd = new FormData();
                  fd.append('file', f);
                  try {
                    await api(`/api/codification/sections/${section.id}/pdf`, { method: 'POST', body: fd });
                    showToast('Official PDF uploaded', 'ok');
                    await loadRevisions();
                    await onSaved();
                  } catch (err) {
                    showToast(err.message, 'error');
                  } finally {
                    e.target.value = '';
                  }
                }}
              />
              <button type="button" className="btn sm" onClick={() => document.getElementById(`sec-pdf-up-${section.id}`)?.click()}>
                Upload Official PDF
              </button>
            </div>
          </div>
        </form>
      </div>

      <div className="card">
        <h2>Codification Revision History</h2>
        {!revisions.length ? (
          <p className="muted">No revisions recorded yet.</p>
        ) : (
          <table>
            <thead>
              <tr><th>Date</th><th>Ordinance</th><th>Effective</th><th>Summary</th><th>Edited By</th></tr>
            </thead>
            <tbody>
              {revisions.map(r => (
                <tr key={r.id}>
                  <td className="muted">{formatDate(r.created_at)}</td>
                  <td>{r.ordinance_number || '—'}</td>
                  <td>{r.effective_date || '—'}</td>
                  <td>
                    <div>{r.change_summary}</div>
                    {(r.previous_body || r.new_body) && (
                      <details style={{ marginTop: '.25rem', fontSize: '.82rem' }}>
                        <summary style={{ cursor: 'pointer', color: '#1d4ed8' }}>View Snapshot</summary>
                        <div style={{ whiteSpace: 'pre-wrap', background: '#f8fafc', padding: '.45rem', borderRadius: '4px', marginTop: '.25rem', maxHeight: '180px', overflowY: 'auto' }}>
                          {r.new_body || r.previous_body}
                        </div>
                      </details>
                    )}
                  </td>
                  <td>{r.edited_by || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

export default function CodificationAdminPage() {
  const [chapters, setChapters] = useState([]);
  const [search, setSearch] = useState('');
  const [editingSec, setEditingSec] = useState(null);
  const [newPrefix, setNewPrefix] = useState('');
  const [newChapTitle, setNewChapTitle] = useState('');
  const [newSecChapId, setNewSecChapId] = useState('');
  const [newSecNum, setNewSecNum] = useState('');
  const [newSecTitle, setNewSecTitle] = useState('');
  const showToast = useToast();

  const loadCode = useCallback(async (q = '') => {
    const data = await api(`/api/codification/admin?q=${encodeURIComponent(q)}`);
    const chaps = Array.isArray(data.chapters) ? data.chapters : [];
    setChapters(chaps);
    setNewSecChapId(prev => (prev && chaps.some(c => String(c.id) === prev) ? prev : (chaps[0] ? String(chaps[0].id) : '')));
  }, []);

  useEffect(() => {
    loadCode(search).catch(e => showToast(e.message, 'error'));
  }, [loadCode, search, showToast]);

  if (editingSec) {
    return (
      <SectionEditor
        section={editingSec}
        onBack={() => setEditingSec(null)}
        onSaved={() => loadCode(search)}
      />
    );
  }

  return (
    <section id="section-codification-admin">
      <div className="between" style={{ marginBottom: '1rem' }}>
        <h1 style={{ margin: 0 }}>City Code &amp; Codification</h1>
        <a href="/code" target="_blank" rel="noreferrer" className="btn sm">Open Public City Code</a>
      </div>

      <div className="card">
        <div className="row" style={{ marginBottom: '.85rem', alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: 2, minWidth: '220px' }}>
            <label htmlFor="code-admin-search">Search City Code</label>
            <input id="code-admin-search" type="search" placeholder="Search by section #, title, ordinance, or text..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>

        <form
          className="row"
          style={{ marginBottom: '.75rem', alignItems: 'flex-end' }}
          onSubmit={async (e) => {
            e.preventDefault();
            await api('/api/codification/chapters', {
              method: 'POST',
              body: JSON.stringify({ code_prefix: newPrefix.trim(), title: newChapTitle.trim(), sort_order: chapters.length + 1 }),
            });
            setNewPrefix(''); setNewChapTitle('');
            showToast('Chapter added', 'ok');
            await loadCode(search);
          }}
        >
          <div className="field" style={{ minWidth: '110px' }}>
            <label>Chapter Prefix</label>
            <input required placeholder="e.g. 10XX" value={newPrefix} onChange={(e) => setNewPrefix(e.target.value)} />
          </div>
          <div className="field" style={{ flex: 2, minWidth: '200px' }}>
            <label>New Chapter Title</label>
            <input required placeholder="e.g. Environmental Regulations" value={newChapTitle} onChange={(e) => setNewChapTitle(e.target.value)} />
          </div>
          <button type="submit" className="btn sm primary">Add Chapter</button>
        </form>

        <form
          className="row"
          style={{ alignItems: 'flex-end' }}
          onSubmit={async (e) => {
            e.preventDefault();
            await api('/api/codification/sections', {
              method: 'POST',
              body: JSON.stringify({ chapter_id: Number(newSecChapId), section_number: newSecNum.trim(), title: newSecTitle.trim() }),
            });
            setNewSecNum(''); setNewSecTitle('');
            showToast('Section added', 'ok');
            await loadCode(search);
          }}
        >
          <div className="field" style={{ minWidth: '200px' }}>
            <label>Chapter</label>
            <select value={newSecChapId} onChange={(e) => setNewSecChapId(e.target.value)}>
              {chapters.map(c => <option key={c.id} value={c.id}>{c.code_prefix} — {c.title}</option>)}
            </select>
          </div>
          <div className="field" style={{ minWidth: '100px' }}>
            <label>Section #</label>
            <input required placeholder="e.g. 1001" value={newSecNum} onChange={(e) => setNewSecNum(e.target.value)} />
          </div>
          <div className="field" style={{ flex: 2, minWidth: '200px' }}>
            <label>New Section Title</label>
            <input required placeholder="e.g. Stormwater Runoff" value={newSecTitle} onChange={(e) => setNewSecTitle(e.target.value)} />
          </div>
          <button type="submit" className="btn sm primary">Add Section</button>
        </form>
      </div>

      {chapters.map(c => (
        <details key={c.id} className="card" open={!!search.trim()}>
          <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.6rem', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem' }}>
              <span className="badge active">{c.code_prefix}</span>
              <span>{c.title}</span>
              <span className="badge draft">{c.is_published !== false ? 'Published' : 'Hidden'}</span>
              <span className="muted" style={{ fontWeight: 400 }}>({(c.sections || []).length} sections)</span>
            </div>
            <div className="actions" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                className="btn sm"
                onClick={async (e) => {
                  e.preventDefault();
                  const prefix = window.prompt('Chapter Prefix:', c.code_prefix || '');
                  if (prefix === null) return;
                  const title = window.prompt('Chapter Title:', c.title || '');
                  if (title === null) return;
                  await api(`/api/codification/chapters/${c.id}`, {
                    method: 'PATCH',
                    body: JSON.stringify({ code_prefix: prefix.trim(), title: title.trim() }),
                  });
                  showToast('Chapter updated', 'ok');
                  await loadAll();
                }}
              >
                Edit Chapter
              </button>
              <button
                type="button"
                className="btn sm"
                onClick={async (e) => {
                  e.preventDefault();
                  await api(`/api/codification/chapters/${c.id}`, {
                    method: 'PATCH',
                    body: JSON.stringify({ is_published: c.is_published === false }),
                  });
                  await loadAll();
                }}
              >
                {c.is_published !== false ? 'Hide' : 'Publish'}
              </button>
              <button
                type="button"
                className="btn sm danger"
                onClick={async (e) => {
                  e.preventDefault();
                  if (!window.confirm(`Delete chapter "${c.code_prefix} — ${c.title}" and all its sections?`)) return;
                  await api(`/api/codification/chapters/${c.id}`, { method: 'DELETE' });
                  showToast('Chapter deleted', 'ok');
                  await loadAll();
                }}
              >
                Delete
              </button>
            </div>
          </summary>
          <div style={{ marginTop: '.85rem' }}>
            <table>
              <thead>
                <tr><th>Section</th><th>Title</th><th>Status</th><th>PDF / Text</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {(c.sections || []).map(s => (
                  <tr key={s.id}>
                    <td><strong>{s.section_number}</strong></td>
                    <td>{s.title}</td>
                    <td><span className={`badge ${s.is_published ? 'active' : 'draft'}`}>{s.is_published ? 'Published' : 'Draft'}</span></td>
                    <td className="muted" style={{ fontSize: '.84rem' }}>
                      {s.has_uploaded_pdf ? 'Uploaded PDF' : (s.source_pdf_url ? 'External PDF' : 'No PDF')}
                      {s.body ? ' · Has Text' : ''}
                    </td>
                    <td>
                      <div className="actions">
                        <button type="button" className="btn sm primary" onClick={() => setEditingSec(s)}>Edit / Codify</button>
                        <a className="btn sm" href={`/api/codification/sections/${s.id}/pdf`} target="_blank" rel="noreferrer">PDF</a>
                        <button
                          type="button"
                          className="btn sm danger"
                          onClick={async () => {
                            if (!confirm(`Delete Section ${s.section_number}?`)) return;
                            await api(`/api/codification/sections/${s.id}`, { method: 'DELETE' });
                            await loadCode(search);
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
        </details>
      ))}
    </section>
  );
}
