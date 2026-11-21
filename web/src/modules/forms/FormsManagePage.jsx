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

const EMPTY_FORM = {
  title: '',
  form_kind: 'form',
  description: '',
  allow_anonymous: true,
  show_poll_results: true,
  closes_at: '',
  is_public: true,
  sort_order: 0,
  fields: [],
};

const FORM_NOTIFICATION_EVENTS = [
  {
    key: 'forms_submitted',
    label: 'New Custom Form or Poll Submission',
    description: 'Sent to configured staff recipients whenever a resident submits a standalone form or poll.',
  },
];

export default function FormsManagePage() {
  const [forms, setForms] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [formDraft, setFormDraft] = useState({ ...EMPTY_FORM });

  // New/Edit field builder inputs
  const [fSection, setFSection] = useState('Form Details');
  const [fLabel, setFLabel] = useState('');
  const [fType, setFType] = useState('text');
  const [fOptions, setFOptions] = useState('');
  const [fReq, setFReq] = useState(false);

  // Submissions viewer
  const [selectedForm, setSelectedForm] = useState(null);
  const [submissions, setSubmissions] = useState([]);
  const [busy, setBusy] = useState(false);
  const showToast = useToast();

  const loadForms = useCallback(async () => {
    const rows = await api('/api/forms');
    setForms(Array.isArray(rows) ? rows : []);
  }, []);

  useEffect(() => {
    loadForms().catch((e) => showToast(e.message, 'error'));
  }, [loadForms, showToast]);

  const loadSubmissions = async (frm) => {
    setSelectedForm(frm);
    try {
      const rows = await api(`/api/forms/${frm.id}/submissions`);
      setSubmissions(Array.isArray(rows) ? rows : []);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const addDraftField = () => {
    if (!fLabel.trim()) return;
    const key = fLabel.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || `field_${formDraft.fields.length + 1}`;
    const fld = {
      key,
      section: fSection.trim() || 'Form Details',
      label: fLabel.trim(),
      type: fType,
      required: fReq,
    };
    if (fType === 'select' || fType === 'radio') {
      fld.options = fOptions.split('\n').map((s) => s.trim()).filter(Boolean);
    }
    setFormDraft((d) => ({ ...d, fields: [...(d.fields || []), fld] }));
    setFLabel('');
    setFOptions('');
    setFReq(false);
  };

  const saveForm = async (e) => {
    e.preventDefault();
    if (!formDraft.title.trim()) return;
    setBusy(true);
    try {
      const payload = {
        ...formDraft,
        title: formDraft.title.trim(),
        description: formDraft.description.trim(),
        closes_at: formDraft.closes_at || '',
        sort_order: Number(formDraft.sort_order) || 0,
      };
      if (editingId) {
        await api(`/api/forms/${editingId}`, { method: 'PATCH', body: JSON.stringify(payload) });
        showToast('Form updated', 'ok');
      } else {
        await api('/api/forms', { method: 'POST', body: JSON.stringify(payload) });
        showToast('Form created', 'ok');
      }
      setEditingId(null);
      setFormDraft({ ...EMPTY_FORM });
      await loadForms();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section id="section-forms-manage">
      <div className="between" style={{ marginBottom: '1rem' }}>
        <h1 style={{ margin: 0 }}>Forms &amp; Opinion Polls</h1>
        <a href="/#forms" target="_blank" rel="noreferrer" className="btn sm">View Public Forms &amp; Polls</a>
      </div>

      <div className="card">
        <h2>{editingId ? 'Edit Form / Poll' : 'Create New Form or Opinion Poll'}</h2>
        <form onSubmit={saveForm}>
          <div className="row" style={{ marginBottom: '.75rem' }}>
            <div className="field" style={{ flex: 2, minWidth: 220 }}>
              <label htmlFor="frm-title">Title *</label>
              <input id="frm-title" required value={formDraft.title} onChange={(e) => setFormDraft((d) => ({ ...d, title: e.target.value }))} />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 150 }}>
              <label htmlFor="frm-kind">Type</label>
              <select id="frm-kind" value={formDraft.form_kind} onChange={(e) => setFormDraft((d) => ({ ...d, form_kind: e.target.value }))}>
                <option value="form">Custom Form / Application</option>
                <option value="poll">Community Opinion Poll</option>
              </select>
            </div>
            <div className="field" style={{ minWidth: 150 }}>
              <label htmlFor="frm-closes">Closes After Date</label>
              <input id="frm-closes" type="date" value={formDraft.closes_at || ''} onChange={(e) => setFormDraft((d) => ({ ...d, closes_at: e.target.value }))} />
            </div>
          </div>

          <div className="field" style={{ marginBottom: '.75rem' }}>
            <label htmlFor="frm-desc">Description / Instructions</label>
            <input id="frm-desc" value={formDraft.description} onChange={(e) => setFormDraft((d) => ({ ...d, description: e.target.value }))} />
          </div>

          <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap', marginBottom: '.85rem' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem', cursor: 'pointer', fontSize: '.9rem' }}>
              <input type="checkbox" style={{ width: 'auto', flexShrink: 0 }} checked={formDraft.is_public} onChange={(e) => setFormDraft((d) => ({ ...d, is_public: e.target.checked }))} />
              <span>Published on Public Portal</span>
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem', cursor: 'pointer', fontSize: '.9rem' }}>
              <input type="checkbox" style={{ width: 'auto', flexShrink: 0 }} checked={formDraft.allow_anonymous} onChange={(e) => setFormDraft((d) => ({ ...d, allow_anonymous: e.target.checked }))} />
              <span>Allow anonymous submissions</span>
            </label>
            {formDraft.form_kind === 'poll' && (
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem', cursor: 'pointer', fontSize: '.9rem' }}>
                <input type="checkbox" style={{ width: 'auto', flexShrink: 0 }} checked={formDraft.show_poll_results} onChange={(e) => setFormDraft((d) => ({ ...d, show_poll_results: e.target.checked }))} />
                <span>Show live poll results to residents</span>
              </label>
            )}
          </div>

          <div style={{ padding: '.75rem', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, marginBottom: '.85rem' }}>
            <strong style={{ fontSize: '.9rem' }}>Form Questions ({(formDraft.fields || []).length})</strong>
            {(formDraft.fields || []).length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '.3rem', margin: '.5rem 0 .7rem' }}>
                {formDraft.fields.map((f, idx) => (
                  <div key={`${f.key}-${idx}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 4, padding: '4px 8px', fontSize: '.84rem' }}>
                    <div>
                      {f.section && <span className="muted">[{f.section}] </span>}
                      <strong>{f.label}</strong>{' '}
                      <span className="muted">({f.type}{f.required ? ', required' : ''})</span>
                      {Array.isArray(f.options) && f.options.length > 0 && (
                        <div className="muted" style={{ fontSize: '.78rem' }}>Options: {f.options.join(' · ')}</div>
                      )}
                    </div>
                    <button type="button" className="btn sm danger" onClick={() => setFormDraft((d) => ({ ...d, fields: d.fields.filter((_, i) => i !== idx) }))}>
                      &times;
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.45rem', marginTop: '.45rem' }}>
              <input placeholder="Section (e.g. Application Details)" value={fSection} onChange={(e) => setFSection(e.target.value)} />
              <select value={fType} onChange={(e) => setFType(e.target.value)}>
                <option value="text">Short Text</option>
                <option value="textarea">Long Text</option>
                <option value="radio">Single Choice / Poll Options (Radio)</option>
                <option value="select">Dropdown List (Select)</option>
                <option value="yes_no_explain">Yes / No + Explain</option>
                <option value="number">Number</option>
                <option value="date">Date</option>
              </select>
              <input
                placeholder="Question / Field Label"
                value={fLabel}
                onChange={(e) => setFLabel(e.target.value)}
                style={{ gridColumn: '1 / -1' }}
              />
              {(fType === 'select' || fType === 'radio') && (
                <textarea
                  rows={3}
                  placeholder="Enter one option per line..."
                  value={fOptions}
                  onChange={(e) => setFOptions(e.target.value)}
                  style={{ gridColumn: '1 / -1' }}
                />
              )}
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem', fontSize: '.84rem' }}>
                <input type="checkbox" style={{ width: 'auto', flexShrink: 0 }} checked={fReq} onChange={(e) => setFReq(e.target.checked)} />
                Required
              </label>
              <div style={{ textAlign: 'right' }}>
                <button type="button" className="btn sm" onClick={addDraftField}>+ Add Question</button>
              </div>
            </div>
          </div>

          <div className="actions">
            <button type="submit" className="btn primary" disabled={busy}>
              {busy ? 'Saving…' : (editingId ? 'Save Form' : 'Create Form')}
            </button>
            {editingId && (
              <button type="button" className="btn" onClick={() => { setEditingId(null); setFormDraft({ ...EMPTY_FORM }); }}>
                Cancel
              </button>
            )}
          </div>
        </form>
      </div>

      <div className="card">
        <h2>Configured Forms &amp; Polls ({forms.length})</h2>
        <table>
          <thead>
            <tr><th>Title</th><th>Type</th><th>Submissions</th><th>Status</th><th style={{ width: 240 }}>Actions</th></tr>
          </thead>
          <tbody>
            {forms.map((frm) => (
              <tr key={frm.id}>
                <td>
                  <strong>{frm.title}</strong>
                  {frm.description && <div className="muted" style={{ fontSize: '.82rem' }}>{frm.description}</div>}
                </td>
                <td><span className="badge draft">{frm.form_kind === 'poll' ? 'Opinion Poll' : 'Form'}</span></td>
                <td>{frm.submission_count || 0}</td>
                <td><span className={`badge ${frm.is_public ? 'active' : 'disabled'}`}>{frm.is_public ? 'Public' : 'Hidden'}</span></td>
                <td>
                  <div className="actions">
                    <button type="button" className="btn sm primary" onClick={() => loadSubmissions(frm)}>Responses</button>
                    <button
                      type="button"
                      className="btn sm"
                      onClick={() => {
                        setEditingId(frm.id);
                        setFormDraft({
                          title: frm.title || '',
                          form_kind: frm.form_kind || 'form',
                          description: frm.description || '',
                          allow_anonymous: Boolean(frm.allow_anonymous),
                          show_poll_results: Boolean(frm.show_poll_results),
                          closes_at: frm.closes_at || '',
                          is_public: Boolean(frm.is_public),
                          sort_order: frm.sort_order || 0,
                          fields: Array.isArray(frm.fields) ? frm.fields : [],
                        });
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="btn sm danger"
                      onClick={async () => {
                        if (!window.confirm(`Delete "${frm.title}" and all its submissions?`)) return;
                        await api(`/api/forms/${frm.id}`, { method: 'DELETE' });
                        if (selectedForm?.id === frm.id) setSelectedForm(null);
                        await loadForms();
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

      {selectedForm && (
        <div className="card">
          <div className="between" style={{ marginBottom: '.75rem', flexWrap: 'wrap', gap: '.5rem' }}>
            <h2 style={{ margin: 0 }}>Responses: {selectedForm.title} ({submissions.length})</h2>
            <div className="actions">
              <a className="btn sm" href={`/api/forms/${selectedForm.id}/submissions.csv`} target="_blank" rel="noreferrer">Export CSV</a>
              <button type="button" className="btn sm" onClick={() => setSelectedForm(null)}>Close</button>
            </div>
          </div>
          {submissions.length === 0 ? (
            <p className="muted">No submissions yet.</p>
          ) : (
            <table>
              <thead>
                <tr><th>Submitted</th><th>Submitter</th><th>Responses</th><th>Status</th></tr>
              </thead>
              <tbody>
                {submissions.map((s) => (
                  <tr key={s.id}>
                    <td className="muted" style={{ fontSize: '.82rem' }}>{formatDate(s.created_at)}</td>
                    <td style={{ fontSize: '.85rem' }}>
                      <strong>{s.submitter_name || 'Anonymous'}</strong>
                      {s.submitter_email && <div className="muted">{s.submitter_email}</div>}
                    </td>
                    <td style={{ fontSize: '.84rem' }}>
                      {Object.entries(s.responses || {}).map(([k, v]) => (
                        <div key={k}>
                          <strong>{k.replace(/_/g, ' ')}:</strong>{' '}
                          {typeof v === 'object' && v !== null ? `${v.answer || ''} — ${v.explanation || ''}` : String(v || '—')}
                        </div>
                      ))}
                    </td>
                    <td>
                      <select
                        value={s.status}
                        style={{ width: 'auto', fontSize: '.82rem', padding: '2px 6px' }}
                        onChange={async (e) => {
                          await api(`/api/forms/submissions/${s.id}`, {
                            method: 'PATCH',
                            body: JSON.stringify({ status: e.target.value }),
                          });
                          await loadSubmissions(selectedForm);
                        }}
                      >
                        <option value="new">New</option>
                        <option value="reviewed">Reviewed</option>
                        <option value="archived">Archived</option>
                      </select>
                      <a
                        className="btn sm"
                        href={`/api/forms/submissions/${s.id}/pdf`}
                        target="_blank"
                        rel="noreferrer"
                        style={{ marginLeft: '.4rem' }}
                      >
                        PDF
                      </a>
                      <div style={{ marginTop: '.35rem' }}>
                        <input
                          style={{ fontSize: '.78rem', padding: '3px 6px', width: 170 }}
                          placeholder="Staff notes…"
                          defaultValue={s.staff_notes || ''}
                          onBlur={async (e) => {
                            const val = e.target.value;
                            if (val === (s.staff_notes || '')) return;
                            await api(`/api/forms/submissions/${s.id}`, {
                              method: 'PATCH',
                              body: JSON.stringify({ staff_notes: val }),
                            });
                          }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <ModuleNotificationsCard
        moduleId="forms"
        title="Forms & Polls Email Notifications"
        events={FORM_NOTIFICATION_EVENTS}
      />
    </section>
  );
}
