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

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, formatSize, todayIso } from '../../core/api.js';
import { InlineEditable } from '../../core/InlineEditable.jsx';
import { useToast } from '../../core/toast.jsx';

const MONTHS = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function recurrenceLabel(item) {
  if (item.recurrence === 'every_agenda') return 'Every Agenda';
  if (item.recurrence === 'monthly') return 'Monthly';
  if (item.recurrence === 'quarterly') return 'Quarterly';
  if (item.recurrence === 'yearly') return 'Yearly';
  if (item.recurrence === 'first_agenda_month') {
    const m = MONTHS[item.recurrence_month] || `Month ${item.recurrence_month}`;
    return `1st Agenda in ${m}`;
  }
  return 'One-time';
}

export function CreateTodoModal({ context, bodies = [], onClose, onCreated }) {
  const dlgRef = useRef(null);
  const [title, setTitle] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [targetBody, setTargetBody] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [recurrence, setRecurrence] = useState('none');
  const [recMonth, setRecMonth] = useState('1');
  const [notes, setNotes] = useState('');
  const [err, setErr] = useState('');
  const showToast = useToast();

  useEffect(() => {
    const dlg = dlgRef.current;
    if (!dlg) return;
    if (context) {
      setTitle(context.title || '');
      setAssignedTo('');
      setTargetBody(context.body || '');
      setTargetDate('');
      setRecurrence('none');
      setRecMonth('1');
      setNotes('');
      setErr('');
      if (!dlg.open) dlg.showModal();
    } else if (dlg.open) {
      dlg.close();
    }
  }, [context]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!context) return;
    setErr('');
    try {
      await api('/api/agendas/backlog', {
        method: 'POST',
        body: JSON.stringify({
          title: title.trim(),
          description: notes.trim(),
          assigned_to: assignedTo.trim(),
          target_body: targetBody,
          target_date: targetDate || null,
          recurrence,
          recurrence_month: recurrence === 'first_agenda_month' ? Number(recMonth) : null,
          source_agenda_id: context.agendaId,
          source_item_id: context.itemId,
        }),
      });
      showToast('Todo created from agenda item', 'ok');
      onCreated?.();
      onClose?.();
    } catch (error) {
      setErr(error.message);
    }
  };

  return (
    <dialog ref={dlgRef} style={{ maxWidth: '480px' }} onCancel={(e) => { e.preventDefault(); onClose?.(); }}>
      <h2>Create Todo from Item</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Create a tracked follow-up todo linked to this agenda item.
      </p>
      <form onSubmit={handleSubmit}>
        <div className="field">
          <label>Todo Title</label>
          <input required value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="row" style={{ marginBottom: '.65rem' }}>
          <div className="field" style={{ flex: 1, minWidth: '140px' }}>
            <label>Assigned To (optional)</label>
            <input placeholder="e.g. City Clerk" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} />
          </div>
          <div className="field" style={{ flex: 1, minWidth: '140px' }}>
            <label>Target Body</label>
            <select value={targetBody} onChange={(e) => setTargetBody(e.target.value)}>
              <option value="">Any Body</option>
              {bodies.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
        </div>
        <div className="row" style={{ marginBottom: '.65rem' }}>
          <div className="field" style={{ flex: 1, minWidth: '140px' }}>
            <label>Due / Pop-Up Date</label>
            <input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
          </div>
          <div className="field" style={{ flex: 1, minWidth: '140px' }}>
            <label>Recurrence</label>
            <select value={recurrence} onChange={(e) => setRecurrence(e.target.value)}>
              <option value="none">One-time</option>
              <option value="every_agenda">Every Agenda</option>
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
              <option value="yearly">Yearly</option>
              <option value="first_agenda_month">1st Agenda of Month…</option>
            </select>
          </div>
          {recurrence === 'first_agenda_month' && (
            <div className="field">
              <label>Month</label>
              <select value={recMonth} onChange={(e) => setRecMonth(e.target.value)}>
                {MONTHS.slice(1).map((m, idx) => <option key={m} value={idx + 1}>{m}</option>)}
              </select>
            </div>
          )}
        </div>
        <div className="field">
          <label>Notes</label>
          <textarea rows={2} placeholder="Follow-up details..." value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        {err && <div className="error-msg" role="alert">{err}</div>}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary">Create Todo</button>
        </div>
      </form>
    </dialog>
  );
}

