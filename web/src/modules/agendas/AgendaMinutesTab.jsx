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

import React, { useEffect, useState } from 'react';
import { api } from '../../core/api.js';

function ItemMinutesCard({ agendaId, item, onSaved }) {
  const [action, setAction] = useState(item.minutes_action || '');
  const [motionBy, setMotionBy] = useState(item.minutes_motion_by || '');
  const [secondBy, setSecondBy] = useState(item.minutes_second_by || '');
  const [vote, setVote] = useState(item.minutes_vote || '');
  const [notes, setNotes] = useState(item.minutes_notes || '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ text: '', isError: false });

  useEffect(() => {
    setAction(item.minutes_action || '');
    setMotionBy(item.minutes_motion_by || '');
    setSecondBy(item.minutes_second_by || '');
    setVote(item.minutes_vote || '');
    setNotes(item.minutes_notes || '');
  }, [item]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setMsg({ text: '', isError: false });
    try {
      const updated = await api(`/api/agendas/${agendaId}/items/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          minutes_action: action.trim(),
          minutes_motion_by: motionBy.trim(),
          minutes_second_by: secondBy.trim(),
          minutes_vote: vote.trim(),
          minutes_notes: notes.trim(),
        }),
      });
      onSaved?.(updated);
      setMsg({ text: 'Saved.', isError: false });
    } catch (err) {
      setMsg({ text: err.message, isError: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h3 style={{ margin: '0 0 .65rem', fontSize: '1rem' }}>{item.position}. {item.title}</h3>
      <form onSubmit={handleSubmit}>
        <div className="row" style={{ marginBottom: '.6rem' }}>
          <div className="field" style={{ minWidth: '150px', flex: 1 }}>
            <label>Action Taken</label>
            <input list="minutes-action-datalist" placeholder="e.g. Approved" value={action} onChange={(e) => setAction(e.target.value)} />
          </div>
          <div className="field" style={{ minWidth: '150px', flex: 1 }}>
            <label>Motion By</label>
            <input placeholder="e.g. Councilmember Lee" value={motionBy} onChange={(e) => setMotionBy(e.target.value)} />
          </div>
          <div className="field" style={{ minWidth: '150px', flex: 1 }}>
            <label>Seconded By</label>
            <input placeholder="e.g. Councilmember Patel" value={secondBy} onChange={(e) => setSecondBy(e.target.value)} />
          </div>
          <div className="field" style={{ minWidth: '150px', flex: 1 }}>
            <label>Vote</label>
            <input placeholder="e.g. 5-0" value={vote} onChange={(e) => setVote(e.target.value)} />
          </div>
        </div>
        <div className="field" style={{ marginBottom: '.6rem' }}>
          <label>Minutes / Discussion Notes</label>
          <textarea rows={2} placeholder="Summary of discussion, public comment, or conditions..." value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <div className="actions">
          <button type="submit" className="btn sm primary" disabled={busy}>Save Item Minutes</button>
          {msg.text && <span className={msg.isError ? 'error-msg' : 'ok-msg'} style={{ margin: 0 }}>{msg.text}</span>}
        </div>
      </form>
    </div>
  );
}

export default function AgendaMinutesTab({ agenda, onAgendaUpdated }) {
  const [attendance, setAttendance] = useState(agenda.minutes_attendance || '');
  const [notes, setNotes] = useState(agenda.minutes_notes || '');
  const [minutesStatus, setMinutesStatus] = useState(agenda.minutes_status || 'draft');
  const [msg, setMsg] = useState({ text: '', isError: false });

  useEffect(() => {
    setAttendance(agenda.minutes_attendance || '');
    setNotes(agenda.minutes_notes || '');
    setMinutesStatus(agenda.minutes_status || 'draft');
    setMsg({ text: '', isError: false });
  }, [agenda]);

  const handleMetaSave = async (e) => {
    e.preventDefault();
    setMsg({ text: '', isError: false });
    try {
      const updated = await api(`/api/agendas/${agenda.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          minutes_attendance: attendance.trim(),
          minutes_notes: notes.trim(),
          minutes_status: minutesStatus,
        }),
      });
      onAgendaUpdated?.(updated);
      setMsg({ text: 'Saved.', isError: false });
    } catch (err) {
      setMsg({ text: err.message, isError: true });
    }
  };

  const items = agenda.items || [];
  let lastSec = null;

  return (
    <div id="agenda-minutes-pane">
      <datalist id="minutes-action-datalist">
        <option value="Approved" />
        <option value="Approved as Amended" />
        <option value="Denied" />
        <option value="Tabled" />
        <option value="Referred" />
        <option value="No Action" />
        <option value="Informational" />
      </datalist>

      <div className="card">
        <div className="between" style={{ marginBottom: '.6rem' }}>
          <h2 style={{ margin: 0 }}>Meeting Attendance &amp; Summary</h2>
          <span className={`badge ${minutesStatus === 'approved' ? 'active' : 'draft'}`}>
            {minutesStatus === 'approved' ? 'Approved Minutes' : 'Draft (PDF Watermarked)'}
          </span>
        </div>
        <form onSubmit={handleMetaSave}>
          <div className="field" style={{ marginBottom: '.65rem', maxWidth: 360 }}>
            <label htmlFor="minutes-status">Minutes Approval Status</label>
            <select id="minutes-status" value={minutesStatus} onChange={(e) => setMinutesStatus(e.target.value)}>
              <option value="draft">Draft (adds diagonal DRAFT watermark to PDF)</option>
              <option value="approved">Approved (final public minutes, no watermark)</option>
            </select>
          </div>
          <div className="field" style={{ marginBottom: '.65rem' }}>
            <label htmlFor="minutes-attendance">Attendance / Roll Call</label>
            <textarea id="minutes-attendance" rows={2} placeholder="Present: Mayor, Councilmembers... Absent: ..." value={attendance} onChange={(e) => setAttendance(e.target.value)} />
          </div>
          <div className="field" style={{ marginBottom: '.65rem' }}>
            <label htmlFor="minutes-notes">General Meeting Notes / Call to Order &amp; Adjournment</label>
            <textarea id="minutes-notes" rows={2} placeholder="Called to order at 6:30 PM; adjourned at 8:15 PM." value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div className="actions">
            <button type="submit" className="btn sm primary">Save Attendance &amp; Notes</button>
            {msg.text && <span className={msg.isError ? 'error-msg' : 'ok-msg'} style={{ margin: 0 }}>{msg.text}</span>}
          </div>
        </form>
      </div>

      {!items.length ? (
        <div className="card muted">No agenda items yet.</div>
      ) : items.map(item => {
        const sec = (item.section || '').trim();
        const showSec = sec && sec !== lastSec;
        lastSec = sec;
        return (
          <React.Fragment key={item.id}>
            {showSec && (
              <div style={{ fontSize: '.82rem', fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: '#1e3a8a', margin: '1rem 0 .4rem', paddingLeft: '.25rem', borderLeft: '3px solid #1d4ed8' }}>
                {sec}
              </div>
            )}
            <ItemMinutesCard agendaId={agenda.id} item={item} onSaved={onAgendaUpdated} />
          </React.Fragment>
        );
      })}
    </div>
  );
}
