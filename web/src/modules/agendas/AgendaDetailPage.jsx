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
import { api, categoryBadgeClass, toTimeInputValue } from '../../core/api.js';
import { InlineEditable } from '../../core/InlineEditable.jsx';
import { useToast } from '../../core/toast.jsx';
import { recurrenceLabel } from './BacklogPage.jsx';
import AgendaItemsTab from './AgendaItemsTab.jsx';
import AgendaContentsTab from './AgendaContentsTab.jsx';
import AgendaMinutesTab from './AgendaMinutesTab.jsx';
import ImportAgendaDialog from './ImportAgendaDialog.jsx';

export default function AgendaDetailPage({ agendaId, tab = 'edit', onNavigate, onBacklogCount }) {
  const [agenda, setAgenda] = useState(null);
  const [agendasList, setAgendasList] = useState([]);
  const [configuredBodies, setConfiguredBodies] = useState([]);
  const [configuredSections, setConfiguredSections] = useState([]);
  const [configuredCategories, setConfiguredCategories] = useState([
    { name: 'In-Progress Agendas', warn_on_leave: false },
    { name: 'Finalized Agendas', warn_on_leave: true },
  ]);
  const [defaultMeetingTime, setDefaultMeetingTime] = useState('');
  const [postingNoticeHours, setPostingNoticeHours] = useState(72);
  const [backlogMatches, setBacklogMatches] = useState([]);
  const [popupDismissed, setPopupDismissed] = useState(false);

  const [editBody, setEditBody] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editTime, setEditTime] = useState('');
  const [editMediaUrl, setEditMediaUrl] = useState('');
  const [editMediaType, setEditMediaType] = useState('');
  const [saveMsg, setSaveMsg] = useState({ text: '', isError: false });
  const [importOpen, setImportOpen] = useState(false);
  const showToast = useToast();

  const applyAgendaState = useCallback((ag, defTime = defaultMeetingTime) => {
    setAgenda(ag);
    setEditBody(ag.body || '');
    setEditDate(ag.meeting_date || '');
    setEditTime(toTimeInputValue(ag.meeting_time || defTime));
    setEditMediaUrl(ag.media_url || '');
    setEditMediaType(ag.media_type || '');
  }, [defaultMeetingTime]);

  const loadAll = useCallback(async () => {
    const [ag, prefs, allAgs, backlog, forAgendaBacklog] = await Promise.all([
      api(`/api/agendas/${agendaId}`),
      api('/api/agendas/preferences'),
      api('/api/agendas'),
      api('/api/agendas/backlog'),
      api(`/api/agendas/backlog/for-agenda/${agendaId}`),
    ]);
    const defTime = prefs.meeting_time || '';
    setDefaultMeetingTime(defTime);
    setPostingNoticeHours(Number(prefs.posting_notice_hours ?? 72));
    setConfiguredBodies(Array.isArray(prefs.bodies) ? prefs.bodies : []);
    setConfiguredSections(Array.isArray(prefs.sections) ? prefs.sections : []);
    setConfiguredCategories(
      Array.isArray(prefs.categories) && prefs.categories.length
        ? prefs.categories.map(c => ({ name: c.name, warn_on_leave: !!c.warn_on_leave }))
        : [
            { name: 'In-Progress Agendas', warn_on_leave: false },
            { name: 'Finalized Agendas', warn_on_leave: true },
          ],
    );
    setAgendasList(Array.isArray(allAgs) ? allAgs : []);
    onBacklogCount?.(Array.isArray(backlog) ? backlog : []);
    setBacklogMatches(Array.isArray(forAgendaBacklog) ? forAgendaBacklog : []);
    setPopupDismissed(false);
    applyAgendaState(ag, defTime);
  }, [agendaId, applyAgendaState, onBacklogCount]);

  useEffect(() => {
    loadAll().catch((err) => {
      showToast(err.message, 'error');
      onNavigate('#agendas');
    });
  }, [loadAll, onNavigate, showToast]);

  if (!agenda) {
    return (
      <section id="section-agendas">
        <div className="muted">Loading agenda…</div>
      </section>
    );
  }

  const activeTab = (tab === 'contents' || tab === 'minutes') ? tab : 'edit';
  const setTab = (nextTab) => {
    const suffix = nextTab === 'edit' ? '' : `/${nextTab}`;
    onNavigate(`#agendas/${agenda.id}${suffix}`);
  };

  const bodyOpts = [...configuredBodies];
  if (agenda.body && !bodyOpts.includes(agenda.body)) bodyOpts.unshift(agenda.body);

  const catNames = configuredCategories.map(c => c.name);
  if (agenda.status && !catNames.includes(agenda.status)) catNames.unshift(agenda.status);

  const showFinalized = Boolean(agenda.finalized_at && categoryBadgeClass(agenda.status, configuredCategories) === 'badge active');
  const logs = Array.isArray(agenda.activity_log) ? agenda.activity_log : [];

  return (
    <section id="section-agendas">
      <div className="between" style={{ marginBottom: '.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', flexWrap: 'wrap' }}>
          <button type="button" className="btn sm" onClick={() => onNavigate('#agendas')}>&larr; All Agendas</button>
          <h1 style={{ margin: 0 }}>
            <InlineEditable
              value={agenda.title}
              required
              title="Click to edit meeting name"
              onSave={async (next) => applyAgendaState(await api(`/api/agendas/${agenda.id}`, {
                method: 'PATCH', body: JSON.stringify({ title: next }),
              }))}
            />
          </h1>
          {agenda.status && (
            <span className={categoryBadgeClass(agenda.status, configuredCategories)}>{agenda.status}</span>
          )}
          {agenda.amended_at && (
            <span className="badge draft" title={`Amended ${new Date(agenda.amended_at).toLocaleString()}`}>Amended</span>
          )}
        </div>
        <div className="actions">
          <select
            className="btn"
            style={{ width: 'auto' }}
            aria-label="Agenda Category"
            value={agenda.status || ''}
            onChange={async (e) => {
              const targetCat = e.target.value;
              const fromCfg = configuredCategories.find(c => c.name === agenda.status);
              const toCfg = configuredCategories.find(c => c.name === targetCat);
              const isMovingToFinal = Boolean(toCfg?.warn_on_leave || targetCat.toLowerCase().startsWith('finalized'));
              const wasFinal = Boolean(fromCfg?.warn_on_leave || (agenda.status || '').toLowerCase().startsWith('finalized'));
              if (fromCfg?.warn_on_leave) {
                const destLabel = targetCat ? ` and moving it to "${targetCat}"` : '';
                if (!confirm(`Warning: "${agenda.title}" is in "${agenda.status}". Removing it from "${agenda.status}"${destLabel} may affect published/distributed materials. Continue?`)) {
                  return;
                }
              }
              if (isMovingToFinal && !wasFinal && postingNoticeHours > 0 && agenda.meeting_date) {
                const timePart = toTimeInputValue(agenda.meeting_time || defaultMeetingTime) || '00:00';
                const meetingDt = new Date(`${agenda.meeting_date}T${timePart}:00`);
                const hoursLeft = (meetingDt.getTime() - Date.now()) / (1000 * 60 * 60);
                if (!Number.isNaN(hoursLeft) && hoursLeft < postingNoticeHours) {
                  const desc = hoursLeft < 0 ? 'already in the past' : `only ${Math.max(0, Math.round(hoursLeft))} hour(s) away`;
                  if (!confirm(`Open-Meeting Posting Warning: This meeting is ${desc}, which is less than the configured ${postingNoticeHours}-hour posting notice window. Finalize anyway?`)) {
                    return;
                  }
                }
              }
              const updated = await api(`/api/agendas/${agenda.id}`, {
                method: 'PATCH', body: JSON.stringify({ status: targetCat }),
              });
              applyAgendaState(updated);
            }}
          >
            <option value="">(No Category)</option>
            {catNames.map(cn => <option key={cn} value={cn}>{cn}</option>)}
          </select>
          <button
            type="button"
            className="btn"
            onClick={async () => {
              const cloned = await api(`/api/agendas/${agenda.id}/clone`, { method: 'POST' });
              onNavigate(`#agendas/${cloned.id}`);
            }}
          >
            Clone
          </button>
          <button
            type="button"
            className="btn"
            onClick={async () => {
              const name = prompt('Template name:', `${agenda.body || 'Meeting'} Template`);
              if (!name || !name.trim()) return;
              await api(`/api/agendas/${agenda.id}/save-template`, {
                method: 'POST', body: JSON.stringify({ name: name.trim() }),
              });
              setSaveMsg({ text: 'Template saved.', isError: false });
            }}
          >
            Save as Template
          </button>
          <a className="btn" href={`/api/agendas/${agenda.id}/packet.pdf?summary=1`} target="_blank" rel="noreferrer">View Summary PDF</a>
          <a className="btn primary" href={`/api/agendas/${agenda.id}/packet.pdf`} target="_blank" rel="noreferrer">View Packet PDF</a>
          <a className="btn" href={`/api/agendas/${agenda.id}/packet.pdf?download=1`} target="_blank" rel="noreferrer">Download PDF</a>
          <a className="btn" href={`/api/agendas/${agenda.id}/minutes.pdf`} target="_blank" rel="noreferrer">Minutes PDF</a>
          <a className="btn" href={`/api/agendas/${agenda.id}/minutes.pdf?download=1`} target="_blank" rel="noreferrer">Download Minutes</a>
        </div>
      </div>

      {(showFinalized || agenda.amended_at || logs.length > 0) && (
        <div className="muted" style={{ fontSize: '.85rem', marginBottom: '.65rem' }}>
          {showFinalized && <span>Finalized: {new Date(agenda.finalized_at).toLocaleString()} </span>}
          {agenda.amended_at && <span>· Amended: {new Date(agenda.amended_at).toLocaleString()} </span>}
          {logs.length > 0 && (
            <details style={{ display: 'inline-block', marginLeft: showFinalized ? '.4rem' : 0 }}>
              <summary style={{ cursor: 'pointer', color: '#1d4ed8' }}>Status Log ({logs.length})</summary>
              <ul style={{ margin: '.35rem 0 0', paddingLeft: '1.1rem' }}>
                {logs.map((ev, i) => (
                  <li key={i}>
                    {ev.created_at ? new Date(ev.created_at).toLocaleString() : ''} — {ev.action}
                    {ev.actor ? ` by ${ev.actor}` : ''}
                    {ev.note ? ` (${ev.note})` : ''}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      <form
        className="row"
        style={{ marginBottom: '1rem', alignItems: 'flex-end' }}
        onSubmit={async (e) => {
          e.preventDefault();
          setSaveMsg({ text: '', isError: false });
          try {
            const updated = await api(`/api/agendas/${agenda.id}`, {
              method: 'PATCH',
              body: JSON.stringify({
                body: editBody,
                meeting_date: editDate,
                meeting_time: editTime,
                media_url: editMediaUrl,
                media_type: editMediaUrl.trim() ? (editMediaType || 'video') : '',
              }),
            });
            applyAgendaState(updated);
            setSaveMsg({ text: 'Saved.', isError: false });
          } catch (err) {
            setSaveMsg({ text: err.message, isError: true });
          }
        }}
      >
        <div className="field">
          <label htmlFor="detail-body-select">Governing Body</label>
          <select id="detail-body-select" required value={editBody} onChange={(e) => setEditBody(e.target.value)}>
            {bodyOpts.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="detail-date-input">Meeting Date</label>
          <input id="detail-date-input" type="date" required value={editDate} onChange={(e) => setEditDate(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="detail-time-input">Meeting Time</label>
          <input id="detail-time-input" type="time" value={editTime} onChange={(e) => setEditTime(e.target.value)} />
        </div>
        <div className="field" style={{ minWidth: 120 }}>
          <label htmlFor="detail-media-type">Media Type</label>
          <select id="detail-media-type" value={editMediaType} onChange={(e) => setEditMediaType(e.target.value)}>
            <option value="">None</option>
            <option value="video">Video</option>
            <option value="audio">Audio</option>
          </select>
        </div>
        <div className="field" style={{ flex: 2, minWidth: 220 }}>
          <label htmlFor="detail-media-url">Meeting Media URL (optional)</label>
          <input
            id="detail-media-url"
            type="url"
            placeholder="https://youtube.com/... or recording URL"
            value={editMediaUrl}
            onChange={(e) => setEditMediaUrl(e.target.value)}
          />
        </div>
        <button type="submit" className="btn sm primary">Save Details</button>
        {saveMsg.text && <span className={saveMsg.isError ? 'error-msg' : 'ok-msg'} style={{ margin: 0 }}>{saveMsg.text}</span>}
      </form>

      {backlogMatches.length > 0 && !popupDismissed && (
        <div className="card" style={{ background: '#fffbeb', borderColor: '#fcd34d', marginBottom: '1rem' }}>
          <div className="between" style={{ marginBottom: '.5rem' }}>
            <strong style={{ color: '#92400e' }}>
              {backlogMatches.length} scheduled / backlog item(s) ready for this agenda
            </strong>
            <button type="button" className="btn sm" onClick={() => setPopupDismissed(true)}>Dismiss</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.45rem' }}>
            {backlogMatches.map(it => {
              const isRec = it.recurrence && it.recurrence !== 'none';
              const docCnt = (it.documents || []).length;
              const parts = [];
              if (isRec) parts.push(recurrenceLabel(it));
              if (it.target_date) parts.push(`Due: ${it.target_date}`);
              if (it.assigned_to) parts.push(`Assigned: ${it.assigned_to}`);
              if (it.section) parts.push(it.section);
              if (docCnt) parts.push(`${docCnt} doc(s)`);
              return (
                <div key={it.id} className="between" style={{ background: '#fff', border: '1px solid #fde68a', borderRadius: '6px', padding: '.45rem .65rem', gap: '.6rem' }}>
                  <div>
                    <strong>{it.title}</strong>
                    {parts.length > 0 && <span className="muted"> — {parts.join(' · ')}</span>}
                  </div>
                  <div className="actions">
                    <button
                      type="button"
                      className="btn sm primary"
                      onClick={async () => {
                        await api(`/api/agendas/backlog/${it.id}/assign`, {
                          method: 'POST', body: JSON.stringify({ target_agenda_id: agenda.id, copy: isRec }),
                        });
                        showToast(`Added "${it.title}" to agenda`, 'ok');
                        await loadAll();
                      }}
                    >
                      Add to Agenda
                    </button>
                    {!isRec && (
                      <button
                        type="button"
                        className="btn sm"
                        onClick={async () => {
                          await api(`/api/agendas/backlog/${it.id}/assign`, {
                            method: 'POST', body: JSON.stringify({ target_agenda_id: agenda.id, copy: true }),
                          });
                          showToast(`Copied "${it.title}" to agenda`, 'ok');
                          await loadAll();
                        }}
                      >
                        Copy
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="tabs">
        <button type="button" className={`btn sm${activeTab === 'edit' ? ' active' : ''}`} onClick={() => setTab('edit')}>
          Edit Items &amp; Documents
        </button>
        <button type="button" className={`btn sm${activeTab === 'contents' ? ' active' : ''}`} onClick={() => setTab('contents')}>
          Contents Page &amp; Order
        </button>
        <button type="button" className={`btn sm${activeTab === 'minutes' ? ' active' : ''}`} onClick={() => setTab('minutes')}>
          Record Minutes
        </button>
      </div>

      {activeTab === 'edit' && (
        <AgendaItemsTab
          agenda={agenda}
          agendasList={agendasList}
          configuredBodies={configuredBodies}
          configuredSections={configuredSections}
          onAgendaUpdated={(updated) => applyAgendaState(updated)}
          onNavigate={onNavigate}
          onOpenImportDialog={() => setImportOpen(true)}
          onRefreshAgenda={loadAll}
        />
      )}
      {activeTab === 'contents' && <AgendaContentsTab agenda={agenda} />}
      {activeTab === 'minutes' && (
        <AgendaMinutesTab agenda={agenda} onAgendaUpdated={(updated) => applyAgendaState(updated)} />
      )}

      <ImportAgendaDialog
        open={importOpen}
        currentAgendaId={agenda.id}
        agendasList={agendasList}
        onClose={() => setImportOpen(false)}
        onImported={loadAll}
      />
    </section>
  );
}