export default function BacklogPage({ onNavigate, onBacklogCount }) {
  const [items, setItems] = useState([]);
  const [agendas, setAgendas] = useState([]);
  const [bodies, setBodies] = useState([]);
  const [sections, setSections] = useState([]);

  const [title, setTitle] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [targetBody, setTargetBody] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [recurrence, setRecurrence] = useState('none');
  const [recMonth, setRecMonth] = useState('1');
  const [section, setSection] = useState('');
  const [presenter, setPresenter] = useState('');
  const [motion, setMotion] = useState('');
  const [fiscal, setFiscal] = useState('');
  const [description, setDescription] = useState('');
  const [folder, setFolder] = useState('');
  const [formErr, setFormErr] = useState('');

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('open');
  const [bodyFilter, setBodyFilter] = useState('');
  const [folderFilter, setFolderFilter] = useState('');
  const [dragOverId, setDragOverId] = useState(null);
  const showToast = useToast();

  const loadAll = useCallback(async () => {
    const [bl, ags, prefs] = await Promise.all([
      api('/api/agendas/backlog'),
      api('/api/agendas'),
      api('/api/agendas/preferences'),
    ]);
    const list = Array.isArray(bl) ? bl : [];
    setItems(list);
    onBacklogCount?.(list);
    setAgendas(Array.isArray(ags) ? ags : []);
    setBodies(Array.isArray(prefs.bodies) ? prefs.bodies : []);
    setSections(Array.isArray(prefs.sections) ? prefs.sections : []);
  }, [onBacklogCount]);

  useEffect(() => {
    loadAll().catch(e => showToast(e.message, 'error'));
  }, [loadAll, showToast]);

  const folderOptions = useMemo(() => {
    const set = new Set();
    for (const it of items) {
      if ((it.folder || '').trim()) set.add(it.folder.trim());
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [items]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    const today = todayIso();
    return items.filter(it => {
      if (statusFilter === 'open' && it.todo_status === 'done') return false;
      if (statusFilter === 'done' && it.todo_status !== 'done') return false;
      if (statusFilter === 'due' && (it.todo_status === 'done' || (!it.target_date && it.recurrence !== 'every_agenda') || (it.target_date && it.target_date > today))) return false;
      if (statusFilter === 'recurring' && (!it.recurrence || it.recurrence === 'none')) return false;
      if (bodyFilter && it.target_body !== bodyFilter) return false;
      if (folderFilter === '__unfiled__' && (it.folder || '').trim()) return false;
      if (folderFilter && folderFilter !== '__unfiled__' && (it.folder || '').trim() !== folderFilter) return false;
      if (q && !(it.title || '').toLowerCase().includes(q) && !(it.description || '').toLowerCase().includes(q) && !(it.assigned_to || '').toLowerCase().includes(q) && !(it.folder || '').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, search, statusFilter, bodyFilter, folderFilter]);

  const handleCreate = async (e) => {
    e.preventDefault();
    setFormErr('');
    try {
      await api('/api/agendas/backlog', {
        method: 'POST',
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          section: section.trim(),
          presenter: presenter.trim(),
          recommended_motion: motion.trim(),
          fiscal_impact: fiscal.trim(),
          target_body: targetBody,
          target_date: targetDate || null,
          assigned_to: assignedTo.trim(),
          recurrence,
          recurrence_month: recurrence === 'first_agenda_month' ? Number(recMonth) : null,
          folder: folder.trim(),
        }),
      });
      setTitle(''); setAssignedTo(''); setTargetBody(''); setTargetDate('');
      setRecurrence('none'); setSection(''); setPresenter(''); setMotion(''); setFiscal(''); setDescription(''); setFolder('');
      showToast('Added to Todos & Backlog', 'ok');
      await loadAll();
    } catch (err) {
      setFormErr(err.message);
    }
  };

  const uploadDoc = async (itemId, file) => {
    const fd = new FormData();
    fd.append('file', file);
    await api(`/api/agendas/backlog/${itemId}/documents`, { method: 'POST', body: fd });
    showToast(`Uploaded "${file.name}"`, 'ok');
    await loadAll();
  };

  const today = todayIso();

  return (
    <section id="section-backlog">
      <h1>Todos &amp; Item Backlog</h1>

      <datalist id="backlog-sections-datalist">
        {sections.map(s => <option key={s} value={s} />)}
      </datalist>
      <datalist id="backlog-folders-datalist">
        {folderOptions.map(f => <option key={f} value={f} />)}
      </datalist>

      <div className="card">
        <h2>Add Todo or Backlog Item</h2>
        <form onSubmit={handleCreate}>
          <div className="row" style={{ marginBottom: '.75rem' }}>
            <div className="field" style={{ flex: 2, minWidth: '220px' }}>
              <label htmlFor="backlog-title">Title</label>
              <input id="backlog-title" required placeholder="e.g. Review Water Rates Ordinance" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="field" style={{ flex: 1, minWidth: '150px' }}>
              <label htmlFor="backlog-assigned">Assigned To (optional)</label>
              <input id="backlog-assigned" placeholder="e.g. City Engineer" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} />
            </div>
            <div className="field" style={{ flex: 1, minWidth: '160px' }}>
              <label htmlFor="backlog-target-body">Target Body</label>
              <select id="backlog-target-body" value={targetBody} onChange={(e) => setTargetBody(e.target.value)}>
                <option value="">Any Body</option>
                {bodies.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="backlog-target-date">Due / Pop-Up Date</label>
              <input id="backlog-target-date" type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
            </div>
          </div>
          <div className="row" style={{ marginBottom: '.75rem' }}>
            <div className="field" style={{ minWidth: '185px' }}>
              <label htmlFor="backlog-recurrence">Recurrence</label>
              <select id="backlog-recurrence" value={recurrence} onChange={(e) => setRecurrence(e.target.value)}>
                <option value="none">One-time</option>
                <option value="every_agenda">Every Agenda</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="yearly">Yearly</option>
                <option value="first_agenda_month">1st Agenda of Month…</option>
              </select>
            </div>
            {recurrence === 'first_agenda_month' && (
              <div className="field">
                <label htmlFor="backlog-recurrence-month">Month</label>
                <select id="backlog-recurrence-month" value={recMonth} onChange={(e) => setRecMonth(e.target.value)}>
                  {MONTHS.slice(1).map((m, idx) => <option key={m} value={idx + 1}>{m}</option>)}
                </select>
              </div>
            )}
            <div className="field" style={{ flex: 1, minWidth: '150px' }}>
              <label htmlFor="backlog-section">Suggested Section</label>
              <input id="backlog-section" list="backlog-sections-datalist" placeholder="e.g. New Business" value={section} onChange={(e) => setSection(e.target.value)} />
            </div>
            <div className="field" style={{ flex: 1, minWidth: '150px' }}>
              <label htmlFor="backlog-presenter">Presenter</label>
              <input id="backlog-presenter" placeholder="e.g. Public Works" value={presenter} onChange={(e) => setPresenter(e.target.value)} />
            </div>
            <div className="field" style={{ flex: 1, minWidth: '150px' }}>
              <label htmlFor="backlog-folder">Folder (optional)</label>
              <input id="backlog-folder" list="backlog-folders-datalist" placeholder="e.g. Capital Projects" value={folder} onChange={(e) => setFolder(e.target.value)} />
            </div>
          </div>
          <div className="row" style={{ marginBottom: '.75rem' }}>
            <div className="field" style={{ flex: 1, minWidth: '200px' }}>
              <label htmlFor="backlog-motion">Recommended Motion</label>
              <input id="backlog-motion" placeholder="e.g. Move to approve..." value={motion} onChange={(e) => setMotion(e.target.value)} />
            </div>
            <div className="field" style={{ flex: 1, minWidth: '180px' }}>
              <label htmlFor="backlog-fiscal">Fiscal Impact</label>
              <input id="backlog-fiscal" placeholder="e.g. $12,000 Water Fund" value={fiscal} onChange={(e) => setFiscal(e.target.value)} />
            </div>
          </div>
          <div className="field" style={{ marginBottom: '.75rem' }}>
            <label htmlFor="backlog-desc">Description / Notes</label>
            <textarea id="backlog-desc" rows={2} placeholder="Details, follow-up notes, or context..." value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <button type="submit" className="btn primary">Add to Backlog</button>
          {formErr && <div className="error-msg" role="alert">{formErr}</div>}
        </form>
      </div>

      <div className="card">
        <div className="row" style={{ marginBottom: '1rem', alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: 1, minWidth: '180px' }}>
            <label htmlFor="backlog-search">Search</label>
            <input id="backlog-search" type="search" placeholder="Filter todos &amp; backlog…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="field" style={{ minWidth: '150px' }}>
            <label htmlFor="backlog-filter-status">Status</label>
            <select id="backlog-filter-status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="open">Open / Active</option>
              <option value="due">Due Now</option>
              <option value="recurring">Recurring Only</option>
              <option value="done">Completed</option>
              <option value="all">All</option>
            </select>
          </div>
          <div className="field" style={{ minWidth: '170px' }}>
            <label htmlFor="backlog-filter-body">Target Body</label>
            <select id="backlog-filter-body" value={bodyFilter} onChange={(e) => setBodyFilter(e.target.value)}>
              <option value="">All Bodies</option>
              {bodies.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div className="field" style={{ minWidth: '180px' }}>
            <label htmlFor="backlog-filter-folder">Folder</label>
            <select id="backlog-filter-folder" value={folderFilter} onChange={(e) => setFolderFilter(e.target.value)}>
              <option value="">All Folders</option>
              <option value="__unfiled__">Unfiled</option>
              {folderOptions.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
        </div>

        {!filteredItems.length ? (
          <p className="muted">No matching todos or backlog items.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
            {filteredItems.map(it => {
              const isDone = it.todo_status === 'done';
              const isDue = !isDone && ((it.target_date && it.target_date <= today) || it.recurrence === 'every_agenda');
              const docs = Array.isArray(it.documents) ? it.documents : [];
              return (
                <div
                  key={it.id}
                  className={`item-card${dragOverId === it.id ? ' file-drag-over' : ''}`}
                  style={{ opacity: isDone ? 0.72 : 1, marginBottom: 0 }}
                  onDragOver={(e) => {
                    if (Array.from(e.dataTransfer?.types || []).includes('Files')) {
                      e.preventDefault();
                      setDragOverId(it.id);
                    }
                  }}
                  onDragLeave={() => { if (dragOverId === it.id) setDragOverId(null); }}
                  onDrop={async (e) => {
                    if (e.dataTransfer?.files?.length) {
                      e.preventDefault();
                      setDragOverId(null);
                      for (const f of Array.from(e.dataTransfer.files)) {
                        try { await uploadDoc(it.id, f); } catch (err) { showToast(err.message, 'error'); }
                      }
                    }
                  }}
                >
                  <div className="between" style={{ alignItems: 'flex-start', marginBottom: '.4rem' }}>
                    <div>
                      <InlineEditable
                        value={it.title}
                        required
                        style={{ fontWeight: 700, fontSize: '1rem', textDecoration: isDone ? 'line-through' : 'none' }}
                        onSave={async (next) => {
                          await api(`/api/agendas/backlog/${it.id}`, { method: 'PATCH', body: JSON.stringify({ title: next }) });
                          await loadAll();
                        }}
                      />
                      <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', marginTop: '.3rem', alignItems: 'center' }}>
                        <span className={`badge ${isDone ? 'active' : (isDue ? 'disabled' : 'draft')}`}>
                          {isDone ? 'Done' : (isDue ? 'Due' : 'Open')}
                        </span>
                        <span className="badge draft">{recurrenceLabel(it)}</span>
                        {it.target_body && <span className="badge text">{it.target_body}</span>}
                        <span className="badge" style={{ background: '#f1f5f9', color: '#334155', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <span>Folder:</span>
                          <InlineEditable
                            value={it.folder || ''}
                            placeholder="Unfiled"
                            onSave={async (next) => {
                              await api(`/api/agendas/backlog/${it.id}`, { method: 'PATCH', body: JSON.stringify({ folder: next }) });
                              await loadAll();
                            }}
                          />
                        </span>
                        {it.target_date && <span className="muted" style={{ fontSize: '.84rem' }}>Due: {it.target_date}</span>}
                        {it.assigned_to && <span className="muted" style={{ fontSize: '.84rem' }}>Assigned: {it.assigned_to}</span>}
                        {it.section && <span className="muted" style={{ fontSize: '.84rem' }}>Section: {it.section}</span>}
                      </div>
                    </div>
                    <div className="actions">
                      <select
                        className="btn sm"
                        style={{ width: 'auto' }}
                        defaultValue=""
                        aria-label={`Assign ${it.title} to agenda`}
                        onChange={async (e) => {
                          const val = e.target.value;
                          if (!val) return;
                          const [mode, idStr] = val.split(':');
                          const agendaId = Number(idStr);
                          const copy = mode === 'copy';
                          try {
                            await api(`/api/agendas/backlog/${it.id}/assign`, {
                              method: 'POST',
                              body: JSON.stringify({ target_agenda_id: agendaId, copy }),
                            });
                            showToast(`${copy ? 'Copied' : 'Moved'} "${it.title}" to agenda`, 'ok', {
                              label: 'Open',
                              onClick: () => onNavigate(`#agendas/${agendaId}`),
                            });
                            await loadAll();
                          } catch (err) {
                            showToast(err.message, 'error');
                          } finally {
                            e.target.value = '';
                          }
                        }}
                      >
                        <option value="">Add to Agenda…</option>
                        {agendas.length > 0 && (
                          <>
                            <optgroup label={it.recurrence && it.recurrence !== 'none' ? 'Add Instance to…' : 'Move to…'}>
                              {agendas.map(a => (
                                <option key={`m-${a.id}`} value={`move:${a.id}`}>
                                  {a.meeting_date ? `${a.title} (${a.meeting_date})` : a.title}
                                </option>
                              ))}
                            </optgroup>
                            {(!it.recurrence || it.recurrence === 'none') && (
                              <optgroup label="Copy to (keep in backlog)…">
                                {agendas.map(a => (
                                  <option key={`c-${a.id}`} value={`copy:${a.id}`}>
                                    {a.meeting_date ? `${a.title} (${a.meeting_date})` : a.title}
                                  </option>
                                ))}
                              </optgroup>
                            )}
                          </>
                        )}
                      </select>
                      <button
                        type="button"
                        className="btn sm"
                        onClick={async () => {
                          await api(`/api/agendas/backlog/${it.id}`, {
                            method: 'PATCH',
                            body: JSON.stringify({ todo_status: isDone ? 'open' : 'done' }),
                          });
                          await loadAll();
                        }}
                      >
                        {isDone ? 'Reopen' : 'Mark Done'}
                      </button>
                      <button
                        type="button"
                        className="btn sm danger"
                        onClick={async () => {
                          if (!confirm(`Delete "${it.title}" from backlog?`)) return;
                          await api(`/api/agendas/backlog/${it.id}`, { method: 'DELETE' });
                          await loadAll();
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  <InlineEditable
                    as="div"
                    multiline
                    value={it.description || ''}
                    placeholder="Add description or follow-up notes…"
                    className="muted"
                    style={{ fontSize: '.88rem', marginBottom: '.45rem' }}
                    onSave={async (next) => {
                      await api(`/api/agendas/backlog/${it.id}`, { method: 'PATCH', body: JSON.stringify({ description: next }) });
                      await loadAll();
                    }}
                  />

                  {docs.length > 0 && (
                    <ul className="doc-list">
                      {docs.map(d => (
                        <li key={d.id}>
                          <span>
                            <span className={`badge ${String(d.doc_type || '').toLowerCase()}`}>{d.doc_type}</span>{' '}
                            {d.title} <span className="muted">({formatSize(d.size_bytes)})</span>
                          </span>
                          <div className="actions">
                            <a className="btn sm" href={`/api/agendas/backlog/documents/${d.id}/download`} target="_blank" rel="noreferrer">Download</a>
                            <button
                              type="button"
                              className="btn sm danger"
                              onClick={async () => {
                                await api(`/api/agendas/backlog/${it.id}/documents/${d.id}`, { method: 'DELETE' });
                                await loadAll();
                              }}
                            >
                              Remove
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="drop-zone">
                    Drag &amp; drop files here or{' '}
                    <label style={{ color: '#1d4ed8', cursor: 'pointer', textDecoration: 'underline' }}>
                      browse
                      <input
                        type="file"
                        hidden
                        onChange={async (e) => {
                          const f = e.target.files?.[0];
                          if (f) {
                            try { await uploadDoc(it.id, f); } catch (err) { showToast(err.message, 'error'); }
                          }
                          e.target.value = '';
                        }}
                      />
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
