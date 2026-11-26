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
import { StructuredCodeBody, buildSectionMap, flattenTreeSections } from './codeHelpers.jsx';

function mergePreviewTree(responses) {
  const chapters = [];
  const chapMap = new Map();
  const warnings = [];
  const failed = [];
  let filesProcessed = 0;
  let ocrFiles = 0;
  let ocrPages = 0;
  let totalNodes = 0;
  let totalSections = 0;

  for (const res of responses) {
    filesProcessed += res.files_processed || 0;
    ocrFiles += res.ocr_files || 0;
    ocrPages += res.ocr_pages || 0;
    totalNodes += res.total_nodes || 0;
    totalSections += res.total_sections || 0;
    if (Array.isArray(res.warnings)) warnings.push(...res.warnings);
    if (Array.isArray(res.failed)) failed.push(...res.failed);
    for (const ch of res.chapters || []) {
      const key = String(ch.code_prefix || 'General').toLowerCase();
      let bucket = chapMap.get(key);
      if (!bucket) {
        bucket = { code_prefix: ch.code_prefix, title: ch.title, sections: [] };
        chapMap.set(key, bucket);
        chapters.push(bucket);
      }
      bucket.sections.push(...(ch.sections || []));
    }
  }
  return {
    mode: 'preview',
    files_processed: filesProcessed,
    total_sections: totalSections,
    total_nodes: totalNodes,
    ocr_files: ocrFiles,
    ocr_pages: ocrPages,
    chapters,
    warnings,
    failed,
  };
}

async function collectDroppedFiles(entry) {
  if (!entry) return [];
  if (entry.isFile) {
    return new Promise((resolve) => entry.file((f) => resolve([f]), () => resolve([])));
  }
  if (entry.isDirectory) {
    const reader = entry.createReader();
    const entries = [];
    const readMore = () => new Promise((resolve) => {
      reader.readEntries((batch) => {
        if (!batch.length) resolve(entries);
        else {
          entries.push(...batch);
          resolve(readMore());
        }
      }, () => resolve(entries));
    });
    const dirEntries = await readMore();
    const nested = await Promise.all(dirEntries.map((ent) => collectDroppedFiles(ent)));
    return nested.flat();
  }
  return [];
}

function buildUploadBatches(files) {
  const batches = [];
  let cur = [];
  for (const f of files) {
    const lower = (f.name || '').toLowerCase();
    if (lower.endsWith('.zip')) {
      if (cur.length) {
        batches.push(cur);
        cur = [];
      }
      batches.push([f]);
    } else if (lower.endsWith('.pdf')) {
      cur.push(f);
      if (cur.length >= 3) {
        batches.push(cur);
        cur = [];
      }
    }
  }
  if (cur.length) batches.push(cur);
  return batches;
}

function collectChapterSectionIds(chapter) {
  return flattenTreeSections(chapter?.sections || [], chapter || {}, []).map((s) => s.id);
}

