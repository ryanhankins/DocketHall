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

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, formatSize } from '../../core/api.js';
import { useToast } from '../../core/toast.jsx';
import AgendaQuickGuideModal from './AgendaQuickGuideModal.jsx';

export default function CouncilPage() {
  const [guideOpen, setGuideOpen] = useState(false);
  const [targets, setTargets] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [title, setTitle] = useState('');
  const [section, setSection] = useState('');
  const [targetAgendaId, setTargetAgendaId] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [targetNote, setTargetNote] = useState('');
  const [motion, setMotion] = useState('');
  const [fiscal, setFiscal] = useState('');
  const [description, setDescription] = useState('');
  const [queuedFiles, setQueuedFiles] = useState([]);
  const [dropActive, setDropActive] = useState(false);
  const [dragRowId, setDragRowId] = useState(null);
  const [msg, setMsg] = useState({ text: '', isError: false });
  const fileInputRef = useRef(null);
  const showToast = useToast();

  const loadData = useCallback(async () => {
    const [tgts, subs] = await Promise.all([
      api('/api/agendas/council/targets'),
      api('/api/agendas/council/submissions'),
    ]);
    setTargets(Array.isArray(tgts) ? tgts : []);
    setSubmissions(Array.isArray(subs) ? subs : []);
  }, []);

  useEffect(() => {
    loadData().catch(e => showToast(e.message, 'error'));
  }, [loadData, showToast]);

  useEffect(() => {
    const onAiAction = () => { loadData().catch(() => {}); };
    window.addEventListener('dockethall:ai-action', onAiAction);
    return () => window.removeEventListener('dockethall:ai-action', onAiAction);
  }, [loadData]);

  useEffect(() => {
    const prevent = (e) => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) {
        e.preventDefault();
      }
    };
    window.addEventListener('dragover', prevent);
    window.addEventListener('drop', prevent);
    return () => {
      window.removeEventListener('dragover', prevent);
      window.removeEventListener('drop', prevent);
    };
  }, []);

  const uploadSubmissionFiles = async (subId, files) => {
    const list = Array.from(files || []);
    if (!list.length) return;
    let uploaded = 0;
    for (const file of list) {
      const fd = new FormData();
      fd.append('file', file);
      await api(`/api/agendas/council/submissions/${subId}/documents`, { method: 'POST', body: fd });
      uploaded += 1;
    }
    showToast(`Uploaded ${uploaded} attachment(s)`, 'ok');
    await loadData();
  };

  const resetForm = () => {
    setEditingId(null);
    setTitle('');
    setSection('');
    setTargetAgendaId('');
    setTargetDate('');
    setTargetNote('');
    setMotion('');
    setFiscal('');
    setDescription('');
    setQueuedFiles([]);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMsg({ text: '', isError: false });
    try {
      const payload = {
        title: title.trim(),
        description: description.trim(),
        section: section.trim(),
        recommended_motion: motion.trim(),
        fiscal_impact: fiscal.trim(),
        target_agenda_id: targetAgendaId ? Number(targetAgendaId) : null,
        target_date: targetDate || null,
        target_note: targetNote.trim(),
      };
      const isEdit = editingId !== null;
      const saved = isEdit
        ? await api(`/api/agendas/council/submissions/${editingId}`, {
            method: 'PATCH',
            body: JSON.stringify(payload),
          })
        : await api('/api/agendas/council/submissions', {
            method: 'POST',
            body: JSON.stringify(payload),
          });
      const subId = saved?.id || editingId;
      for (const file of queuedFiles) {
        const fd = new FormData();
        fd.append('file', file);
        await api(`/api/agendas/council/submissions/${subId}/documents`, { method: 'POST', body: fd });
      }
      resetForm();
      setMsg({ text: isEdit ? 'Proposed agenda item updated.' : 'Agenda item submitted for staff review.', isError: false });
      showToast(isEdit ? 'Submission updated' : 'Submitted to staff', 'ok');
      await loadData();
    } catch (err) {
      setMsg({ text: err.message, isError: true });
    }
  };

  return (
    <section id="section-council">
      <div className="between" style={{ marginBottom: '.75rem' }}>
        <h1 style={{ margin: 0 }}>Propose Agenda Item</h1>
        <button type="button" className="btn sm" onClick={() => setGuideOpen(true)}>
          Clerk &amp; Council Quick Guide
        </button>
      </div>
      <AgendaQuickGuideModal open={guideOpen} onClose={() => setGuideOpen(false)} />

      <div className="card">
        <h2>{editingId !== null ? 'Edit Proposed Agenda Item' : 'Submit an Agenda Item'}</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Propose an item for an upcoming agenda. Staff will review and assign it to an agenda.
        </p>
        <form id="council-submit-form" onSubmit={handleSubmit}>
          <div className="row" style={{ marginBottom: '.75rem' }}>
            <div className="field" style={{ flex: 2, minWidth: '220px' }}>
              <label htmlFor="cs-title">Item Title</label>
              <input id="cs-title" required placeholder="e.g. Resolution Supporting Park Trail Grant" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="field" style={{ flex: 1, minWidth: '160px' }}>
              <label htmlFor="cs-section">Suggested Section (optional)</label>
              <input id="cs-section" placeholder="e.g. New Business" value={section} onChange={(e) => setSection(e.target.value)} />
            </div>
          </div>
          <div className="row" style={{ marginBottom: '.75rem' }}>
            <div className="field" style={{ flex: 1, minWidth: '200px' }}>
              <label htmlFor="cs-target-agenda">Requested Agenda (optional)</label>
              <select id="cs-target-agenda" value={targetAgendaId} onChange={(e) => setTargetAgendaId(e.target.value)}>
                <option value="">Any upcoming agenda</option>
                {targets.map(a => (
                  <option key={a.id} value={a.id}>{a.meeting_date ? `${a.title} (${a.meeting_date})` : a.title}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="cs-target-date">Requested Meeting Date (optional)</label>
              <input id="cs-target-date" type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
            </div>
            <div className="field" style={{ flex: 1, minWidth: '180px' }}>
              <label htmlFor="cs-target-note">Timing Note (optional)</label>
              <input id="cs-target-note" placeholder="e.g. Next City Council meeting" value={targetNote} onChange={(e) => setTargetNote(e.target.value)} />
            </div>
          </div>
          <div className="row" style={{ marginBottom: '.75rem' }}>
            <div className="field" style={{ flex: 1, minWidth: '200px' }}>
              <label htmlFor="cs-motion">Recommended Motion (optional)</label>
              <input id="cs-motion" placeholder="e.g. Move to approve..." value={motion} onChange={(e) => setMotion(e.target.value)} />
            </div>
            <div className="field" style={{ flex: 1, minWidth: '180px' }}>
              <label htmlFor="cs-fiscal">Fiscal Impact (optional)</label>
              <input id="cs-fiscal" placeholder="e.g. None / $5,000" value={fiscal} onChange={(e) => setFiscal(e.target.value)} />
            </div>
          </div>
          <div className="field" style={{ marginBottom: '.75rem' }}>
            <label htmlFor="cs-desc">Description / Background</label>
            <textarea id="cs-desc" rows={3} placeholder="Context, background, or supporting details..." value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="field" style={{ marginBottom: '.85rem' }}>
            <label htmlFor="cs-files">Attachments (optional &mdash; PDF, Word, Excel, PowerPoint, Image, Text)</label>
            <div
              id="cs-drop-zone"
              className={`drop-zone${dropActive ? ' file-drag-over' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputRef.current?.click(); } }}
              onDragOver={(e) => { e.preventDefault(); setDropActive(true); }}
              onDragLeave={() => setDropActive(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDropActive(false);
                const files = Array.from(e.dataTransfer?.files || []);
                if (files.length) setQueuedFiles(prev => [...prev, ...files]);
              }}
            >
              Drag &amp; drop files here, or click to select attachments
            </div>
            <input
              id="cs-files"
              ref={fileInputRef}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                const files = Array.from(e.target.files || []);
                if (files.length) setQueuedFiles(prev => [...prev, ...files]);
                e.target.value = '';
              }}
            />
            {queuedFiles.length > 0 && (
              <div id="cs-file-list" style={{ display: 'flex', flexWrap: 'wrap', gap: '.4rem', marginTop: '.45rem' }}>
                {queuedFiles.map((f, idx) => (
                  <span key={`${f.name}-${idx}`} className="badge draft" style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem' }}>
                    <span>{f.name} ({formatSize(f.size)})</span>
                    <button
                      type="button"
                      aria-label={`Remove ${f.name}`}
                      style={{ border: 0, background: 'transparent', cursor: 'pointer', fontWeight: 700, padding: 0, lineHeight: 1 }}
                      onClick={() => setQueuedFiles(prev => prev.filter((_, i) => i !== idx))}
                    >
                      &times;
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="actions">
            <button type="submit" className="btn primary">{editingId !== null ? 'Save Changes' : 'Submit Item'}</button>
            {editingId !== null && (
              <button type="button" className="btn" onClick={() => { resetForm(); setMsg({ text: '', isError: false }); }}>
                Cancel Edit
              </button>
            )}
          </div>
          {msg.text && <div className={msg.isError ? 'error-msg' : 'ok-msg'} role="status">{msg.text}</div>}
        </form>
      </div>

      <div className="card">
        <h2>My Submissions</h2>
        <table>
          <thead>
            <tr><th>Title</th><th>Requested</th><th>Status</th><th>Attachments &amp; Notes</th></tr>
          </thead>
          <tbody>
            {!submissions.length ? (
              <tr><td colSpan={4} className="muted">No submissions yet.</td></tr>
            ) : submissions.map(s => {
              const reqText = s.target_agenda_title || s.target_date || s.target_note || 'Any upcoming agenda';
              const badgeCls = s.status === 'accepted' ? 'badge active' : (s.status === 'declined' ? 'badge disabled' : 'badge draft');
              const docs = Array.isArray(s.documents) ? s.documents : [];
              return (
                <tr
                  key={s.id}
                  style={dragRowId === s.id ? { background: '#eff6ff' } : undefined}
                  onDragOver={(e) => {
                    if (s.status !== 'declined' && Array.from(e.dataTransfer?.types || []).includes('Files')) {
                      e.preventDefault();
                      setDragRowId(s.id);
                    }
                  }}
                  onDragLeave={() => { if (dragRowId === s.id) setDragRowId(null); }}
                  onDrop={async (e) => {
                    if (s.status !== 'declined' && e.dataTransfer?.files?.length) {
                      e.preventDefault();
                      setDragRowId(null);
                      try {
                        await uploadSubmissionFiles(s.id, e.dataTransfer.files);
                      } catch (err) {
                        showToast(err.message, 'error');
                      }
                    }
                  }}
                >
                  <td>{s.title}</td>
                  <td>{reqText}</td>
                  <td><span className={badgeCls}>{s.status}</span></td>
                  <td>
                    <div className="muted" style={{ fontSize: '.85rem', marginBottom: docs.length ? '.35rem' : 0 }}>
                      {s.review_note || (s.accepted_agenda_title ? `Added to ${s.accepted_agenda_title}` : 'Awaiting staff review')}
                    </div>
                    {docs.length > 0 && (
                      <ul style={{ margin: '0 0 .4rem', paddingLeft: '1.1rem', fontSize: '.84rem' }}>
                        {docs.map(d => (
                          <li key={d.id} style={{ marginBottom: '.2rem' }}>
                            <span>{d.title || d.filename}</span>
                            {' '}
                            <span className={d.approval_status === 'approved' ? 'badge active' : (d.approval_status === 'declined' ? 'badge disabled' : 'badge draft')}>
                              {d.approval_status === 'pending' ? 'Pending staff approval' : d.approval_status}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="actions">
                      {s.status !== 'declined' && (
                        <>
                          <input
                            id={`sub-file-inp-${s.id}`}
                            type="file"
                            multiple
                            hidden
                            onChange={async (e) => {
                              try {
                                await uploadSubmissionFiles(s.id, e.target.files);
                              } catch (err) {
                                showToast(err.message, 'error');
                              } finally {
                                e.target.value = '';
                              }
                            }}
                          />
                          <button
                            type="button"
                            className="btn sm"
                            onClick={() => document.getElementById(`sub-file-inp-${s.id}`)?.click()}
                          >
                            + Add Attachment (or drop on row)
                          </button>
                        </>
                      )}
                      {s.status === 'pending' && (
                        <>
                          <button
                            type="button"
                            className="btn sm"
                            onClick={() => {
                              setEditingId(s.id);
                              setTitle(s.title || '');
                              setSection(s.section || '');
                              setTargetAgendaId(s.target_agenda_id ? String(s.target_agenda_id) : '');
                              setTargetDate(s.target_date || '');
                              setTargetNote(s.target_note || '');
                              setMotion(s.recommended_motion || '');
                              setFiscal(s.fiscal_impact || '');
                              setDescription(s.description || '');
                              setQueuedFiles([]);
                              setMsg({ text: '', isError: false });
                              window.scrollTo({ top: 0, behavior: 'smooth' });
                            }}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="btn sm danger"
                            onClick={async () => {
                              if (!confirm(`Delete pending submission "${s.title}"?`)) return;
                              try {
                                await api(`/api/agendas/council/submissions/${s.id}`, { method: 'DELETE' });
                                if (editingId === s.id) resetForm();
                                showToast('Submission deleted', 'ok');
                                await loadData();
                              } catch (err) {
                                showToast(err.message, 'error');
                              }
                            }}
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
