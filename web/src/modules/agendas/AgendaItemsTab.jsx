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

import React, { useMemo, useRef, useState } from 'react';
import { api, formatSize } from '../../core/api.js';
import { checkPdfFileBeforeUpload } from '../../core/a11y.js';
import { InlineEditable } from '../../core/InlineEditable.jsx';
import PdfComplianceButton from '../../core/PdfComplianceButton.jsx';
import { useToast } from '../../core/toast.jsx';
import { CreateTodoModal } from './BacklogPage.jsx';

function TransferSelect({ otherAgendas, className, placeholder, ariaLabel, subjectLabel, onTransfer, onNavigate }) {
  const showToast = useToast();
  if (!otherAgendas.length) return null;

  return (
    <select
      className={`btn sm ${className}`}
      style={{ width: 'auto' }}
      aria-label={ariaLabel}
      defaultValue=""
      onChange={async (e) => {
        const raw = e.target.value;
        if (!raw) return;
        const [mode, idStr] = raw.split(':');
        const targetId = Number(idStr);
        const targetTitle = e.target.options[e.target.selectedIndex].textContent;
        const verb = mode === 'copy' ? 'Copy' : 'Move';
        if (!confirm(`${verb} ${subjectLabel} to "${targetTitle}"?`)) {
          e.target.value = '';
          return;
        }
        try {
          await onTransfer(targetId, mode === 'copy');
          if (mode === 'copy') e.target.value = '';
          showToast(
            `${mode === 'copy' ? 'Copied' : 'Moved'} ${subjectLabel} to "${targetTitle}"`,
            'ok',
            { label: 'Open', onClick: () => onNavigate(`#agendas/${targetId}`) },
          );
        } catch (err) {
          showToast(err.message, 'error');
          e.target.value = '';
        }
      }}
    >
      <option value="">{placeholder}</option>
      {[['move', 'Move to…'], ['copy', 'Copy to…']].map(([mode, grpLbl]) => (
        <optgroup key={mode} label={grpLbl}>
          {otherAgendas.map(oa => (
            <option key={`${mode}-${oa.id}`} value={`${mode}:${oa.id}`}>
              {oa.meeting_date ? `${oa.title} (${oa.meeting_date})` : oa.title}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

function ItemCard({
  agenda,
  item,
  otherAgendas,
  collapsed,
  onToggleCollapse,
  onAgendaUpdated,
  onNavigate,
  onOpenTodoModal,
  dragItemRef,
  dragDocRef,
  dragSectionRef,
}) {
  const [dragPos, setDragPos] = useState(null); // 'top' | 'bottom' | null
  const [fileDragOver, setFileDragOver] = useState(false);
  const [docOverId, setDocOverId] = useState(null); // { id, pos }
  const [docTitle, setDocTitle] = useState('');
  const [docErr, setDocErr] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);
  const cardRef = useRef(null);
  const showToast = useToast();

  const handleUploadFiles = async (files, explicitTitle = '') => {
    setDocErr('');
    setUploading(true);
    try {
      let latest = null;
      for (const f of files) {
        const fd = new FormData();
        fd.append('file', f);
        if (files.length === 1 && explicitTitle) fd.append('title', explicitTitle);
        latest = await api(`/api/agendas/${agenda.id}/items/${item.id}/documents`, {
          method: 'POST',
          body: fd,
        });
      }
      setDocTitle('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (latest) onAgendaUpdated(latest);
      for (const f of files) {
        const res = await checkPdfFileBeforeUpload(f);
        if (res && !res.compliant) {
          const textFail = (res.checks || []).some((c) => c.id === 'text' && c.status === 'fail');
          showToast(
            textFail
              ? `Accessibility warning: "${f.name}" has no selectable text layer (scanned PDF).`
              : `Accessibility warning: "${f.name}" scored ${res.score}% (${res.summary}). Use Check PDF for details.`,
            'error',
          );
        }
      }
    } catch (err) {
      setDocErr(err.message);
    } finally {
      setUploading(false);
    }
  };

  const docs = item.documents || [];
  const itemMeta = [
    item.presenter && `Presenter: ${item.presenter}`,
    item.recommended_motion && `Motion: ${item.recommended_motion}`,
    item.fiscal_impact && `Fiscal: ${item.fiscal_impact}`,
  ].filter(Boolean);

  return (
    <div
      ref={cardRef}
      className={`item-card${dragPos === 'top' ? ' drag-over-top' : ''}${dragPos === 'bottom' ? ' drag-over-bottom' : ''}${fileDragOver ? ' file-drag-over' : ''}`}
      onDragStart={(e) => {
        if (dragDocRef.current !== null || dragSectionRef.current !== null) return;
        dragItemRef.current = item.id;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(item.id));
        cardRef.current?.classList.add('dragging');
      }}
      onDragEnd={() => {
        if (cardRef.current) cardRef.current.draggable = false;
        cardRef.current?.classList.remove('dragging');
        dragItemRef.current = null;
        setDragPos(null);
      }}
      onDragOver={(e) => {
        if (e.dataTransfer?.types && Array.from(e.dataTransfer.types).includes('Files')) {
          if (dragItemRef.current === null && dragDocRef.current === null) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            setFileDragOver(true);
            return;
          }
        }
        if (dragDocRef.current && dragDocRef.current.itemId !== item.id) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          return;
        }
        if (dragItemRef.current === null || dragItemRef.current === item.id) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const rect = cardRef.current.getBoundingClientRect();
        setDragPos(e.clientY - rect.top < rect.height / 2 ? 'top' : 'bottom');
      }}
      onDragLeave={(e) => {
        if (!cardRef.current?.contains(e.relatedTarget)) {
          setDragPos(null);
          setFileDragOver(false);
        }
      }}
      onDrop={async (e) => {
        if (e.dataTransfer?.files?.length && dragItemRef.current === null && dragDocRef.current === null) {
          e.preventDefault();
          e.stopPropagation();
          setFileDragOver(false);
          await handleUploadFiles(Array.from(e.dataTransfer.files));
          return;
        }
        if (dragSectionRef.current !== null) return;
        if (dragDocRef.current && dragDocRef.current.itemId !== item.id) {
          e.preventDefault();
          e.stopPropagation();
          const { itemId: srcItemId, docId } = dragDocRef.current;
          dragDocRef.current = null;
          onAgendaUpdated(await api(`/api/agendas/${agenda.id}/items/${srcItemId}/documents/${docId}`, {
            method: 'PATCH',
            body: JSON.stringify({ target_item_id: item.id, position: docs.length + 1 }),
          }));
          return;
        }
        if (dragItemRef.current === null || dragItemRef.current === item.id) return;
        e.preventDefault();
        e.stopPropagation();
        const draggedId = dragItemRef.current;
        const fromIdx = agenda.items.findIndex(x => x.id === draggedId);
        const targetIdx = agenda.items.findIndex(x => x.id === item.id);
        const before = dragPos === 'top';
        setDragPos(null);
        dragItemRef.current = null;
        if (fromIdx < 0 || targetIdx < 0) return;
        let newPos = before ? targetIdx + 1 : targetIdx + 2;
        if (fromIdx < targetIdx) newPos -= 1;
        onAgendaUpdated(await api(`/api/agendas/${agenda.id}/items/${draggedId}`, {
          method: 'PATCH',
          body: JSON.stringify({ position: newPos, section: item.section || '' }),
        }));
      }}
    >
      <div className="item-header" style={collapsed ? { marginBottom: 0 } : undefined}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '.35rem' }}>
          <span
            className="drag-handle"
            title="Drag to reorder item"
            aria-label="Drag to reorder item"
            onMouseDown={() => { if (cardRef.current) cardRef.current.draggable = true; }}
            onMouseUp={() => { if (cardRef.current) cardRef.current.draggable = false; }}
            onMouseLeave={() => { if (cardRef.current && dragItemRef.current !== item.id) cardRef.current.draggable = false; }}
          >
            &#8942;&#8942;
          </span>
          <button
            type="button"
            className="btn sm"
            style={{ padding: '.15rem .45rem', lineHeight: 1.1 }}
            title={collapsed ? 'Expand item' : 'Collapse item'}
            aria-expanded={!collapsed}
            onClick={onToggleCollapse}
          >
            {collapsed ? '▸' : '▾'}
          </button>
          <div>
            <div>
              {item.section && (
                <>
                  <InlineEditable
                    value={item.section}
                    listId="agenda-sections-datalist"
                    className="badge draft"
                    title="Click to edit section"
                    onSave={async (next) => onAgendaUpdated(await api(`/api/agendas/${agenda.id}/items/${item.id}`, {
                      method: 'PATCH', body: JSON.stringify({ section: next }),
                    }))}
                  />{' '}
                </>
              )}
              <span style={{ fontWeight: 700 }}>{item.position}. </span>
              <InlineEditable
                value={item.title}
                required
                title="Click to edit item title"
                style={{ fontWeight: 700 }}
                onSave={async (next) => onAgendaUpdated(await api(`/api/agendas/${agenda.id}/items/${item.id}`, {
                  method: 'PATCH', body: JSON.stringify({ title: next }),
                }))}
              />
              {item.revision_status && (
                <>{' '}<span className="badge draft">{item.revision_status}</span></>
              )}
              {collapsed && (
                <span className="muted" style={{ fontSize: '.82rem', marginLeft: '.45rem' }}>
                  ({docs.length} {docs.length === 1 ? 'doc' : 'docs'})
                </span>
              )}
            </div>

            {!collapsed && (
              <>
                <InlineEditable
                  as="div"
                  multiline
                  value={item.description || ''}
                  placeholder="Add summary or notes…"
                  className="muted"
                  style={{ marginTop: '.25rem' }}
                  title="Click to edit summary or notes"
                  onSave={async (next) => onAgendaUpdated(await api(`/api/agendas/${agenda.id}/items/${item.id}`, {
                    method: 'PATCH', body: JSON.stringify({ description: next }),
                  }))}
                />
                {itemMeta.length > 0 && (
                  <div className="muted" style={{ fontSize: '.82rem', marginTop: '.25rem' }}>
                    {itemMeta.join(' · ')}
                  </div>
                )}
                <div className="muted" style={{ fontSize: '.8rem', marginTop: '.25rem', display: 'flex', alignItems: 'center', gap: '.35rem' }}>
                  <span>Video timestamp:</span>
                  <InlineEditable
                    value={item.video_timestamp || ''}
                    placeholder="e.g. 12:30"
                    onSave={async (next) => onAgendaUpdated(await api(`/api/agendas/${agenda.id}/items/${item.id}`, {
                      method: 'PATCH', body: JSON.stringify({ video_timestamp: next }),
                    }))}
                  />
                </div>
                {!item.section && (
                  <InlineEditable
                    as="div"
                    value=""
                    listId="agenda-sections-datalist"
                    placeholder="+ Add section"
                    className="muted"
                    style={{ fontSize: '.8rem', marginTop: '.25rem' }}
                    onSave={async (next) => onAgendaUpdated(await api(`/api/agendas/${agenda.id}/items/${item.id}`, {
                      method: 'PATCH', body: JSON.stringify({ section: next }),
                    }))}
                  />
                )}
              </>
            )}
          </div>
        </div>

        {!collapsed && (
          <div className="actions">
            <select
              className="btn sm"
              style={{ width: 'auto' }}
              aria-label="Revision status"
              value={item.revision_status || ''}
              onChange={async (e) => onAgendaUpdated(await api(`/api/agendas/${agenda.id}/items/${item.id}`, {
                method: 'PATCH', body: JSON.stringify({ revision_status: e.target.value }),
              }))}
            >
              <option value="">Ready / Normal</option>
              <option value="revised">Revised</option>
              <option value="addendum">Addendum</option>
            </select>

            <TransferSelect
              otherAgendas={otherAgendas}
              className="item-move-select"
              placeholder="Move/Copy…"
              ariaLabel="Move or copy item to another agenda"
              subjectLabel={`"${item.title}"`}
              onNavigate={onNavigate}
              onTransfer={async (targetId, copy) => {
                onAgendaUpdated(await api(`/api/agendas/${agenda.id}/items/${item.id}/move`, {
                  method: 'POST',
                  body: JSON.stringify({ target_agenda_id: targetId, copy }),
                }));
              }}
            />

            <button
              type="button"
              className="btn sm"
              onClick={() => onOpenTodoModal({ agendaId: agenda.id, itemId: item.id, title: item.title, body: agenda.body })}
            >
              Create Todo
            </button>

            <button
              type="button"
              className="btn sm"
              onClick={async () => {
                if (!confirm(`Move "${item.title}" out of this agenda and into Todos & Backlog?`)) return;
                onAgendaUpdated(await api(`/api/agendas/${agenda.id}/items/${item.id}/move-to-backlog`, { method: 'POST' }));
                showToast(`Moved "${item.title}" to Todos & Backlog`, 'ok');
              }}
            >
              To Backlog
            </button>

            <button
              type="button"
              className="btn sm danger"
              onClick={async () => {
                if (!confirm(`Remove item "${item.title}" and its documents?`)) return;
                onAgendaUpdated(await api(`/api/agendas/${agenda.id}/items/${item.id}`, { method: 'DELETE' }));
              }}
            >
              Remove Item
            </button>
          </div>
        )}
      </div>

      {!collapsed && (
        <>
          <ul className="doc-list">
            {docs.map(d => {
              const liId = `doc-li-${d.id}`;
              return (
                <li
                  key={d.id}
                  id={liId}
                  className={docOverId?.id === d.id ? (docOverId.pos === 'top' ? 'drag-over-top' : 'drag-over-bottom') : ''}
                  onDragStart={(e) => {
                    e.stopPropagation();
                    dragDocRef.current = { itemId: item.id, docId: d.id };
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', `doc:${d.id}`);
                    document.getElementById(liId)?.classList.add('dragging');
                  }}
                  onDragEnd={() => {
                    const el = document.getElementById(liId);
                    if (el) { el.draggable = false; el.classList.remove('dragging'); }
                    dragDocRef.current = null;
                    setDocOverId(null);
                  }}
                  onDragOver={(e) => {
                    if (!dragDocRef.current || dragDocRef.current.docId === d.id) return;
                    e.preventDefault();
                    e.stopPropagation();
                    const rect = e.currentTarget.getBoundingClientRect();
                    setDocOverId({ id: d.id, pos: e.clientY - rect.top < rect.height / 2 ? 'top' : 'bottom' });
                  }}
                  onDragLeave={() => {
                    if (docOverId?.id === d.id) setDocOverId(null);
                  }}
                  onDrop={async (e) => {
                    if (!dragDocRef.current || dragDocRef.current.docId === d.id) return;
                    e.preventDefault();
                    e.stopPropagation();
                    const { itemId: srcItemId, docId } = dragDocRef.current;
                    const before = docOverId?.pos === 'top';
                    setDocOverId(null);
                    dragDocRef.current = null;
                    const targetIdx = docs.findIndex(x => x.id === d.id);
                    if (srcItemId === item.id) {
                      const fromIdx = docs.findIndex(x => x.id === docId);
                      let newPos = before ? targetIdx + 1 : targetIdx + 2;
                      if (fromIdx < targetIdx) newPos -= 1;
                      onAgendaUpdated(await api(`/api/agendas/${agenda.id}/items/${item.id}/documents/${docId}`, {
                        method: 'PATCH', body: JSON.stringify({ position: newPos }),
                      }));
                    } else {
                      const newPos = before ? targetIdx + 1 : targetIdx + 2;
                      onAgendaUpdated(await api(`/api/agendas/${agenda.id}/items/${srcItemId}/documents/${docId}`, {
                        method: 'PATCH', body: JSON.stringify({ target_item_id: item.id, position: newPos }),
                      }));
                    }
                  }}
                >
                  <div>
                    <span
                      className="drag-handle"
                      title="Drag to reorder document"
                      aria-label="Drag to reorder document"
                      style={{ fontSize: '.95rem', marginRight: '.3rem' }}
                      onMouseDown={() => { const el = document.getElementById(liId); if (el) el.draggable = true; }}
                      onMouseUp={() => { const el = document.getElementById(liId); if (el) el.draggable = false; }}
                      onMouseLeave={() => {
                        const el = document.getElementById(liId);
                        if (el && (!dragDocRef.current || dragDocRef.current.docId !== d.id)) el.draggable = false;
                      }}
                    >
                      &#8942;&#8942;
                    </span>
                    <span className={`badge ${String(d.doc_type || '').toLowerCase()}`}>{d.doc_type}</span>{' '}
                    <InlineEditable
                      value={d.title}
                      required
                      title="Click to edit document title"
                      style={{ fontWeight: 600 }}
                      onSave={async (next) => onAgendaUpdated(await api(`/api/agendas/${agenda.id}/items/${item.id}/documents/${d.id}`, {
                        method: 'PATCH', body: JSON.stringify({ title: next }),
                      }))}
                    />{' '}
                    <span className="muted">({d.filename}, {formatSize(d.size_bytes)})</span>
                  </div>
                  <div className="actions">
                    <a className="btn sm" href={`/api/agendas/${agenda.id}/documents/${d.id}/pdf`} target="_blank" rel="noreferrer">View PDF</a>
                    <PdfComplianceButton url={`/api/agendas/${agenda.id}/documents/${d.id}/compliance`} title={d.title || d.filename} label="Check PDF" />
                    {d.doc_type !== 'PDF' && (
                      <a className="btn sm" href={`/api/agendas/${agenda.id}/documents/${d.id}/download`} target="_blank" rel="noreferrer">Original</a>
                    )}
                    <button
                      type="button"
                      className="btn sm danger"
                      onClick={async () => {
                        if (!confirm(`Remove document "${d.title}"?`)) return;
                        onAgendaUpdated(await api(`/api/agendas/${agenda.id}/items/${item.id}/documents/${d.id}`, { method: 'DELETE' }));
                      }}
                    >
                      Remove
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>

          <form
            className="row"
            style={{ marginTop: '.5rem' }}
            onSubmit={async (e) => {
              e.preventDefault();
              const f = fileInputRef.current?.files?.[0];
              if (!f) return;
              await handleUploadFiles([f], docTitle.trim());
            }}
          >
            <div className="field" style={{ flex: 1, minWidth: '180px' }}>
              <input placeholder="Document title (optional — defaults to filename)" value={docTitle} onChange={(e) => setDocTitle(e.target.value)} />
            </div>
            <div className="field">
              <input ref={fileInputRef} type="file" required />
            </div>
            <button type="submit" className="btn sm" disabled={uploading}>
              {uploading ? 'Uploading…' : 'Upload Document'}
            </button>
          </form>

          <div className="drop-zone">
            Drag &amp; drop PDF, Word, Excel, PowerPoint, image, or text files onto this item to attach
          </div>
          {docErr && <div className="error-msg" style={{ marginTop: '.4rem' }}>{docErr}</div>}

          <details style={{ marginTop: '.55rem' }}>
            <summary style={{ cursor: 'pointer', fontSize: '.85rem', color: '#486581' }}>
              Or add inline text / notes as a PDF document
            </summary>
            <InlineTextDocForm agendaId={agenda.id} itemId={item.id} onUploaded={onAgendaUpdated} />
          </details>

          <details style={{ marginTop: '.4rem' }}>
            <summary style={{ cursor: 'pointer', fontSize: '.85rem', color: '#1e3a5f', fontWeight: 600 }}>
              Draft Resolution / Ordinance from Template (PDF)
            </summary>
            <InlineTemplateDocForm agenda={agenda} item={item} onGenerated={onAgendaUpdated} />
          </details>

          <details style={{ marginTop: '.4rem' }}>
            <summary style={{ cursor: 'pointer', fontSize: '.85rem', color: '#166534', fontWeight: 600 }}>
              Adopt Ordinance &amp; Tag in City Code
            </summary>
            <AdoptToCodeForm agenda={agenda} item={item} onCodified={onAgendaUpdated} />
          </details>
        </>
      )}
    </div>
  );
}

function InlineTextDocForm({ agendaId, itemId, onUploaded }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [err, setErr] = useState('');

  return (
    <form
      style={{ marginTop: '.5rem' }}
      onSubmit={async (e) => {
        e.preventDefault();
        setErr('');
        try {
          const updated = await api(`/api/agendas/${agendaId}/items/${itemId}/text-documents`, {
            method: 'POST',
            body: JSON.stringify({ title: title.trim(), content: body }),
          });
          setTitle('');
          setBody('');
          onUploaded(updated);
        } catch (error) {
          setErr(error.message);
        }
      }}
    >
      <div className="field" style={{ marginBottom: '.5rem' }}>
        <input placeholder="Document title (e.g. Staff Report)" required value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="field" style={{ marginBottom: '.5rem' }}>
        <textarea rows={3} placeholder="Enter text content (will be converted to PDF in the packet)..." required value={body} onChange={(e) => setBody(e.target.value)} />
      </div>
      <button type="submit" className="btn sm">Add Text Document</button>
      {err && <div className="error-msg">{err}</div>}
    </form>
  );
}

function InlineTemplateDocForm({ agenda, item, onGenerated }) {
  const [templates, setTemplates] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [docKind, setDocKind] = useState('resolution');
  const [docNumber, setDocNumber] = useState(item.ordinance_number || '');
  const [title, setTitle] = useState(item.title || '');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function ensureTemplates() {
    if (loaded) return;
    setLoaded(true);
    try {
      const list = await api('/api/agendas/doc-templates');
      setTemplates(list || []);
      if (list?.length && !body) {
        const first = list[0];
        setDocKind(first.doc_kind || 'resolution');
        setBody(first.body_template || '');
      }
    } catch (error) {
      setErr(error.message);
    }
  }

  return (
    <form
      style={{ marginTop: '.5rem', padding: '.6rem', background: '#f8fafc', borderRadius: 6, border: '1px solid #cbd5e1' }}
      onFocus={ensureTemplates}
      onSubmit={async (e) => {
        e.preventDefault();
        setErr('');
        setBusy(true);
        try {
          const updated = await api(`/api/agendas/${agenda.id}/items/${item.id}/generate-document`, {
            method: 'POST',
            body: JSON.stringify({
              doc_kind: docKind,
              doc_number: docNumber.trim(),
              title: title.trim(),
              body,
              effective_date: effectiveDate.trim(),
            }),
          });
          onGenerated(updated);
        } catch (error) {
          setErr(error.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="row" style={{ gap: '.5rem', marginBottom: '.5rem' }}>
        <div className="field" style={{ flex: 1 }}>
          <label>Template</label>
          <select
            onClick={ensureTemplates}
            onChange={(e) => {
              const tpl = templates.find((t) => String(t.id) === e.target.value);
              if (tpl) {
                setDocKind(tpl.doc_kind || 'resolution');
                setBody(tpl.body_template || '');
              }
            }}
          >
            <option value="">-- Choose template --</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>{t.name} ({t.doc_kind})</option>
            ))}
          </select>
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Document Number</label>
          <input placeholder="e.g. ORD-2026-04 or RES-2026-12" value={docNumber} onChange={(e) => setDocNumber(e.target.value)} />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Effective Date (optional)</label>
          <input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
        </div>
      </div>
      <div className="field" style={{ marginBottom: '.5rem' }}>
        <label>Document Title</label>
        <input required value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="field" style={{ marginBottom: '.5rem' }}>
        <label>Body (supports {'{{city_name}}'}, {'{{doc_number}}'}, {'{{title}}'}, {'{{meeting_date}}'}, {'{{effective_date}}'})</label>
        <textarea rows={7} required value={body} onChange={(e) => setBody(e.target.value)} />
      </div>
      <button type="submit" className="btn sm primary" disabled={busy}>
        {busy ? 'Generating PDF…' : 'Generate & Attach PDF'}
      </button>
      {err && <div className="error-msg">{err}</div>}
    </form>
  );
}

function AdoptToCodeForm({ agenda, item, onCodified }) {
  const [chapters, setChapters] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [chapterId, setChapterId] = useState('');
  const [sectionNumber, setSectionNumber] = useState('');
  const [sectionTitle, setSectionTitle] = useState(item.title || '');
  const [ordinanceNumber, setOrdinanceNumber] = useState(item.ordinance_number || '');
  const [effectiveDate, setEffectiveDate] = useState(agenda.meeting_date || '');
  const [body, setBody] = useState(item.description || '');
  const [statusMsg, setStatusMsg] = useState('');
  const [err, setErr] = useState('');

  async function ensureChapters() {
    if (loaded) return;
    setLoaded(true);
    try {
      const res = await api('/api/codification/public');
      const list = res?.chapters || [];
      setChapters(list);
      if (list.length && !chapterId) setChapterId(String(list[0].id));
    } catch (error) {
      setErr(error.message);
    }
  }

  return (
    <form
      style={{ marginTop: '.5rem', padding: '.6rem', background: '#f0fdf4', borderRadius: 6, border: '1px solid #bbf7d0' }}
      onFocus={ensureChapters}
      onSubmit={async (e) => {
        e.preventDefault();
        setErr('');
        setStatusMsg('');
        try {
          const res = await api(`/api/agendas/${agenda.id}/items/${item.id}/adopt-to-code`, {
            method: 'POST',
            body: JSON.stringify({
              chapter_id: Number(chapterId),
              section_number: sectionNumber.trim(),
              section_title: sectionTitle.trim(),
              ordinance_number: ordinanceNumber.trim(),
              effective_date: effectiveDate.trim(),
              body,
            }),
          });
          setStatusMsg(`Code section ${res.section_number} ${res.action} and tagged with Ordinance ${res.ordinance_ref}.`);
          onCodified(await api(`/api/agendas/${agenda.id}`));
        } catch (error) {
          setErr(error.message);
        }
      }}
    >
      <div className="row" style={{ gap: '.5rem', marginBottom: '.5rem' }}>
        <div className="field" style={{ flex: 1 }}>
          <label>Code Chapter</label>
          <select required value={chapterId} onClick={ensureChapters} onChange={(e) => setChapterId(e.target.value)}>
            <option value="">-- Select chapter --</option>
            {chapters.map((c) => (
              <option key={c.id} value={c.id}>{c.code_prefix} — {c.title}</option>
            ))}
          </select>
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Section Number</label>
          <input required placeholder="e.g. 301.05" value={sectionNumber} onChange={(e) => setSectionNumber(e.target.value)} />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Ordinance Number</label>
          <input required placeholder="e.g. ORD-2026-04" value={ordinanceNumber} onChange={(e) => setOrdinanceNumber(e.target.value)} />
        </div>
      </div>
      <div className="row" style={{ gap: '.5rem', marginBottom: '.5rem' }}>
        <div className="field" style={{ flex: 2 }}>
          <label>Code Section Title</label>
          <input value={sectionTitle} onChange={(e) => setSectionTitle(e.target.value)} />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Effective Date</label>
          <input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
        </div>
      </div>
      <div className="field" style={{ marginBottom: '.5rem' }}>
        <label>Adopted Code Text</label>
        <textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
      </div>
      <button type="submit" className="btn sm primary">Adopt &amp; Tag City Code</button>
      {statusMsg && <div className="ok-msg" style={{ marginTop: '.4rem' }}>{statusMsg}</div>}
      {err && <div className="error-msg" style={{ marginTop: '.4rem' }}>{err}</div>}
    </form>
  );
}

export default function AgendaItemsTab({
  agenda,
  agendasList,
  configuredBodies,
  configuredSections,
  onAgendaUpdated,
  onNavigate,
  onOpenImportDialog,
  onRefreshAgenda,
}) {
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [section, setSection] = useState('');
  const [presenter, setPresenter] = useState('');
  const [motion, setMotion] = useState('');
  const [fiscal, setFiscal] = useState('');
  const [revision, setRevision] = useState('');
  const [formErr, setFormErr] = useState('');

  const [collapsedItems, setCollapsedItems] = useState(() => new Set());
  const [collapsedSections, setCollapsedSections] = useState(() => new Set());
  const [todoModalCtx, setTodoModalCtx] = useState(null);
  const [secOverIdx, setSecOverIdx] = useState(null); // { idx, pos }
  const [secHeaderDropIdx, setSecHeaderDropIdx] = useState(null);

  const dragItemRef = useRef(null);
  const dragDocRef = useRef(null);
  const dragSectionRef = useRef(null);

  const otherAgendas = useMemo(
    () => (agendasList || []).filter(a => a.id !== agenda.id),
    [agendasList, agenda.id],
  );

  const groups = useMemo(() => {
    const res = [];
    for (const item of agenda.items || []) {
      const secName = (item.section || '').trim();
      if (secName && res.length && res[res.length - 1].section === secName) {
        res[res.length - 1].items.push(item);
      } else {
        res.push({ section: secName, items: [item] });
      }
    }
    return res;
  }, [agenda.items]);

  const handleAddItem = async (e) => {
    e.preventDefault();
    setFormErr('');
    try {
      const updated = await api(`/api/agendas/${agenda.id}/items`, {
        method: 'POST',
        body: JSON.stringify({
          title: title.trim(),
          description: desc.trim(),
          section: section.trim(),
          presenter: presenter.trim(),
          recommended_motion: motion.trim(),
          fiscal_impact: fiscal.trim(),
          revision_status: revision,
        }),
      });
      setTitle(''); setDesc(''); setSection(''); setPresenter(''); setMotion(''); setFiscal(''); setRevision('');
      onAgendaUpdated(updated);
    } catch (err) {
      setFormErr(err.message);
    }
  };

  return (
    <div id="agenda-edit-pane">
      <datalist id="agenda-sections-datalist">
        {(configuredSections || []).map(s => <option key={s} value={s} />)}
      </datalist>

      <div className="card">
        <div className="between" style={{ marginBottom: '.6rem' }}>
          <h2 style={{ margin: 0 }}>Add Agenda Item</h2>
          <button type="button" className="btn sm" onClick={onOpenImportDialog}>
            Import from Another Agenda…
          </button>
        </div>
        <form onSubmit={handleAddItem}>
          <div className="row">
            <div className="field" style={{ flex: 1, minWidth: '150px' }}>
              <label htmlFor="item-section">Section</label>
              <input id="item-section" list="agenda-sections-datalist" placeholder="e.g. Consent" value={section} onChange={(e) => setSection(e.target.value)} />
            </div>
            <div className="field" style={{ flex: 2, minWidth: '200px' }}>
              <label htmlFor="item-title">Item Title</label>
              <input id="item-title" required placeholder="e.g. Approval of Minutes" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="field" style={{ flex: 2, minWidth: '220px' }}>
              <label htmlFor="item-desc">Summary / Notes (optional)</label>
              <input id="item-desc" placeholder="Brief summary or notes" value={desc} onChange={(e) => setDesc(e.target.value)} />
            </div>
            <button type="submit" className="btn primary">Add Item</button>
          </div>
          <div className="row" style={{ marginTop: '.55rem' }}>
            <div className="field" style={{ flex: 1, minWidth: '160px' }}>
              <label htmlFor="item-presenter">Presenter (optional)</label>
              <input id="item-presenter" placeholder="e.g. City Engineer" value={presenter} onChange={(e) => setPresenter(e.target.value)} />
            </div>
            <div className="field" style={{ flex: 2, minWidth: '220px' }}>
              <label htmlFor="item-motion">Recommended Motion (optional)</label>
              <input id="item-motion" placeholder="e.g. Move to approve Resolution 2026-14" value={motion} onChange={(e) => setMotion(e.target.value)} />
            </div>
            <div className="field" style={{ flex: 1, minWidth: '140px' }}>
              <label htmlFor="item-fiscal">Fiscal Impact (optional)</label>
              <input id="item-fiscal" placeholder="e.g. $25,000 General Fund" value={fiscal} onChange={(e) => setFiscal(e.target.value)} />
            </div>
            <div className="field" style={{ minWidth: '150px' }}>
              <label htmlFor="item-revision">Revision Status</label>
              <select id="item-revision" value={revision} onChange={(e) => setRevision(e.target.value)}>
                <option value="">Ready / Normal</option>
                <option value="revised">Revised</option>
                <option value="addendum">Addendum</option>
              </select>
            </div>
          </div>
          {formErr && <div className="error-msg" role="alert">{formErr}</div>}
        </form>
      </div>

      <div className="between" style={{ marginBottom: '.6rem' }}>
        <span className="muted" style={{ fontSize: '.85rem' }}>
          Collapse sections or items to focus while organizing.
        </span>
        <div className="actions">
          <button
            type="button"
            className="btn sm"
            onClick={() => {
              const nextItems = new Set(collapsedItems);
              const nextSecs = new Set(collapsedSections);
              for (const it of agenda.items || []) {
                nextItems.add(it.id);
                const s = (it.section || '').trim();
                if (s) nextSecs.add(`${agenda.id}:${s}`);
              }
              setCollapsedItems(nextItems);
              setCollapsedSections(nextSecs);
            }}
          >
            Collapse All
          </button>
          <button
            type="button"
            className="btn sm"
            onClick={() => {
              const nextItems = new Set(collapsedItems);
              const nextSecs = new Set(collapsedSections);
              for (const it of agenda.items || []) {
                nextItems.delete(it.id);
                const s = (it.section || '').trim();
                if (s) nextSecs.delete(`${agenda.id}:${s}`);
              }
              setCollapsedItems(nextItems);
              setCollapsedSections(nextSecs);
            }}
          >
            Expand All
          </button>
        </div>
      </div>

      {!agenda.items?.length ? (
        <div className="card muted">No agenda items yet. Add the first item above.</div>
      ) : groups.map((group, gIdx) => {
        const secKey = group.section ? `${agenda.id}:${group.section}` : '';
        const isSecCollapsed = !!(secKey && collapsedSections.has(secKey));
        const grpId = `sec-group-${gIdx}`;
        return (
          <div
            key={`${group.section || '__ungrouped__'}-${gIdx}`}
            id={grpId}
            className={`section-group${secOverIdx?.idx === gIdx ? (secOverIdx.pos === 'top' ? ' drag-over-top' : ' drag-over-bottom') : ''}`}
            onDragStart={(e) => {
              if (dragItemRef.current !== null || dragDocRef.current !== null) return;
              dragSectionRef.current = gIdx;
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', `section:${gIdx}`);
              document.getElementById(grpId)?.classList.add('dragging');
            }}
            onDragEnd={() => {
              const el = document.getElementById(grpId);
              if (el) { el.draggable = false; el.classList.remove('dragging'); }
              dragSectionRef.current = null;
              setSecOverIdx(null);
            }}
            onDragOver={(e) => {
              if (dragSectionRef.current === null || dragSectionRef.current === gIdx) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              const rect = e.currentTarget.getBoundingClientRect();
              setSecOverIdx({ idx: gIdx, pos: e.clientY - rect.top < rect.height / 2 ? 'top' : 'bottom' });
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget) && secOverIdx?.idx === gIdx) setSecOverIdx(null);
            }}
            onDrop={async (e) => {
              if (dragSectionRef.current === null || dragSectionRef.current === gIdx) return;
              e.preventDefault();
              e.stopPropagation();
              const fromIdx = dragSectionRef.current;
              const before = secOverIdx?.pos === 'top';
              dragSectionRef.current = null;
              setSecOverIdx(null);
              const reordered = [...groups];
              const [moved] = reordered.splice(fromIdx, 1);
              let insertAt = before ? gIdx : gIdx + 1;
              if (fromIdx < gIdx) insertAt -= 1;
              reordered.splice(insertAt, 0, moved);
              const orderedIds = reordered.flatMap(g => g.items.map(it => it.id));
              onAgendaUpdated(await api(`/api/agendas/${agenda.id}/items/reorder`, {
                method: 'POST', body: JSON.stringify({ item_ids: orderedIds }),
              }));
            }}
          >
            {group.section && (
              <div
                className="between"
                style={{
                  margin: '1.1rem 0 .5rem',
                  padding: '.35rem .5rem',
                  background: secHeaderDropIdx === gIdx ? '#dbeafe' : '#eef2ff',
                  borderLeft: '4px solid #1d4ed8',
                  borderRadius: '4px',
                }}
                onDragOver={(e) => {
                  if (dragItemRef.current === null) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  setSecHeaderDropIdx(gIdx);
                }}
                onDragLeave={() => { if (secHeaderDropIdx === gIdx) setSecHeaderDropIdx(null); }}
                onDrop={async (e) => {
                  if (dragItemRef.current === null) return;
                  e.preventDefault();
                  e.stopPropagation();
                  setSecHeaderDropIdx(null);
                  const draggedId = dragItemRef.current;
                  const fromIdx = agenda.items.findIndex(x => x.id === draggedId);
                  const firstId = group.items[0].id;
                  const targetIdx = agenda.items.findIndex(x => x.id === firstId);
                  let newPos = targetIdx + 1;
                  if (fromIdx < targetIdx) newPos -= 1;
                  dragItemRef.current = null;
                  onAgendaUpdated(await api(`/api/agendas/${agenda.id}/items/${draggedId}`, {
                    method: 'PATCH',
                    body: JSON.stringify({ position: newPos, section: group.section }),
                  }));
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '.45rem' }}>
                  <span
                    className="drag-handle"
                    title="Drag to reorder section"
                    aria-label="Drag to reorder section"
                    onMouseDown={() => { const el = document.getElementById(grpId); if (el) el.draggable = true; }}
                    onMouseUp={() => { const el = document.getElementById(grpId); if (el) el.draggable = false; }}
                    onMouseLeave={() => {
                      const el = document.getElementById(grpId);
                      if (el && dragSectionRef.current !== gIdx) el.draggable = false;
                    }}
                  >
                    &#8942;&#8942;
                  </span>
                  <button
                    type="button"
                    className="btn sm"
                    style={{ padding: '.15rem .45rem', lineHeight: 1.1 }}
                    title={isSecCollapsed ? 'Expand section' : 'Collapse section'}
                    aria-expanded={!isSecCollapsed}
                    onClick={() => {
                      setCollapsedSections(prev => {
                        const next = new Set(prev);
                        if (next.has(secKey)) next.delete(secKey);
                        else next.add(secKey);
                        return next;
                      });
                    }}
                  >
                    {isSecCollapsed ? '▸' : '▾'}
                  </button>
                  <span style={{ fontWeight: 700, fontSize: '.92rem', textTransform: 'uppercase', letterSpacing: '.04em', color: '#1e3a8a' }}>
                    {group.section}
                  </span>
                  <span className="muted" style={{ fontSize: '.82rem' }}>
                    ({group.items.length} {group.items.length === 1 ? 'item' : 'items'})
                  </span>
                </div>

                <TransferSelect
                  otherAgendas={otherAgendas}
                  className="section-move-select"
                  placeholder="Move/Copy Section…"
                  ariaLabel="Move or copy section to another agenda"
                  subjectLabel={`section "${group.section}" (${group.items.length} item(s))`}
                  onNavigate={onNavigate}
                  onTransfer={async (targetId, copy) => {
                    onAgendaUpdated(await api(`/api/agendas/${agenda.id}/sections/move`, {
                      method: 'POST',
                      body: JSON.stringify({ section: group.section, target_agenda_id: targetId, copy }),
                    }));
                  }}
                />
              </div>
            )}

            {!isSecCollapsed && group.items.map(item => (
              <ItemCard
                key={item.id}
                agenda={agenda}
                item={item}
                otherAgendas={otherAgendas}
                collapsed={collapsedItems.has(item.id)}
                onToggleCollapse={() => {
                  setCollapsedItems(prev => {
                    const next = new Set(prev);
                    if (next.has(item.id)) next.delete(item.id);
                    else next.add(item.id);
                    return next;
                  });
                }}
                onAgendaUpdated={onAgendaUpdated}
                onNavigate={onNavigate}
                onOpenTodoModal={setTodoModalCtx}
                dragItemRef={dragItemRef}
                dragDocRef={dragDocRef}
                dragSectionRef={dragSectionRef}
              />
            ))}
          </div>
        );
      })}

      <CreateTodoModal
        context={todoModalCtx}
        bodies={configuredBodies}
        onClose={() => setTodoModalCtx(null)}
        onCreated={onRefreshAgenda}
      />
    </div>
  );
}
