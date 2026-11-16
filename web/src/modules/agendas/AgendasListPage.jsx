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
import { api, formatDate, formatTime12h, toTimeInputValue } from '../../core/api.js';
import { useToast } from '../../core/toast.jsx';

function SubmissionRow({ sub, agendas, onReloadAll, onReloadSubs }) {
  const showToast = useToast();
  const councilAgendas = agendas.filter(a => (a.body || '').toLowerCase().includes('council'));
  const targetOptions = councilAgendas.length ? councilAgendas : agendas;

  let defaultSel = sub.target_agenda_id ? String(sub.target_agenda_id) : '';
  if (!defaultSel && sub.target_date) {
    const m = targetOptions.find(a => a.meeting_date === sub.target_date);
    if (m) defaultSel = String(m.id);
  }
  if (!defaultSel) defaultSel = targetOptions.length ? String(targetOptions[0].id) : '__new__';

  const [selAgenda, setSelAgenda] = useState(defaultSel);
  const [newTitle, setNewTitle] = useState('Regular Meeting');
  const [newDate, setNewDate] = useState(sub.target_date || '');
  const [busy, setBusy] = useState(false);

  const subDocs = Array.isArray(sub.documents) ? sub.documents : [];
  const meta = [
    sub.section,
    sub.description,
    sub.recommended_motion && `Motion: ${sub.recommended_motion}`,
    sub.fiscal_impact && `Fiscal: ${sub.fiscal_impact}`,
  ].filter(Boolean);

  const targetText = sub.target_agenda_title
    ? (sub.target_agenda_date ? `${sub.target_agenda_title} (${sub.target_agenda_date})` : sub.target_agenda_title)
    : ([sub.target_date, sub.target_note].filter(Boolean).length
        ? `Some future agenda · ${[sub.target_date, sub.target_note].filter(Boolean).join(' · ')}`
        : 'Some future agenda');

  return (
    <tr>
      <td>
        <div style={{ fontWeight: 600 }}>{sub.title}</div>
        {meta.length > 0 && <div className="muted" style={{ fontSize: '.82rem' }}>{meta.join(' · ')}</div>}
        {subDocs.length > 0 && (
          <div className="muted" style={{ fontSize: '.82rem' }}>
            Attachments: {subDocs.map(d => `${d.filename}${d.approval_status === 'pending' ? ' (pending approval)' : ''}`).join(', ')}
          </div>
        )}
      </td>
      <td className="muted">{sub.submitted_username || '—'}</td>
      <td className="muted">{targetText}</td>
      <td>
        {sub.status === 'accepted' ? (
          <span className="muted">
            {sub.accepted_agenda_title
              ? `On ${sub.accepted_agenda_title}${sub.accepted_agenda_date ? ` (${sub.accepted_agenda_date})` : ''}`
              : 'Already on agenda'}
          </span>
        ) : (
          <>
            <select style={{ width: '100%', minWidth: '200px' }} value={selAgenda} onChange={(e) => setSelAgenda(e.target.value)}>
              {targetOptions.map(a => (
                <option key={a.id} value={a.id}>{a.title}{a.meeting_date ? ` (${a.meeting_date})` : ''}</option>
              ))}
              <option value="__new__">+ Create new council agenda…</option>
            </select>
            {selAgenda === '__new__' && (
              <div style={{ marginTop: '.4rem', display: 'flex', gap: '.35rem' }}>
                <input placeholder="New agenda title" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} style={{ flex: 1 }} />
                <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
              </div>
            )}
          </>
        )}
      </td>
      <td>
        <div className="actions">
          {sub.status === 'accepted' ? (
            subDocs.filter(d => d.approval_status === 'pending').map(d => (
              <React.Fragment key={d.id}>
                <button
                  type="button"
                  className="btn sm primary"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await api(`/api/agendas/council/submissions/${sub.id}/documents/${d.id}/approve`, { method: 'POST' });
                      showToast(`Approved "${d.filename}"`, 'ok');
                      await onReloadAll();
                    } catch (err) {
                      showToast(err.message, 'error');
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Approve {d.filename}
                </button>
                <button
                  type="button"
                  className="btn sm danger"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await api(`/api/agendas/council/submissions/${sub.id}/documents/${d.id}/decline`, { method: 'POST' });
                      showToast(`Declined "${d.filename}"`, 'ok');
                      await onReloadSubs();
                    } catch (err) {
                      showToast(err.message, 'error');
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Decline {d.filename}
                </button>
              </React.Fragment>
            ))
          ) : (
            <>
              <button
                type="button"
                className="btn sm primary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const payload = selAgenda === '__new__'
                      ? { new_agenda_title: newTitle.trim(), new_agenda_date: newDate || null }
                      : { agenda_id: Number(selAgenda) };
                    await api(`/api/agendas/council/submissions/${sub.id}/accept`, {
                      method: 'POST',
                      body: JSON.stringify(payload),
                    });
                    showToast(`Added "${sub.title}" to agenda`, 'ok');
                    await onReloadAll();
                  } catch (err) {
                    showToast(err.message, 'error');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Accept &amp; Add
              </button>
              <button
                type="button"
                className="btn sm danger"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api(`/api/agendas/council/submissions/${sub.id}/decline`, {
                      method: 'POST',
                      body: JSON.stringify({ review_note: '' }),
                    });
                    showToast(`Declined "${sub.title}"`, 'ok');
                    await onReloadSubs();
                  } catch (err) {
                    showToast(err.message, 'error');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Decline
              </button>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

export default function AgendasListPage({ onNavigate, onBacklogCount }) {
  const [agendas, setAgendas] = useState([]);
  const [bodies, setBodies] = useState([]);
  const [categories, setCategories] = useState([
    { name: 'In-Progress Agendas', warn_on_leave: false },
    { name: 'Finalized Agendas', warn_on_leave: true },
  ]);
  const [templates, setTemplates] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [dueBacklogCount, setDueBacklogCount] = useState(0);

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [meetingDate, setMeetingDate] = useState('');
  const [meetingTime, setMeetingTime] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [formErr, setFormErr] = useState('');

  const [search, setSearch] = useState('');
  const [selectedBodies, setSelectedBodies] = useState([]);
  const [selectedCats, setSelectedCats] = useState([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const showToast = useToast();

  const loadSubs = useCallback(async () => {
    try {
      const subs = await api('/api/agendas/council/submissions');
      setSubmissions(Array.isArray(subs) ? subs : []);
    } catch {
      setSubmissions([]);
    }
  }, []);

  const loadAll = useCallback(async () => {
    const [ags, prefs, tpls, backlog] = await Promise.all([
      api('/api/agendas'),
      api('/api/agendas/preferences'),
      api('/api/agendas/templates'),
      api('/api/agendas/backlog'),
    ]);
    const list = Array.isArray(ags) ? ags : [];
    setAgendas(list);
    const bList = Array.isArray(prefs.bodies) ? prefs.bodies : [];
    setBodies(bList);
    setBody(prev => (prev && bList.includes(prev) ? prev : (bList[0] || '')));
    const cats = Array.isArray(prefs.categories) && prefs.categories.length
      ? prefs.categories.map(c => ({ name: c.name, warn_on_leave: !!c.warn_on_leave }))
      : [
          { name: 'In-Progress Agendas', warn_on_leave: false },
          { name: 'Finalized Agendas', warn_on_leave: true },
        ];
    setCategories(cats);
    if (prefs.meeting_time) {
      setMeetingTime(prev => prev || toTimeInputValue(prefs.meeting_time));
    }
    setTemplates(Array.isArray(tpls) ? tpls : []);

    const bl = Array.isArray(backlog) ? backlog : [];
    onBacklogCount?.(bl);
    const today = new Date().toISOString().slice(0, 10);
    setDueBacklogCount(bl.filter(b => b.target_date && b.target_date <= today).length);

    await loadSubs();
  }, [loadSubs, onBacklogCount]);

  useEffect(() => {
    loadAll().catch(e => showToast(e.message, 'error'));
  }, [loadAll, showToast]);

  const bodyFilterChoices = useMemo(() => {
    const s = new Set(bodies);
    for (const a of agendas) if (a.body) s.add(a.body);
    return Array.from(s);
  }, [bodies, agendas]);

  const catFilterChoices = useMemo(() => {
    const s = new Set(categories.map(c => c.name));
    for (const a of agendas) if (a.status) s.add(a.status);
    return Array.from(s);
  }, [categories, agendas]);

  const filteredAgendas = useMemo(() => {
    const q = search.trim().toLowerCase();
    return agendas.filter(a => {
      if (q && !(a.title || '').toLowerCase().includes(q) && !(a.body || '').toLowerCase().includes(q)) return false;
      if (selectedBodies.length && !selectedBodies.includes(a.body || '')) return false;
      if (selectedCats.length && !selectedCats.includes(a.status || '')) return false;
      if (dateFrom && (!a.meeting_date || a.meeting_date < dateFrom)) return false;
      if (dateTo && (!a.meeting_date || a.meeting_date > dateTo)) return false;
      return true;
    });
  }, [agendas, search, selectedBodies, selectedCats, dateFrom, dateTo]);

  const groupedSections = useMemo(() => {
    const catNames = categories.map(c => c.name);
    const uncategorized = filteredAgendas.filter(a => !a.status || !catNames.includes(a.status));
    const res = categories.map(c => ({
      name: c.name,
      rows: filteredAgendas.filter(a => a.status === c.name),
    }));
    if (uncategorized.length) res.push({ name: 'Uncategorized', rows: uncategorized });
    return res;
  }, [categories, filteredAgendas]);

  const handleCreate = async (e) => {
    e.preventDefault();
    setFormErr('');
    try {
      const created = await api('/api/agendas', {
        method: 'POST',
        body: JSON.stringify({
          title: title.trim(),
          body,
          meeting_date: meetingDate,
          meeting_time: meetingTime,
          template_id: templateId ? Number(templateId) : null,
        }),
      });
      setTitle('');
      setMeetingDate('');
      setTemplateId('');
      onNavigate(`#agendas/${created.id}`);
    } catch (err) {
      setFormErr(err.message);
    }
  };

  const handleStatusChange = async (a, nextCat) => {
    if (nextCat === a.status) return;
    const fromCfg = categories.find(c => c.name === a.status);
    if (fromCfg?.warn_on_leave) {
      const destLabel = nextCat ? ` and moving it to "${nextCat}"` : '';
      if (!confirm(`Warning: "${a.title}" is in "${a.status}". Removing it from "${a.status}"${destLabel} may affect published/distributed materials. Continue?`)) {
        return;
      }
    }
    try {
      await api(`/api/agendas/${a.id}`, { method: 'PATCH', body: JSON.stringify({ status: nextCat }) });
      await loadAll();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  return (
    <section id="section-agendas">
      <h1>Manage Agendas</h1>

      {dueBacklogCount > 0 && (
        <div className="banner show" style={{ background: '#fffbeb', borderColor: '#fcd34d', color: '#92400e' }}>
          <span>{dueBacklogCount} scheduled/backlog item(s) have reached their target date.</span>
          <button type="button" className="btn sm" onClick={() => onNavigate('#backlog')}>Open Item Backlog</button>
        </div>
      )}

      {submissions.length > 0 && (
        <div className="card">
          <div className="between" style={{ marginBottom: '.65rem' }}>
            <h2 style={{ margin: 0 }}>Council &amp; Staff Submissions</h2>
            <span className="badge draft">{submissions.length} pending</span>
          </div>
          <table>
            <thead>
              <tr><th>Submitted Item</th><th>From</th><th>Requested</th><th>Assign to Agenda</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {submissions.map(s => (
                <SubmissionRow key={s.id} sub={s} agendas={agendas} onReloadAll={loadAll} onReloadSubs={loadSubs} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <h2>New Agenda</h2>
        <form onSubmit={handleCreate}>
          <div className="row">
            <div className="field" style={{ flex: 2, minWidth: '200px' }}>
              <label htmlFor="agenda-title">Meeting Name</label>
              <input id="agenda-title" required placeholder="e.g. Regular Meeting" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="field" style={{ flex: 1, minWidth: '170px' }}>
              <label htmlFor="agenda-body">Governing Body</label>
              <select id="agenda-body" required value={body} onChange={(e) => setBody(e.target.value)}>
                {bodies.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="agenda-date">Meeting Date</label>
              <input id="agenda-date" type="date" required value={meetingDate} onChange={(e) => setMeetingDate(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="agenda-time">Meeting Time</label>
              <input id="agenda-time" type="time" value={meetingTime} onChange={(e) => setMeetingTime(e.target.value)} />
            </div>
            <div className="field" style={{ flex: 1, minWidth: '170px' }}>
              <label htmlFor="agenda-template">Start From Template</label>
              <select
                id="agenda-template"
                value={templateId}
                onChange={(e) => {
                  const id = e.target.value;
                  setTemplateId(id);
                  const tpl = templates.find(t => String(t.id) === id);
                  if (tpl) {
                    if (tpl.body && bodies.includes(tpl.body)) setBody(tpl.body);
                    if (tpl.meeting_time) setMeetingTime(toTimeInputValue(tpl.meeting_time));
                  }
                }}
              >
                <option value="">(Blank Agenda)</option>
                {templates.map(t => (
                  <option key={t.id} value={t.id}>{t.name} ({t.item_count} items)</option>
                ))}
              </select>
            </div>
            <button type="submit" className="btn primary">Create Agenda</button>
          </div>
          {formErr && <div className="error-msg" role="alert">{formErr}</div>}
        </form>
      </div>

      <div className="card">
        <div className="row" style={{ marginBottom: '1rem', alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: 1, minWidth: '180px' }}>
            <label htmlFor="filter-agenda-search">Search</label>
            <input id="filter-agenda-search" type="search" placeholder="Filter by title…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="field" style={{ minWidth: '175px' }}>
            <label>Body</label>
            <details className="multi-filter">
              <summary>
                <span>{selectedBodies.length ? `${selectedBodies.length} selected` : 'All Bodies'}</span>
              </summary>
              <div className="multi-filter-menu">
                {bodyFilterChoices.map(b => (
                  <label key={b}>
                    <input
                      type="checkbox"
                      checked={selectedBodies.includes(b)}
                      onChange={(e) => setSelectedBodies(prev => (e.target.checked ? [...prev, b] : prev.filter(x => x !== b)))}
                    />
                    <span>{b}</span>
                  </label>
                ))}
              </div>
            </details>
          </div>
          <div className="field" style={{ minWidth: '175px' }}>
            <label>Category</label>
            <details className="multi-filter">
              <summary>
                <span>{selectedCats.length ? `${selectedCats.length} selected` : 'All Categories'}</span>
              </summary>
              <div className="multi-filter-menu">
                {catFilterChoices.map(c => (
                  <label key={c}>
                    <input
                      type="checkbox"
                      checked={selectedCats.includes(c)}
                      onChange={(e) => setSelectedCats(prev => (e.target.checked ? [...prev, c] : prev.filter(x => x !== c)))}
                    />
                    <span>{c}</span>
                  </label>
                ))}
              </div>
            </details>
          </div>
          <div className="field">
            <label htmlFor="filter-agenda-date-from">From Date</label>
            <input id="filter-agenda-date-from" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="filter-agenda-date-to">To Date</label>
            <input id="filter-agenda-date-to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
          <button
            type="button"
            className="btn sm"
            onClick={() => { setSearch(''); setSelectedBodies([]); setSelectedCats([]); setDateFrom(''); setDateTo(''); }}
          >
            Clear Filters
          </button>
        </div>

        {groupedSections.map(sec => (
          <div key={sec.name} style={{ marginBottom: '1.25rem' }}>
            <h2 style={{ marginBottom: '.5rem' }}>{sec.name} ({sec.rows.length})</h2>
            {!sec.rows.length ? (
              <p className="muted" style={{ marginTop: 0 }}>No agendas in this category.</p>
            ) : (
              <table>
                <thead>
                  <tr><th>Title</th><th>Body</th><th>Date</th><th>Time</th><th>Items</th><th>Updated</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {sec.rows.map(a => {
                    const catNames = categories.map(c => c.name);
                    if (a.status && !catNames.includes(a.status)) catNames.unshift(a.status);
                    return (
                      <tr key={a.id}>
                        <td>
                          <button type="button" className="link-btn" onClick={() => onNavigate(`#agendas/${a.id}`)}>
                            {a.title}
                          </button>
                        </td>
                        <td>{a.body || '—'}</td>
                        <td>{a.meeting_date || '—'}</td>
                        <td>{a.meeting_time ? formatTime12h(a.meeting_time) : '—'}</td>
                        <td>{a.item_count}</td>
                        <td className="muted">{formatDate(a.updated_at)}</td>
                        <td>
                          <div className="actions">
                            <button type="button" className="btn sm primary" onClick={() => onNavigate(`#agendas/${a.id}`)}>Open</button>
                            <select
                              className="btn sm"
                              style={{ width: 'auto' }}
                              aria-label={`Category for ${a.title}`}
                              value={a.status || ''}
                              onChange={(e) => handleStatusChange(a, e.target.value)}
                            >
                              <option value="">(No Category)</option>
                              {catNames.map(cn => <option key={cn} value={cn}>{cn}</option>)}
                            </select>
                            <button
                              type="button"
                              className="btn sm"
                              onClick={async () => {
                                const cloned = await api(`/api/agendas/${a.id}/clone`, { method: 'POST' });
                                onNavigate(`#agendas/${cloned.id}`);
                              }}
                            >
                              Clone
                            </button>
                            <button
                              type="button"
                              className="btn sm danger"
                              onClick={async () => {
                                if (!confirm(`Remove agenda "${a.title}" and all its items/documents?`)) return;
                                await api(`/api/agendas/${a.id}`, { method: 'DELETE' });
                                await loadAll();
                              }}
                            >
                              Remove
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
        ))}
      </div>
    </section>
  );
}