function SectionEditor({ section, allSectionsMap, onBack, onSaved }) {
  const [secNum, setSecNum] = useState(section.section_number);
  const [article, setArticle] = useState(section.article || '');
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
  const [previewMode, setPreviewMode] = useState(false);
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
          article: article.trim(),
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
          <a className="btn sm" href={`/code?sec=${encodeURIComponent(section.section_number)}`} target="_blank" rel="noreferrer">Public Reader</a>
        </div>
      </div>

      <div className="card">
        <form onSubmit={handleSave}>
          <div className="row" style={{ marginBottom: '.75rem' }}>
            <div className="field" style={{ minWidth: '110px' }}>
              <label>Section #</label>
              <input required value={secNum} onChange={(e) => setSecNum(e.target.value)} />
            </div>
            <div className="field" style={{ flex: 2, minWidth: '210px' }}>
              <label>Section Title</label>
              <input required value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="field" style={{ flex: 1, minWidth: '150px' }}>
              <label>Article / Division (optional)</label>
              <input placeholder="e.g. Article I — In General" value={article} onChange={(e) => setArticle(e.target.value)} />
            </div>
            <div className="field" style={{ minWidth: '130px' }}>
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
            <div className="between" style={{ marginBottom: '.3rem' }}>
              <label style={{ margin: 0 }}>Codified Text</label>
              <div className="actions">
                <button
                  type="button"
                  className={`btn sm${!previewMode ? ' primary' : ''}`}
                  onClick={() => setPreviewMode(false)}
                >
                  Edit Text
                </button>
                <button
                  type="button"
                  className={`btn sm${previewMode ? ' primary' : ''}`}
                  onClick={() => setPreviewMode(true)}
                >
                  Formatted Preview
                </button>
                <button
                  type="button"
                  className="btn sm"
                  disabled={busy || !body.trim()}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const res = await api(`/api/codification/sections/${section.id}/reformat`, { method: 'POST' });
                      if (res.body) {
                        setBody(res.body);
                        if (!ordinance.trim() && res.ordinance_ref) setOrdinance(res.ordinance_ref);
                        if (!effDate.trim() && res.effective_date) setEffDate(res.effective_date);
                        if (!changeSummary.trim()) setChangeSummary('Cleaned & formatted code structure');
                        showToast(`Formatted (${res.subsection_count} subsections detected) — review and Save Section`, 'ok');
                      }
                    } catch (err) {
                      showToast(err.message, 'error');
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Clean &amp; Format Text
                </button>
                <button
                  type="button"
                  className="btn sm"
                  disabled={busy || !body.trim()}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const res = await api(`/api/codification/sections/${section.id}/split?apply=true`, { method: 'POST' });
                      if (res.applied) {
                        setBody(res.preamble || '');
                        showToast(`Split into ${res.children_count} child section(s) (${res.scheme})`, 'ok');
                        await loadRevisions();
                        await onSaved();
                      } else {
                        showToast('Fewer than 2 child sections detected in current text', 'error');
                      }
                    } catch (err) {
                      showToast(err.message, 'error');
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Auto-Split Into Sub-Sections
                </button>
              </div>
            </div>
            {previewMode ? (
              <div style={{ border: '1px solid #cbd5e1', borderRadius: 6, padding: '1rem 1.25rem', background: '#fff', minHeight: 220 }}>
                {body.trim() ? (
                  <StructuredCodeBody
                    text={body}
                    sectionMap={allSectionsMap}
                    currentSectionId={section.id}
                    onSelectSection={() => {}}
                  />
                ) : (
                  <p className="muted" style={{ margin: 0 }}>No body text yet.</p>
                )}
              </div>
            ) : (
              <textarea rows={12} placeholder="Enter full codified ordinance text here..." value={body} onChange={(e) => setBody(e.target.value)} />
            )}
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
                      if (!ordinance.trim() && res.ordinance_ref) setOrdinance(res.ordinance_ref);
                      if (!effDate.trim() && res.effective_date) setEffDate(res.effective_date);
                      if (!changeSummary.trim()) setChangeSummary(`Imported formatted text from PDF (${res.pages} page(s)${res.used_ocr ? ', OCR' : ''})`);
                      showToast(`Extracted ${res.pages} page(s)${res.used_ocr ? ' via OCR' : ''} — review and click Save Section`, 'ok');
                    } else {
                      showToast('No extractable text found in PDF', 'error');
                    }
                  } catch (err) {
                    showToast(err.message, 'error');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Import Text from PDF (OCR fallback)
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
                  fd.append('auto_extract', 'true');
                  fd.append('split_children', 'true');
                  fd.append('enable_ocr', 'true');
                  try {
                    const res = await api(`/api/codification/sections/${section.id}/pdf`, { method: 'POST', body: fd });
                    if (res.extracted) {
                      setBody(res.body || '');
                      if (!ordinance.trim() && res.ordinance_ref) setOrdinance(res.ordinance_ref);
                      if (!effDate.trim() && res.effective_date) setEffDate(res.effective_date);
                      showToast(
                        `PDF uploaded (${res.pages}p${res.used_ocr ? ', OCR' : ''}${res.children_created ? `, ${res.children_created} child sections created` : ''})`,
                        'ok',
                      );
                    } else {
                      showToast('Official PDF uploaded', 'ok');
                    }
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
                Upload &amp; Auto-Extract PDF
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

function PreviewTreeNode({
  node,
  path,
  onUpdateNode,
  onFlattenChildren,
  onRemoveChild,
}) {
  const children = node.children || [];
  return (
    <div style={{ borderLeft: path.length > 2 ? '2px solid #cbd5e1' : 'none', paddingLeft: path.length > 2 ? '.65rem' : 0, marginTop: '.3rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', flexWrap: 'wrap', fontSize: '.85rem' }}>
        <input
          aria-label="Preview section number"
          style={{ width: '92px', padding: '.2rem .35rem', fontSize: '.82rem', fontWeight: 600 }}
          value={node.section_number}
          onChange={(e) => onUpdateNode(path, 'section_number', e.target.value)}
        />
        <input
          aria-label="Preview section title"
          style={{ flex: 1, minWidth: '170px', padding: '.2rem .4rem', fontSize: '.82rem' }}
          value={node.title}
          onChange={(e) => onUpdateNode(path, 'title', e.target.value)}
        />
        <span className="muted" style={{ fontSize: '.76rem' }}>
          {children.length > 0 ? `${children.length} sub-sections` : `${node.subsection_count || 0} inline subs`}
          {node.ordinance_ref ? ` · ${node.ordinance_ref}` : ''}
        </span>
        {children.length > 0 && (
          <button type="button" className="btn sm" onClick={() => onFlattenChildren(path)}>
            Flatten into 1 Doc
          </button>
        )}
        {onRemoveChild && path.length > 2 && (
          <button type="button" className="btn sm danger" onClick={() => onRemoveChild(path)}>
            Remove
          </button>
        )}
      </div>
      {node.body_preview && !children.length && (
        <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: '.78rem', margin: '.25rem 0', background: '#f8fafc', padding: '.35rem .5rem', borderRadius: 4, maxHeight: 110, overflowY: 'auto' }}>
          {node.body_preview}
        </pre>
      )}
      {children.length > 0 && (
        <div style={{ marginTop: '.25rem' }}>
          {children.map((child, idx) => (
            <PreviewTreeNode
              key={idx}
              node={child}
              path={[...path, idx]}
              onUpdateNode={onUpdateNode}
              onFlattenChildren={onFlattenChildren}
              onRemoveChild={onRemoveChild}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function CodificationAdminPage() {
  const [chapters, setChapters] = useState([]);
  const [search, setSearch] = useState('');
  const [editingSec, setEditingSec] = useState(null);
  const [newPrefix, setNewPrefix] = useState('');
  const [newChapTitle, setNewChapTitle] = useState('');
  const [newSecChapId, setNewSecChapId] = useState('');
  const [newSecParentId, setNewSecParentId] = useState('');
  const [newSecNum, setNewSecNum] = useState('');
  const [newSecTitle, setNewSecTitle] = useState('');
  const [editingChapter, setEditingChapter] = useState(null);
  const [savingChapter, setSavingChapter] = useState(false);

  // Studio tabs & shared options
  const [tab, setTab] = useState('tree'); // 'tree' | 'import'
  const [studioTab, setStudioTab] = useState('upload'); // 'upload' | 'urls' | 'sync'
  const [importFiles, setImportFiles] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const [importTargetChapId, setImportTargetChapId] = useState('');
  const [importOverwrite, setImportOverwrite] = useState(true);
  const [importSplitChildren, setImportSplitChildren] = useState(true);
  const [importEnableOcr, setImportEnableOcr] = useState(true);
  const [importPublishImmediately, setImportPublishImmediately] = useState(true);
  const [importPreview, setImportPreview] = useState(null);
  const [importPreviewOrigin, setImportPreviewOrigin] = useState('upload'); // 'upload' | 'urls'
  const [importBusy, setImportBusy] = useState(false);
  const [progressInfo, setProgressInfo] = useState(null); // { label, done, total }
  const [importSummary, setImportSummary] = useState(null);

  // URL crawler tab state
  const [crawlPageUrl, setCrawlPageUrl] = useState('');
  const [crawlUrlsText, setCrawlUrlsText] = useState('');
  const [discoveredUrls, setDiscoveredUrls] = useState([]);
  const [selectedUrls, setSelectedUrls] = useState(() => new Set());
  const [urlFilter, setUrlFilter] = useState('');
  const [discoverPageTitle, setDiscoverPageTitle] = useState('');

  // Linked-PDF sync state
  const [bulkOnlyEmpty, setBulkOnlyEmpty] = useState(true);
  const [bulkReformat, setBulkReformat] = useState(true);
  const [bulkResult, setBulkResult] = useState(null);

  // Multi-select bulk codify bar on chapters table
  const [expandedAdminRows, setExpandedAdminRows] = useState({});
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkMoveChapId, setBulkMoveChapId] = useState('');
  const [bulkActionBusy, setBulkActionBusy] = useState(false);
  const showToast = useToast();

  const loadCode = useCallback(async (q = '') => {
    const data = await api(`/api/codification/admin?q=${encodeURIComponent(q)}`);
    const chaps = Array.isArray(data.chapters) ? data.chapters : [];
    setChapters(chaps);
    setNewSecChapId(prev => (prev && chaps.some(c => String(c.id) === prev) ? prev : (chaps[0] ? String(chaps[0].id) : '')));
    setBulkMoveChapId(prev => (prev && chaps.some(c => String(c.id) === prev) ? prev : (chaps[0] ? String(chaps[0].id) : '')));
  }, []);

  useEffect(() => {
    loadCode(search).catch(e => showToast(e.message, 'error'));
  }, [loadCode, search, showToast]);

  useEffect(() => {
    const onAiAction = () => loadCode(search).catch(() => {});
    window.addEventListener('dockethall:ai-action', onAiAction);
    return () => window.removeEventListener('dockethall:ai-action', onAiAction);
  }, [loadCode, search]);

  const queueFiles = useCallback((rawList) => {
    const valid = Array.from(rawList || []).filter((f) => {
      const lower = (f.name || '').toLowerCase();
      return (lower.endsWith('.pdf') || lower.endsWith('.zip')) && !f.name.startsWith('._');
    });
    if (!valid.length) {
      showToast('No .pdf or .zip files found in selection', 'error');
      return;
    }
    setImportFiles(valid);
    setImportPreview(null);
    setImportSummary(null);
  }, [showToast]);

  const updatePreviewNodeField = (path, field, val) => {
    setImportPreview((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      let ref = next.chapters[path[0]].sections[path[1]];
      for (let i = 2; i < path.length; i += 1) ref = ref.children[path[i]];
      ref[field] = val;
      return next;
    });
  };

  const flattenPreviewNode = (path) => {
    setImportPreview((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      let ref = next.chapters[path[0]].sections[path[1]];
      for (let i = 2; i < path.length; i += 1) ref = ref.children[path[i]];
      const merged = [ref.body || ''];
      for (const c of ref.children || []) {
        merged.push(`${c.section_number}. ${c.title}${c.body ? `\n\n${c.body}` : ''}`);
      }
      ref.body = merged.filter(Boolean).join('\n\n');
      ref.body_preview = ref.body.slice(0, 360);
      ref.node_type = 'section';
      ref.children = [];
      return next;
    });
  };

  const removePreviewChild = (path) => {
    if (path.length < 3) return;
    setImportPreview((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      let parent = next.chapters[path[0]].sections[path[1]];
      for (let i = 2; i < path.length - 1; i += 1) parent = parent.children[path[i]];
      parent.children.splice(path[path.length - 1], 1);
      return next;
    });
  };

  const runBatchedPdfImport = async (commit) => {
    if (!importFiles.length) return;
    const batches = buildUploadBatches(importFiles);
    setImportBusy(true);
    setImportSummary(null);
    try {
      const previewResponses = [];
      const agg = {
        files_processed: 0,
        chapters_created: 0,
        sections_created: 0,
        sections_updated: 0,
        children_created: 0,
        children_updated: 0,
        ocr_files: 0,
        warnings: [],
      };
      let processedFiles = 0;
      for (let i = 0; i < batches.length; i += 1) {
        const batch = batches[i];
        setProgressInfo({
          label: `${commit ? 'Importing' : 'Analyzing'} batch ${i + 1}/${batches.length} (${batch.map(f => f.name).join(', ')})`,
          done: processedFiles,
          total: importFiles.length,
        });
        const fd = new FormData();
        for (const f of batch) fd.append('files', f);
        fd.append('commit', String(commit));
        fd.append('overwrite_existing', String(importOverwrite));
        fd.append('split_children', String(importSplitChildren));
        fd.append('enable_ocr', String(importEnableOcr));
        fd.append('publish_immediately', String(importPublishImmediately));
        if (importTargetChapId) fd.append('target_chapter_id', importTargetChapId);
        const res = await api('/api/codification/import-pdfs', { method: 'POST', body: fd });
        processedFiles += batch.length;
        if (!commit) {
          previewResponses.push(res);
        } else {
          agg.files_processed += res.files_processed || 0;
          agg.chapters_created += res.chapters_created || 0;
          agg.sections_created += res.sections_created || 0;
          agg.sections_updated += res.sections_updated || 0;
          agg.children_created += res.children_created || 0;
          agg.children_updated += res.children_updated || 0;
          agg.ocr_files += res.ocr_files || 0;
          if (Array.isArray(res.warnings)) agg.warnings.push(...res.warnings);
        }
      }
      if (!commit) {
        const merged = mergePreviewTree(previewResponses);
        setImportPreview(merged);
        setImportPreviewOrigin('upload');
        showToast(`Analyzed ${merged.files_processed} PDF(s) — ${merged.total_nodes || merged.total_sections} node(s)`, 'ok');
      } else {
        setImportSummary(agg);
        setImportPreview(null);
        setImportFiles([]);
        const inp = document.getElementById('codification-bulk-files');
        if (inp) inp.value = '';
        const fld = document.getElementById('codification-bulk-folder');
        if (fld) fld.value = '';
        showToast(
          `Imported ${agg.files_processed} PDF(s): ${agg.chapters_created} chaps, ${agg.sections_created + agg.children_created} created, ${agg.sections_updated + agg.children_updated} updated`,
          'ok',
        );
        await loadCode(search);
      }
    } catch (err) {
      showToast(err.message || 'Bulk PDF import failed', 'error');
    } finally {
      setProgressInfo(null);
      setImportBusy(false);
    }
  };

  const commitEditedPreview = async () => {
    if (!importPreview?.chapters?.length) return;
    setImportBusy(true);
    setImportSummary(null);
    try {
      const canAttachSmallUploads = (
        importPreviewOrigin === 'upload'
        && importFiles.length > 0
        && importFiles.length <= 15
        && !importFiles.some((f) => (f.name || '').toLowerCase().endsWith('.zip'))
      );
      let res;
      if (canAttachSmallUploads) {
        const fd = new FormData();
        for (const f of importFiles) fd.append('files', f);
        fd.append('commit', 'true');
        fd.append('overwrite_existing', String(importOverwrite));
        fd.append('split_children', String(importSplitChildren));
        fd.append('enable_ocr', String(importEnableOcr));
        fd.append('publish_immediately', String(importPublishImmediately));
        if (importTargetChapId) fd.append('target_chapter_id', importTargetChapId);
        fd.append('override_tree_json', JSON.stringify(importPreview.chapters));
        res = await api('/api/codification/import-pdfs', { method: 'POST', body: fd });
        setImportFiles([]);
      } else {
        res = await api('/api/codification/import-tree', {
          method: 'POST',
          body: JSON.stringify({
            chapters: importPreview.chapters,
            target_chapter_id: importTargetChapId ? Number(importTargetChapId) : null,
            overwrite_existing: importOverwrite,
            publish_immediately: importPublishImmediately,
          }),
        });
      }
      setImportPreview(null);
      setImportSummary({
        files_processed: importPreview.files_processed || 0,
        chapters_created: res.chapters_created || 0,
        sections_created: res.sections_created || 0,
        sections_updated: res.sections_updated || 0,
        children_created: res.children_created || 0,
        children_updated: res.children_updated || 0,
        ocr_files: importPreview.ocr_files || 0,
        warnings: res.warnings || [],
      });
      showToast(
        `Committed: ${res.chapters_created} chapter(s), ${res.sections_created + (res.children_created || 0)} created, ${res.sections_updated + (res.children_updated || 0)} updated`,
        'ok',
      );
      await loadCode(search);
    } catch (err) {
      showToast(err.message || 'Failed to commit preview tree', 'error');
    } finally {
      setImportBusy(false);
    }
  };

  const runDiscoverUrls = async (mode) => {
    setImportBusy(true);
    try {
      const payload = mode === 'page'
        ? { page_url: crawlPageUrl.trim(), urls_text: '' }
        : { page_url: '', urls_text: crawlUrlsText.trim() };
      const res = await api('/api/codification/discover-urls', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const items = Array.isArray(res.items) ? res.items : [];
      setDiscoverPageTitle(res.page_title || '');
      setDiscoveredUrls(items);
      setSelectedUrls(new Set(items.map((it) => it.url)));
      if ((res.warnings || []).length) {
        showToast(res.warnings[0], 'error');
      } else {
        showToast(`Found ${items.length} PDF link(s)`, 'ok');
      }
    } catch (err) {
      showToast(err.message || 'URL scan failed', 'error');
    } finally {
      setImportBusy(false);
    }
  };

  const runBatchedUrlImport = async (commit) => {
    const items = discoveredUrls.filter((it) => selectedUrls.has(it.url));
    if (!items.length) return;
    setImportBusy(true);
    setImportSummary(null);
    try {
      const previewResponses = [];
      const agg = {
        files_processed: 0,
        chapters_created: 0,
        sections_created: 0,
        sections_updated: 0,
        children_created: 0,
        children_updated: 0,
        ocr_files: 0,
        warnings: [],
        failed: [],
      };
      for (let i = 0; i < items.length; i += 3) {
        const chunk = items.slice(i, i + 3);
        setProgressInfo({
          label: `${commit ? 'Importing' : 'Downloading & analyzing'} ${Math.min(i + chunk.length, items.length)}/${items.length} URLs…`,
          done: i,
          total: items.length,
        });
        const res = await api('/api/codification/import-urls', {
          method: 'POST',
          body: JSON.stringify({
            items: chunk.map((it) => ({ url: it.url, title: it.title, link_text: it.link_text })),
            commit,
            target_chapter_id: importTargetChapId ? Number(importTargetChapId) : null,
            overwrite_existing: importOverwrite,
            split_children: importSplitChildren,
            enable_ocr: importEnableOcr,
            publish_immediately: importPublishImmediately,
          }),
        });
        if (!commit) {
          previewResponses.push(res);
        } else {
          agg.files_processed += res.files_processed || 0;
          agg.chapters_created += res.chapters_created || 0;
          agg.sections_created += res.sections_created || 0;
          agg.sections_updated += res.sections_updated || 0;
          agg.children_created += res.children_created || 0;
          agg.children_updated += res.children_updated || 0;
          agg.ocr_files += res.ocr_files || 0;
          if (Array.isArray(res.warnings)) agg.warnings.push(...res.warnings);
          if (Array.isArray(res.failed)) agg.failed.push(...res.failed);
        }
      }
      if (!commit) {
        const merged = mergePreviewTree(previewResponses);
        setImportPreview(merged);
        setImportPreviewOrigin('urls');
        showToast(`Preview ready: ${merged.files_processed} URL PDF(s), ${merged.total_nodes} node(s)`, 'ok');
      } else {
        setImportSummary(agg);
        showToast(
          `URL import complete: ${agg.files_processed} PDFs, ${agg.sections_created + agg.children_created} created, ${agg.sections_updated + agg.children_updated} updated`,
          'ok',
        );
        await loadCode(search);
      }
    } catch (err) {
      showToast(err.message || 'URL import failed', 'error');
    } finally {
      setProgressInfo(null);
      setImportBusy(false);
    }
  };

  const runBulkLinkedImport = async (onlyChapter = null) => {
    const targets = onlyChapter ? [onlyChapter] : chapters;
    if (!targets.length) return;
    setImportBusy(true);
    setBulkResult(null);
    const agg = { imported: 0, children_created: 0, children_updated: 0, ocr_used_count: 0, reformatted: 0, skipped: 0, failed: [] };
    try {
      for (let i = 0; i < targets.length; i += 1) {
        const ch = targets[i];
        setProgressInfo({
          label: `Syncing ${ch.code_prefix} (${i + 1}/${targets.length})…`,
          done: i,
          total: targets.length,
        });
        const res = await api('/api/codification/import-linked-pdfs', {
          method: 'POST',
          body: JSON.stringify({
            chapter_id: ch.id,
            only_empty: bulkOnlyEmpty,
            reformat_existing: bulkReformat,
            split_children: importSplitChildren,
            enable_ocr: importEnableOcr,
            split_existing_monoliths: importSplitChildren,
          }),
        });
        agg.imported += res.imported || 0;
        agg.children_created += res.children_created || 0;
        agg.children_updated += res.children_updated || 0;
        agg.ocr_used_count += res.ocr_used_count || 0;
        agg.reformatted += res.reformatted || 0;
        agg.skipped += res.skipped || 0;
        if (Array.isArray(res.failed)) agg.failed.push(...res.failed);
      }
      setBulkResult(agg);
      showToast(`Imported ${agg.imported}, created ${agg.children_created} sub-sections (OCR on ${agg.ocr_used_count} files)`, 'ok');
      await loadCode(search);
    } catch (err) {
      showToast(err.message || 'Linked PDF sync failed', 'error');
    } finally {
      setProgressInfo(null);
      setImportBusy(false);
    }
  };

  const runBulkTableAction = async (action) => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    if (action === 'delete' && !window.confirm(`Delete ${ids.length} selected section(s) and their nested sub-sections?`)) {
      return;
    }
    if (action === 'move_chapter' && !bulkMoveChapId) {
      showToast('Select a destination chapter', 'error');
      return;
    }
    setBulkActionBusy(true);
    try {
      const res = await api('/api/codification/sections/bulk-action', {
        method: 'POST',
        body: JSON.stringify({
          section_ids: ids,
          action,
          include_descendants: true,
          target_chapter_id: action === 'move_chapter' ? Number(bulkMoveChapId) : null,
          enable_ocr: importEnableOcr,
          split_children: importSplitChildren,
        }),
      });
      const extra = res.children_created ? `, ${res.children_created} sub-sections created` : '';
      const ocrNote = res.ocr_used_count ? `, OCR on ${res.ocr_used_count}` : '';
      const failNote = (res.failed || []).length ? ` (${res.failed.length} failed)` : '';
      showToast(`Bulk ${action}: ${res.affected} affected${extra}${ocrNote}${failNote}`, (res.failed || []).length ? 'error' : 'ok');
      if (action === 'delete' || action === 'move_chapter') {
        setSelectedIds(new Set());
      }
      await loadCode(search);
    } catch (err) {
      showToast(err.message || `Bulk ${action} failed`, 'error');
    } finally {
      setBulkActionBusy(false);
    }
  };

  const toggleSelectId = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectChapter = (chap) => {
    const chapIds = collectChapterSectionIds(chap);
    if (!chapIds.length) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allSelected = chapIds.every((id) => next.has(id));
      for (const id of chapIds) {
        if (allSelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  };

  const filteredUrls = useMemo(() => {
    const term = urlFilter.trim().toLowerCase();
    if (!term) return discoveredUrls;
    return discoveredUrls.filter((it) =>
      `${it.section_number} ${it.title} ${it.link_text} ${it.filename} ${it.url}`.toLowerCase().includes(term),
    );
  }, [discoveredUrls, urlFilter]);

  if (editingSec) {
    return (
      <SectionEditor
        section={editingSec}
        allSectionsMap={buildSectionMap(chapters)}
        onBack={() => setEditingSec(null)}
        onSaved={() => loadCode(search)}
      />
    );
  }

  const selectedAddChapter = chapters.find((c) => String(c.id) === String(newSecChapId));
  const parentCandidates = selectedAddChapter ? flattenTreeSections(selectedAddChapter.sections || [], selectedAddChapter, []) : [];
  const totalSelectedMb = (importFiles.reduce((sum, f) => sum + (f.size || 0), 0) / (1024 * 1024)).toFixed(1);

  const renderAdminSectionRows = (sections, depth = 0) => {
    const rows = [];
    for (const s of sections || []) {
      const children = s.children || [];
      const hasChildren = children.length > 0;
      const isOpen = hasChildren && (Boolean(search.trim()) || !!expandedAdminRows[s.id]);
      rows.push(
        <tr key={s.id}>
          <td style={{ width: 32 }}>
            <input
              type="checkbox"
              style={{ width: 'auto' }}
              aria-label={`Select section ${s.section_number}`}
              checked={selectedIds.has(s.id)}
              onChange={() => toggleSelectId(s.id)}
            />
          </td>
          <td style={{ paddingLeft: `${0.5 + depth * 1.25}rem` }}>
            {hasChildren ? (
              <button
                type="button"
                className="link-btn"
                style={{ marginRight: 6, textDecoration: 'none' }}
                aria-label={isOpen ? `Collapse ${s.section_number}` : `Expand ${s.section_number}`}
                onClick={() => setExpandedAdminRows((prev) => ({ ...prev, [s.id]: !isOpen }))}
              >
                {isOpen ? '▾' : '▸'}
              </button>
            ) : depth > 0 ? (
              <span className="muted" style={{ marginRight: 6 }}>↳</span>
            ) : null}
            <strong>{s.section_number}</strong>
            {hasChildren && <span className="muted" style={{ fontSize: '.78rem', marginLeft: 5 }}>({children.length})</span>}
          </td>
          <td>{s.title}</td>
          <td><span className={`badge ${s.is_published ? 'active' : 'draft'}`}>{s.is_published ? 'Published' : 'Draft'}</span></td>
          <td className="muted" style={{ fontSize: '.84rem' }}>
            {s.has_uploaded_pdf ? 'Uploaded PDF' : (s.source_pdf_url ? 'External PDF' : (depth > 0 ? 'Sub-Section' : 'No PDF'))}
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
                  if (!confirm(`Delete Section ${s.section_number}${hasChildren ? ' and its child sub-sections' : ''}?`)) return;
                  await api(`/api/codification/sections/${s.id}`, { method: 'DELETE' });
                  await loadCode(search);
                }}
              >
                Delete
              </button>
            </div>
          </td>
        </tr>,
      );
      if (isOpen) {
        rows.push(...renderAdminSectionRows(children, depth + 1));
      }
    }
    return rows;
  };

  return (
    <section id="section-codification-admin">
      <div className="between" style={{ marginBottom: '1rem' }}>
        <h1 style={{ margin: 0 }}>City Code &amp; Codification</h1>
        <a href="/code" target="_blank" rel="noreferrer" className="btn sm">Open Public Code Reader</a>
      </div>

      <div className="tabs">
        <button type="button" className={`btn sm${tab === 'tree' ? ' active' : ''}`} onClick={() => setTab('tree')}>
          Code Tree &amp; Editor ({chapters.length})
        </button>
        <button type="button" className={`btn sm${tab === 'import' ? ' active' : ''}`} onClick={() => setTab('import')}>
          Bulk Import &amp; Codify Studio
        </button>
      </div>

      {tab === 'import' && (
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Bulk Import &amp; Codify Studio</h2>

        <div className="code-import-tabs" role="tablist" aria-label="Bulk import methods">
          <button
            type="button"
            role="tab"
            aria-selected={studioTab === 'upload'}
            className={`btn sm${studioTab === 'upload' ? ' primary' : ''}`}
            onClick={() => setStudioTab('upload')}
          >
            Upload PDFs / Folder / .zip
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={studioTab === 'urls'}
            className={`btn sm${studioTab === 'urls' ? ' primary' : ''}`}
            onClick={() => setStudioTab('urls')}
          >
            Crawl Website / Bulk URLs
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={studioTab === 'sync'}
            className={`btn sm${studioTab === 'sync' ? ' primary' : ''}`}
            onClick={() => setStudioTab('sync')}
          >
            Sync Existing Linked PDFs
          </button>
        </div>

        {/* Shared Parsing & Publishing Options */}
        <div className="row" style={{ alignItems: 'flex-end', marginBottom: '.65rem' }}>
          {studioTab !== 'sync' && (
            <div className="field" style={{ flex: 1, minWidth: '210px' }}>
              <label htmlFor="codification-import-target">Target Chapter</label>
              <select id="codification-import-target" value={importTargetChapId} onChange={(e) => setImportTargetChapId(e.target.value)}>
                <option value="">Auto-detect chapters from PDFs / filenames</option>
                {chapters.map(c => (
                  <option key={c.id} value={c.id}>{c.code_prefix} — {c.title}</option>
                ))}
              </select>
            </div>
          )}
          <div style={{ display: 'flex', gap: '.95rem', flexWrap: 'wrap', alignItems: 'center', fontSize: '.85rem', paddingBottom: '.3rem' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem' }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={importSplitChildren} onChange={(e) => setImportSplitChildren(e.target.checked)} />
              <span>Auto-split sub-sections (101 → 101.010…)</span>
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem' }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={importEnableOcr} onChange={(e) => setImportEnableOcr(e.target.checked)} />
              <span>OCR fallback (scanned/corrupt fonts)</span>
            </label>
            {studioTab !== 'sync' && (
              <>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem' }}>
                  <input type="checkbox" style={{ width: 'auto' }} checked={importOverwrite} onChange={(e) => setImportOverwrite(e.target.checked)} />
                  <span>Overwrite existing</span>
                </label>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem' }}>
                  <input type="checkbox" style={{ width: 'auto' }} checked={importPublishImmediately} onChange={(e) => setImportPublishImmediately(e.target.checked)} />
                  <span>Publish immediately</span>
                </label>
              </>
            )}
          </div>
        </div>

        {/* TAB 1: DRAG-AND-DROP FOLDER / ZIP / PDFs */}
        {studioTab === 'upload' && (
          <div>
            <div
              className={`code-dropzone${isDragging ? ' dragging' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={async (e) => {
                e.preventDefault();
                setIsDragging(false);
                const items = Array.from(e.dataTransfer?.items || []);
                if (items.some((it) => typeof it.webkitGetAsEntry === 'function')) {
                  const nested = await Promise.all(items.map((it) => collectDroppedFiles(it.webkitGetAsEntry())));
                  queueFiles(nested.flat());
                } else {
                  queueFiles(e.dataTransfer?.files || []);
                }
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: '.25rem' }}>
                Drag &amp; drop a folder of PDFs, a <code>.zip</code> archive, or an entire Code Book PDF here
              </div>
              <div className="muted" style={{ fontSize: '.84rem', marginBottom: '.65rem' }}>
                Processes in streamed batches with live progress — ideal for migrating an entire municipality at once.
              </div>
              <input
                id="codification-bulk-files"
                type="file"
                multiple
                accept=".pdf,.zip,application/pdf,application/zip"
                hidden
                onChange={(e) => queueFiles(e.target.files)}
              />
              <input
                id="codification-bulk-folder"
                type="file"
                multiple
                webkitdirectory=""
                directory=""
                hidden
                onChange={(e) => queueFiles(e.target.files)}
              />
              <div className="actions" style={{ justifyContent: 'center' }}>
                <button type="button" className="btn sm" disabled={importBusy} onClick={() => document.getElementById('codification-bulk-files')?.click()}>
                  Select PDF / .zip Files
                </button>
                <button type="button" className="btn sm" disabled={importBusy} onClick={() => document.getElementById('codification-bulk-folder')?.click()}>
                  Select Folder
                </button>
              </div>
            </div>

            {importFiles.length > 0 && (
              <div className="between" style={{ marginBottom: '.75rem', padding: '.5rem .75rem', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6 }}>
                <span style={{ fontSize: '.88rem' }}>
                  Ready: <strong>{importFiles.length}</strong> file(s) ({totalSelectedMb} MB)
                  {importFiles.slice(0, 3).map((f) => ` · ${f.name}`).join('')}
                  {importFiles.length > 3 ? ` + ${importFiles.length - 3} more` : ''}
                </span>
                <div className="actions">
                  <button type="button" className="btn sm" disabled={importBusy} onClick={() => { setImportFiles([]); setImportPreview(null); }}>
                    Clear
                  </button>
                  <button type="button" className="btn sm" disabled={importBusy} onClick={() => runBatchedPdfImport(false)}>
                    Analyze &amp; Preview Tree
                  </button>
                  <button type="button" className="btn sm primary" disabled={importBusy} onClick={() => runBatchedPdfImport(true)}>
                    Bulk Import &amp; Codify Now
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: WEBSITE CRAWLER & BULK URL IMPORT */}
        {studioTab === 'urls' && (
          <div>
            <div className="row" style={{ alignItems: 'flex-end', marginBottom: '.65rem' }}>
              <div className="field" style={{ flex: 2, minWidth: '240px' }}>
                <label htmlFor="crawl-page-url">Existing City Code Webpage URL</label>
                <input
                  id="crawl-page-url"
                  type="url"
                  placeholder="https://www.cityofexample.gov/city-code/"
                  value={crawlPageUrl}
                  onChange={(e) => setCrawlPageUrl(e.target.value)}
                />
              </div>
              <button
                type="button"
                className="btn sm primary"
                disabled={importBusy || !crawlPageUrl.trim()}
                onClick={() => runDiscoverUrls('page')}
              >
                Scan Webpage for PDFs
              </button>
            </div>

            <details style={{ marginBottom: '.75rem' }}>
              <summary style={{ cursor: 'pointer', fontSize: '.86rem', color: 'var(--cd-primary)', fontWeight: 600 }}>
                Or paste a list of direct PDF URLs (one per line)
              </summary>
              <div style={{ marginTop: '.45rem' }}>
                <textarea
                  rows={4}
                  placeholder={'https://example.gov/code/Section-101.pdf\nhttps://example.gov/code/Section-102.pdf'}
                  value={crawlUrlsText}
                  onChange={(e) => setCrawlUrlsText(e.target.value)}
                />
                <div style={{ marginTop: '.35rem' }}>
                  <button
                    type="button"
                    className="btn sm"
                    disabled={importBusy || !crawlUrlsText.trim()}
                    onClick={() => runDiscoverUrls('list')}
                  >
                    Load URL List
                  </button>
                </div>
              </div>
            </details>

            {discoveredUrls.length > 0 && (
              <div style={{ border: '1px solid #cbd5e1', borderRadius: 8, padding: '.75rem', background: '#f8fafc', marginBottom: '.75rem' }}>
                <div className="between" style={{ marginBottom: '.5rem', gap: '.5rem', flexWrap: 'wrap' }}>
                  <div>
                    <strong>{discoveredUrls.length} PDF Link(s) Discovered</strong>
                    {discoverPageTitle && <span className="muted" style={{ fontSize: '.82rem', marginLeft: 8 }}>({discoverPageTitle})</span>}
                  </div>
                  <div className="actions">
                    <input
                      type="search"
                      aria-label="Filter discovered URLs"
                      placeholder="Filter PDFs…"
                      style={{ width: '160px', padding: '.25rem .45rem', fontSize: '.82rem' }}
                      value={urlFilter}
                      onChange={(e) => setUrlFilter(e.target.value)}
                    />
                    <button type="button" className="btn sm" onClick={() => setSelectedUrls(new Set(discoveredUrls.map((i) => i.url)))}>
                      Select All
                    </button>
                    <button type="button" className="btn sm" onClick={() => setSelectedUrls(new Set())}>
                      None
                    </button>
                    <button type="button" className="btn sm" disabled={importBusy || !selectedUrls.size} onClick={() => runBatchedUrlImport(false)}>
                      Analyze Selected ({selectedUrls.size})
                    </button>
                    <button type="button" className="btn sm primary" disabled={importBusy || !selectedUrls.size} onClick={() => runBatchedUrlImport(true)}>
                      Import &amp; Codify Selected ({selectedUrls.size})
                    </button>
                  </div>
                </div>
                <div style={{ maxHeight: 260, overflowY: 'auto', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6 }}>
                  <table>
                    <thead>
                      <tr><th style={{ width: 32 }}></th><th>Ch.</th><th>Sec.</th><th>Title / Link Label</th><th>Filename</th></tr>
                    </thead>
                    <tbody>
                      {filteredUrls.map((it) => (
                        <tr key={it.url}>
                          <td>
                            <input
                              type="checkbox"
                              style={{ width: 'auto' }}
                              checked={selectedUrls.has(it.url)}
                              onChange={() => {
                                setSelectedUrls((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(it.url)) next.delete(it.url);
                                  else next.add(it.url);
                                  return next;
                                });
                              }}
                            />
                          </td>
                          <td><span className="badge active">{it.chapter_prefix}</span></td>
                          <td><strong>{it.section_number || '—'}</strong></td>
                          <td>{it.title || it.link_text || '—'}</td>
                          <td className="muted" style={{ fontSize: '.78rem' }}>{it.filename}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 3: SYNC EXISTING LINKED PDFS */}
        {studioTab === 'sync' && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '.6rem', padding: '.4rem 0' }}>
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center', fontSize: '.86rem' }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem' }}>
                <input type="checkbox" style={{ width: 'auto' }} checked={bulkOnlyEmpty} onChange={(e) => setBulkOnlyEmpty(e.target.checked)} />
                <span>Only import sections missing body text</span>
              </label>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem' }}>
                <input type="checkbox" style={{ width: 'auto' }} checked={bulkReformat} onChange={(e) => setBulkReformat(e.target.checked)} />
                <span>Split &amp; reformat existing sections</span>
              </label>
            </div>
            <button type="button" className="btn sm primary" disabled={importBusy || !chapters.length} onClick={() => runBulkLinkedImport(null)}>
              Auto-Import All Linked PDFs &amp; Split Sections
            </button>
          </div>
        )}

        {/* PROGRESS BAR */}
        {progressInfo && (
          <div className="code-progress-wrap" role="status">
            <div className="between" style={{ fontSize: '.84rem' }}>
              <strong>{progressInfo.label}</strong>
              <span className="muted">{progressInfo.done} / {progressInfo.total}</span>
            </div>
            <div className="code-progress-bar">
              <div
                className="code-progress-fill"
                style={{ width: `${Math.max(6, Math.round((progressInfo.done / Math.max(1, progressInfo.total)) * 100))}%` }}
              />
            </div>
          </div>
        )}

        {/* INTERACTIVE EDITABLE PREVIEW PANEL */}
        {importPreview && (
          <div style={{ border: '1px solid #cbd5e1', borderRadius: 8, padding: '.85rem', background: '#f8fafc', marginTop: '.75rem' }}>
            <div className="between" style={{ marginBottom: '.5rem', flexWrap: 'wrap', gap: '.5rem' }}>
              <strong>
                Interactive Tree Preview: {importPreview.files_processed} PDF(s), {importPreview.total_nodes || importPreview.total_sections} node(s)
                {importPreview.ocr_files ? ` · OCR used on ${importPreview.ocr_files} PDF(s) (${importPreview.ocr_pages} pages)` : ''}
              </strong>
              <div className="actions">
                <button type="button" className="btn sm" disabled={importBusy} onClick={() => setImportPreview(null)}>Dismiss</button>
                <button type="button" className="btn sm primary" disabled={importBusy} onClick={commitEditedPreview}>
                  {importBusy ? 'Saving…' : 'Commit Preview Into City Code'}
                </button>
              </div>
            </div>
            {(importPreview.warnings || []).length > 0 && (
              <div className="error-msg" style={{ marginBottom: '.5rem' }}>
                {importPreview.warnings.join(' | ')}
              </div>
            )}
            <div style={{ display: 'grid', gap: '.65rem', maxHeight: 400, overflowY: 'auto' }}>
              {importPreview.chapters.map((ch, cIdx) => (
                <div key={cIdx} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, padding: '.65rem .8rem' }}>
                  <div style={{ fontWeight: 700, marginBottom: '.4rem' }}>
                    <span className="badge active" style={{ marginRight: 6 }}>{ch.code_prefix}</span>
                    {ch.title}
                  </div>
                  <div style={{ display: 'grid', gap: '.5rem' }}>
                    {ch.sections.map((sec, sIdx) => (
                      <PreviewTreeNode
                        key={sIdx}
                        node={sec}
                        path={[cIdx, sIdx]}
                        onUpdateNode={updatePreviewNodeField}
                        onFlattenChildren={flattenPreviewNode}
                        onRemoveChild={removePreviewChild}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* SUMMARY BANNERS */}
        {importSummary && (
          <div className="ok-msg" role="status" style={{ marginTop: '.65rem' }}>
            Bulk import completed: <strong>{importSummary.files_processed}</strong> PDF(s) processed,{' '}
            <strong>{importSummary.chapters_created}</strong> chapter(s) created,{' '}
            <strong>{importSummary.sections_created + (importSummary.children_created || 0)}</strong> section/sub-section(s) created,{' '}
            <strong>{importSummary.sections_updated + (importSummary.children_updated || 0)}</strong> updated
            {importSummary.ocr_files ? ` (OCR on ${importSummary.ocr_files} files)` : ''}
            {importSummary.failed?.length ? `, ${importSummary.failed.length} failed` : ''}.
          </div>
        )}
        {bulkResult && (
          <div className="ok-msg" role="status" style={{ marginTop: '.65rem' }}>
            Linked PDF sync finished: <strong>{bulkResult.imported}</strong> imported,{' '}
            <strong>{bulkResult.children_created}</strong> child sub-sections created,{' '}
            <strong>{bulkResult.ocr_used_count}</strong> OCR-recovered,{' '}
            <strong>{bulkResult.reformatted}</strong> reformatted, <strong>{bulkResult.skipped}</strong> unchanged
            {bulkResult.failed?.length ? `, ${bulkResult.failed.length} failed` : ''}.
          </div>
        )}
      </div>
      )}

      {tab === 'tree' && (
      <>
      {/* SEARCH + MANUAL ADD */}
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
              body: JSON.stringify({
                chapter_id: Number(newSecChapId),
                parent_id: newSecParentId ? Number(newSecParentId) : null,
                section_number: newSecNum.trim(),
                title: newSecTitle.trim(),
              }),
            });
            setNewSecNum(''); setNewSecTitle('');
            showToast('Section added', 'ok');
            await loadCode(search);
          }}
        >
          <div className="field" style={{ minWidth: '175px' }}>
            <label>Chapter</label>
            <select value={newSecChapId} onChange={(e) => { setNewSecChapId(e.target.value); setNewSecParentId(''); }}>
              {chapters.map(c => <option key={c.id} value={c.id}>{c.code_prefix} — {c.title}</option>)}
            </select>
          </div>
          <div className="field" style={{ minWidth: '165px' }}>
            <label>Parent Section (optional)</label>
            <select value={newSecParentId} onChange={(e) => setNewSecParentId(e.target.value)}>
              <option value="">Top-level section</option>
              {parentCandidates.map((p) => (
                <option key={p.id} value={p.id}>
                  {`${'— '.repeat(p.ancestors?.length || 0)}${p.section_number} ${p.title}`}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ minWidth: '100px' }}>
            <label>Section #</label>
            <input required placeholder="e.g. 101.010" value={newSecNum} onChange={(e) => setNewSecNum(e.target.value)} />
          </div>
          <div className="field" style={{ flex: 2, minWidth: '180px' }}>
            <label>New Section Title</label>
            <input required placeholder="e.g. Stormwater Runoff" value={newSecTitle} onChange={(e) => setNewSecTitle(e.target.value)} />
          </div>
          <button type="submit" className="btn sm primary">Add Section</button>
        </form>
      </div>

      {/* BULK ACTION BAR WHEN ROWS ARE SELECTED */}
      {selectedIds.size > 0 && (
        <div className="code-lib-bulk-bar" role="region" aria-label="Bulk codification actions">
          <strong>{selectedIds.size} selected</strong>
          <div className="actions" style={{ alignItems: 'center' }}>
            <button type="button" className="btn sm primary" disabled={bulkActionBusy} onClick={() => runBulkTableAction('publish')}>
              Publish
            </button>
            <button type="button" className="btn sm" disabled={bulkActionBusy} onClick={() => runBulkTableAction('unpublish')}>
              Set Draft
            </button>
            <button type="button" className="btn sm" disabled={bulkActionBusy} onClick={() => runBulkTableAction('split')}>
              Auto-Split
            </button>
            <button type="button" className="btn sm" disabled={bulkActionBusy} onClick={() => runBulkTableAction('reformat')}>
              Clean &amp; Format
            </button>
            <button type="button" className="btn sm" disabled={bulkActionBusy} onClick={() => runBulkTableAction('reextract')}>
              Re-Extract / OCR
            </button>
            <select
              aria-label="Move selected sections to chapter"
              style={{ width: 'auto', padding: '.25rem .45rem', fontSize: '.82rem' }}
              value={bulkMoveChapId}
              onChange={(e) => setBulkMoveChapId(e.target.value)}
            >
              {chapters.map((c) => <option key={c.id} value={c.id}>{c.code_prefix} — {c.title}</option>)}
            </select>
            <button type="button" className="btn sm" disabled={bulkActionBusy || !bulkMoveChapId} onClick={() => runBulkTableAction('move_chapter')}>
              Move
            </button>
            <button type="button" className="btn sm danger" disabled={bulkActionBusy} onClick={() => runBulkTableAction('delete')}>
              Delete
            </button>
            <button type="button" className="btn sm" disabled={bulkActionBusy} onClick={() => setSelectedIds(new Set())}>
              Clear
            </button>
          </div>
        </div>
      )}

      {chapters.map(c => {
        const chapAllIds = collectChapterSectionIds(c);
        const chapAllSelected = chapAllIds.length > 0 && chapAllIds.every((id) => selectedIds.has(id));
        return (
          <details key={c.id} className="card" open={!!search.trim()}>
            <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.6rem', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem' }}>
                <input
                  type="checkbox"
                  style={{ width: 'auto' }}
                  aria-label={`Select all sections in ${c.code_prefix}`}
                  checked={chapAllSelected}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => toggleSelectChapter(c)}
                />
                <span className="badge active">{c.code_prefix}</span>
                <span>{c.title}</span>
                <span className="badge draft">{c.is_published !== false ? 'Published' : 'Hidden'}</span>
                <span className="muted" style={{ fontWeight: 400 }}>({(c.sections || []).length} top-level)</span>
              </div>
              <div className="actions" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  className="btn sm"
                  disabled={importBusy}
                  onClick={(e) => {
                    e.preventDefault();
                    runBulkLinkedImport(c);
                  }}
                >
                  Sync PDFs
                </button>
                <button
                  type="button"
                  className="btn sm"
                  onClick={(e) => {
                    e.preventDefault();
                    setEditingChapter({
                      id: c.id,
                      code_prefix: c.code_prefix || '',
                      title: c.title || '',
                    });
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
                    await loadCode(search);
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
                    await loadCode(search);
                  }}
                >
                  Delete
                </button>
              </div>
            </summary>
            <div style={{ marginTop: '.85rem' }}>
              <table>
                <thead>
                  <tr><th style={{ width: 32 }}></th><th>Section</th><th>Title</th><th>Status</th><th>PDF / Text</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {renderAdminSectionRows(c.sections || [], 0)}
                </tbody>
              </table>
            </div>
          </details>
        );
      })}
      </>
      )}

      {editingChapter && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-chapter-title"
          style={{
            position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', zIndex: 1000,
          }}
          onClick={(e) => { if (e.target === e.currentTarget && !savingChapter) setEditingChapter(null); }}
        >
          <div className="card" style={{ width: '100%', maxWidth: '440px', margin: 0 }}>
            <h2 id="edit-chapter-title" style={{ marginTop: 0 }}>Edit Code Chapter</h2>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setSavingChapter(true);
                try {
                  await api(`/api/codification/chapters/${editingChapter.id}`, {
                    method: 'PATCH',
                    body: JSON.stringify({
                      code_prefix: editingChapter.code_prefix.trim(),
                      title: editingChapter.title.trim(),
                    }),
                  });
                  showToast('Chapter updated', 'ok');
                  setEditingChapter(null);
                  await loadCode(search);
                } catch (err) {
                  showToast(err.message || 'Failed to update chapter', 'error');
                } finally {
                  setSavingChapter(false);
                }
              }}
              style={{ display: 'grid', gap: '.75rem' }}
            >
              <div className="field">
                <label htmlFor="chap-edit-prefix">Chapter Prefix *</label>
                <input id="chap-edit-prefix" required value={editingChapter.code_prefix} onChange={(e) => setEditingChapter((f) => ({ ...f, code_prefix: e.target.value }))} />
              </div>
              <div className="field">
                <label htmlFor="chap-edit-title">Chapter Title *</label>
                <input id="chap-edit-title" required value={editingChapter.title} onChange={(e) => setEditingChapter((f) => ({ ...f, title: e.target.value }))} />
              </div>
              <div className="actions" style={{ justifyContent: 'flex-end' }}>
                <button type="button" className="btn" disabled={savingChapter} onClick={() => setEditingChapter(null)}>Cancel</button>
                <button type="submit" className="btn primary" disabled={savingChapter}>{savingChapter ? 'Saving…' : 'Save Chapter'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
