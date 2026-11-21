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
import { StructuredCodeBody, buildSectionMap, flattenTreeSections } from './codeHelpers.jsx';

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
                  Municode Preview
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
        {onRemoveChild && (
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
  const [importFiles, setImportFiles] = useState([]);
  const [importTargetChapId, setImportTargetChapId] = useState('');
  const [importOverwrite, setImportOverwrite] = useState(true);
  const [importSplitChildren, setImportSplitChildren] = useState(true);
  const [importEnableOcr, setImportEnableOcr] = useState(true);
  const [importPreview, setImportPreview] = useState(null);
  const [importBusy, setImportBusy] = useState(false);
  const [bulkOnlyEmpty, setBulkOnlyEmpty] = useState(true);
  const [bulkReformat, setBulkReformat] = useState(true);
  const [bulkProgress, setBulkProgress] = useState('');
  const [bulkResult, setBulkResult] = useState(null);
  const [expandedAdminRows, setExpandedAdminRows] = useState({});
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

  const runPdfImport = async (commit) => {
    if (!importFiles.length) return;
    setImportBusy(true);
    try {
      const fd = new FormData();
      for (const f of importFiles) fd.append('files', f);
      fd.append('commit', String(commit));
      fd.append('overwrite_existing', String(importOverwrite));
      fd.append('split_children', String(importSplitChildren));
      fd.append('enable_ocr', String(importEnableOcr));
      if (importTargetChapId) fd.append('target_chapter_id', importTargetChapId);
      if (commit && importPreview?.chapters) {
        fd.append('override_tree_json', JSON.stringify(importPreview.chapters));
      }
      const res = await api('/api/codification/import-pdfs', { method: 'POST', body: fd });
      if (!commit) {
        setImportPreview(res);
        showToast(
          `Analyzed ${res.files_processed} PDF(s) — ${res.total_nodes || res.total_sections} node(s)${res.ocr_files ? ` (OCR: ${res.ocr_files} files)` : ''}`,
          'ok',
        );
      } else {
        setImportPreview(null);
        setImportFiles([]);
        const inp = document.getElementById('codification-bulk-files');
        if (inp) inp.value = '';
        showToast(
          `Imported: ${res.chapters_created} chapter(s), ${res.sections_created + (res.children_created || 0)} created, ${res.sections_updated + (res.children_updated || 0)} updated`,
          'ok',
        );
        await loadCode(search);
      }
    } catch (err) {
      showToast(err.message || 'PDF import failed', 'error');
    } finally {
      setImportBusy(false);
    }
  };

  const runBulkLinkedImport = async () => {
    if (!chapters.length) return;
    setImportBusy(true);
    setBulkResult(null);
    const agg = { imported: 0, children_created: 0, children_updated: 0, ocr_used_count: 0, reformatted: 0, skipped: 0, failed: [] };
    try {
      for (let i = 0; i < chapters.length; i += 1) {
        const ch = chapters[i];
        setBulkProgress(`Processing ${ch.code_prefix} (${i + 1}/${chapters.length})…`);
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
      showToast(err.message || 'Linked PDF auto-import failed', 'error');
    } finally {
      setBulkProgress('');
      setImportBusy(false);
    }
  };

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

  const renderAdminSectionRows = (sections, depth = 0) => {
    const rows = [];
    for (const s of sections || []) {
      const children = s.children || [];
      const hasChildren = children.length > 0;
      const isOpen = hasChildren && (Boolean(search.trim()) || !!expandedAdminRows[s.id]);
      rows.push(
        <tr key={s.id}>
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
        <a href="/code" target="_blank" rel="noreferrer" className="btn sm">Open Municode Public Reader</a>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Automatic PDF Import, Sub-Section Splitting &amp; OCR</h2>
        <p className="muted" style={{ marginTop: 0, fontSize: '.9rem' }}>
          Upload per-section PDFs (e.g. <code>Section-101-Adoption.pdf</code>) or an entire multi-chapter Code book PDF. DocketHall automatically detects chapters, splits sub-sections (like <code>101.010</code>, <code>101.020</code>, or <code>Sec. 1-1</code>) into pull-down navigation items, and runs local Tesseract OCR when a PDF is scanned or uses broken fonts.
        </p>

        <div className="row" style={{ alignItems: 'flex-end', marginBottom: '.6rem' }}>
          <div className="field" style={{ flex: 2, minWidth: '240px' }}>
            <label htmlFor="codification-bulk-files">Select PDF File(s)</label>
            <input
              id="codification-bulk-files"
              type="file"
              multiple
              accept="application/pdf,.pdf"
              onChange={(e) => {
                setImportFiles(Array.from(e.target.files || []));
                setImportPreview(null);
              }}
            />
          </div>
          <div className="field" style={{ flex: 1, minWidth: '180px' }}>
            <label htmlFor="codification-import-target">Target Chapter</label>
            <select id="codification-import-target" value={importTargetChapId} onChange={(e) => setImportTargetChapId(e.target.value)}>
              <option value="">Auto-detect from PDFs / filenames</option>
              {chapters.map(c => (
                <option key={c.id} value={c.id}>{c.code_prefix} — {c.title}</option>
              ))}
            </select>
          </div>
          <div className="actions">
            <button type="button" className="btn sm" disabled={importBusy || !importFiles.length} onClick={() => runPdfImport(false)}>
              Analyze &amp; Preview Tree
            </button>
            <button type="button" className="btn sm primary" disabled={importBusy || !importFiles.length} onClick={() => runPdfImport(true)}>
              {importBusy ? 'Importing…' : 'Import Into City Code'}
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center', fontSize: '.86rem', marginBottom: '.75rem' }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem' }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={importSplitChildren} onChange={(e) => setImportSplitChildren(e.target.checked)} />
            <span>Auto-split sections into pull-down child sub-sections</span>
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem' }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={importEnableOcr} onChange={(e) => setImportEnableOcr(e.target.checked)} />
            <span>OCR fallback for scanned / garbled-font PDFs</span>
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem' }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={importOverwrite} onChange={(e) => setImportOverwrite(e.target.checked)} />
            <span>Overwrite existing sections</span>
          </label>
        </div>

        {importPreview && (
          <div style={{ border: '1px solid #cbd5e1', borderRadius: 8, padding: '.85rem', background: '#f8fafc', marginBottom: '.85rem' }}>
            <div className="between" style={{ marginBottom: '.5rem' }}>
              <strong>
                Interactive Tree Preview: {importPreview.files_processed} file(s), {importPreview.total_nodes || importPreview.total_sections} nodes
                {importPreview.ocr_files ? ` · OCR used on ${importPreview.ocr_files} file(s) (${importPreview.ocr_pages} pages)` : ''}
              </strong>
              <button type="button" className="btn sm" onClick={() => setImportPreview(null)}>Dismiss Preview</button>
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

        <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '.65rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '.6rem' }}>
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
          <button type="button" className="btn sm" disabled={importBusy} onClick={runBulkLinkedImport}>
            {bulkProgress || (importBusy ? 'Working…' : 'Auto-Import All Linked PDFs & Split Sections')}
          </button>
        </div>
        {bulkResult && (
          <div className="ok-msg" role="status">
            Auto-import finished: <strong>{bulkResult.imported}</strong> imported,{' '}
            <strong>{bulkResult.children_created}</strong> child sub-sections created,{' '}
            <strong>{bulkResult.ocr_used_count}</strong> OCR-recovered,{' '}
            <strong>{bulkResult.reformatted}</strong> reformatted, <strong>{bulkResult.skipped}</strong> unchanged
            {bulkResult.failed?.length ? `, ${bulkResult.failed.length} failed` : ''}.
          </div>
        )}
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

      {chapters.map(c => (
        <details key={c.id} className="card" open={!!search.trim()}>
          <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.6rem', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem' }}>
              <span className="badge active">{c.code_prefix}</span>
              <span>{c.title}</span>
              <span className="badge draft">{c.is_published !== false ? 'Published' : 'Hidden'}</span>
              <span className="muted" style={{ fontWeight: 400 }}>({(c.sections || []).length} top-level)</span>
            </div>
            <div className="actions" onClick={(e) => e.stopPropagation()}>
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
                <tr><th>Section</th><th>Title</th><th>Status</th><th>PDF / Text</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {renderAdminSectionRows(c.sections || [], 0)}
              </tbody>
            </table>
          </div>
        </details>
      ))}

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
