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

function computeRollCallSummary(rollCall) {
  let ayes = 0;
  let nays = 0;
  let abstains = 0;
  let absents = 0;
  for (const r of rollCall || []) {
    if (r.vote === 'aye') ayes += 1;
    else if (r.vote === 'nay') nays += 1;
    else if (r.vote === 'abstain') abstains += 1;
    else if (r.vote === 'absent') absents += 1;
  }
  const parts = [`${ayes}-${nays}`];
  if (abstains > 0) parts.push(`${abstains} Abstain`);
  if (absents > 0) parts.push(`${absents} Absent`);
  const tally = ayes + nays + abstains > 0 ? parts.join(' · ') : '';
  const defaultAction = ayes + nays > 0 ? (ayes > nays ? 'Passed' : 'Failed') : '';
  return { tally, defaultAction };
}

function ItemMinutesCard({ agendaId, item, rosterMembers, onSaved }) {
  const [action, setAction] = useState(item.minutes_action || '');
  const [motionBy, setMotionBy] = useState(item.minutes_motion_by || '');
  const [secondBy, setSecondBy] = useState(item.minutes_second_by || '');
  const [vote, setVote] = useState(item.minutes_vote || '');
  const [notes, setNotes] = useState(item.minutes_notes || '');
  const [ordinanceNum, setOrdinanceNum] = useState(item.ordinance_number || '');
  const [rollCall, setRollCall] = useState(Array.isArray(item.minutes_roll_call) ? item.minutes_roll_call : []);
  const [newMember, setNewMember] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ text: '', isError: false });

  useEffect(() => {
    setAction(item.minutes_action || '');
    setMotionBy(item.minutes_motion_by || '');
    setSecondBy(item.minutes_second_by || '');
    setVote(item.minutes_vote || '');
    setNotes(item.minutes_notes || '');
    setOrdinanceNum(item.ordinance_number || '');
    const existing = Array.isArray(item.minutes_roll_call) ? item.minutes_roll_call : [];
    if (existing.length > 0) {
      setRollCall(existing);
    } else if (rosterMembers && rosterMembers.length > 0) {
      setRollCall(rosterMembers.map((m) => ({ member: m, vote: '' })));
    } else {
      setRollCall([]);
    }
  }, [item, rosterMembers]);

  function setMemberVote(memberName, nextVote) {
    const nextRc = rollCall.some((r) => r.member === memberName)
      ? rollCall.map((r) => (r.member === memberName ? { ...r, vote: r.vote === nextVote ? '' : nextVote } : r))
      : [...rollCall, { member: memberName, vote: nextVote }];
    setRollCall(nextRc);
    const { tally, defaultAction } = computeRollCallSummary(nextRc);
    if (tally) setVote(tally);
    if (!action && defaultAction) setAction(defaultAction);
  }

  function addMemberToRollCall() {
    const m = newMember.trim();
    if (!m) return;
    if (!rollCall.some((r) => r.member.toLowerCase() === m.toLowerCase())) {
      setRollCall((prev) => [...prev, { member: m, vote: '' }]);
    }
    setNewMember('');
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setMsg({ text: '', isError: false });
    try {
      const cleanedRc = rollCall.filter((r) => r.member && r.vote);
      const updated = await api(`/api/agendas/${agendaId}/items/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          minutes_action: action.trim(),
          minutes_motion_by: motionBy.trim(),
          minutes_second_by: secondBy.trim(),
          minutes_vote: vote.trim(),
          minutes_notes: notes.trim(),
          ordinance_number: ordinanceNum.trim(),
          minutes_roll_call: cleanedRc,
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
      <div className="between" style={{ marginBottom: '.65rem', gap: '.5rem', flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, fontSize: '1rem' }}>{item.position}. {item.title}</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem' }}>
          <label className="muted" style={{ fontSize: '.8rem' }}>Ord / Res #:</label>
          <input
            style={{ width: 150 }}
            placeholder="e.g. Ord. 2026-04"
            value={ordinanceNum}
            onChange={(e) => setOrdinanceNum(e.target.value)}
          />
        </div>
      </div>
      <form onSubmit={handleSubmit}>
        <div className="row" style={{ marginBottom: '.6rem' }}>
          <div className="field" style={{ minWidth: '150px', flex: 1 }}>
            <label>Action Taken</label>
            <input list="minutes-action-datalist" placeholder="e.g. Passed / Approved" value={action} onChange={(e) => setAction(e.target.value)} />
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
            <label>Vote Tally</label>
            <input placeholder="e.g. 5-0" value={vote} onChange={(e) => setVote(e.target.value)} />
          </div>
        </div>

        <div style={{ marginBottom: '.65rem', padding: '.6rem', border: '1px solid #e2e8f0', borderRadius: 6, background: '#f8fafc' }}>
          <div className="between" style={{ marginBottom: '.4rem', flexWrap: 'wrap', gap: '.4rem' }}>
            <strong style={{ fontSize: '.86rem' }}>Roll-Call Votes</strong>
            <div style={{ display: 'flex', gap: '.35rem' }}>
              <input
                style={{ width: 180 }}
                placeholder="Add councilmember…"
                value={newMember}
                onChange={(e) => setNewMember(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addMemberToRollCall(); } }}
              />
              <button type="button" className="btn sm" onClick={addMemberToRollCall}>+ Member</button>
            </div>
          </div>
          {!rollCall.length ? (
            <div className="muted" style={{ fontSize: '.82rem' }}>Add councilmembers above to record Aye / Nay / Abstain / Absent votes.</div>
          ) : (
            <div style={{ display: 'grid', gap: '.35rem' }}>
              {rollCall.map((rc) => (
                <div key={rc.member} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.5rem', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '.88rem', fontWeight: 500 }}>{rc.member}</span>
                  <div style={{ display: 'flex', gap: '.25rem' }}>
                    {[
                      ['aye', 'Aye', '#16a34a'],
                      ['nay', 'Nay', '#dc2626'],
                      ['abstain', 'Abstain', '#d97706'],
                      ['absent', 'Absent', '#64748b'],
                    ].map(([vk, lbl, clr]) => {
                      const active = rc.vote === vk;
                      return (
                        <button
                          key={vk}
                          type="button"
                          className="btn sm"
                          onClick={() => setMemberVote(rc.member, vk)}
                          style={{
                            background: active ? clr : '#fff',
                            color: active ? '#fff' : '#334155',
                            borderColor: active ? clr : '#cbd5e1',
                          }}
                        >
                          {lbl}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
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
  const [rosterMembers, setRosterMembers] = useState([]);
  const [ordinances, setOrdinances] = useState([]);
  const [showOrdinances, setShowOrdinances] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [msg, setMsg] = useState({ text: '', isError: false });

  useEffect(() => {
    api('/api/agendas/council-members')
      .then((d) => setRosterMembers(d.members || []))
      .catch(() => setRosterMembers([]));
  }, []);

  useEffect(() => {
    setAttendance(agenda.minutes_attendance || '');
    setNotes(agenda.minutes_notes || '');
    setMinutesStatus(agenda.minutes_status || 'draft');
    setMsg({ text: '', isError: false });
  }, [agenda]);

  async function handleGenerateDraft() {
    setGenerating(true);
    setMsg({ text: '', isError: false });
    try {
      const updated = await api(`/api/agendas/${agenda.id}/generate-minutes-draft`, { method: 'POST' });
      onAgendaUpdated?.(updated);
      setNotes(updated.minutes_notes || '');
      setMinutesStatus(updated.minutes_status || 'draft');
      setMsg({ text: 'Auto-generated draft minutes from motions and roll-call votes.', isError: false });
    } catch (err) {
      setMsg({ text: err.message, isError: true });
    } finally {
      setGenerating(false);
    }
  }

  async function toggleOrdinances() {
    const next = !showOrdinances;
    setShowOrdinances(next);
    if (next) {
      try {
        const d = await api('/api/agendas/ordinance-history');
        setOrdinances(d.items || []);
      } catch {
        setOrdinances([]);
      }
    }
  }

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
          <div className="actions" style={{ flexWrap: 'wrap' }}>
            <button type="submit" className="btn sm primary">Save Attendance &amp; Notes</button>
            <button type="button" className="btn sm" onClick={handleGenerateDraft} disabled={generating}>
              {generating ? 'Generating…' : 'Auto-Generate Draft Minutes'}
            </button>
            <button type="button" className="btn sm" onClick={toggleOrdinances}>
              {showOrdinances ? 'Hide Ordinance History' : 'Ordinance Passage History'}
            </button>
            {msg.text && <span className={msg.isError ? 'error-msg' : 'ok-msg'} style={{ margin: 0 }}>{msg.text}</span>}
          </div>
        </form>
      </div>

      {showOrdinances && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Ordinance &amp; Resolution Passage History</h3>
          {!ordinances.length ? (
            <p className="muted" style={{ margin: 0 }}>No ordinances or resolutions recorded yet.</p>
          ) : (
            <table>
              <thead>
                <tr><th>Ord / Res #</th><th>Title</th><th>Meeting</th><th>Motion / Second</th><th>Vote</th><th>Action</th></tr>
              </thead>
              <tbody>
                {ordinances.map((o) => (
                  <tr key={o.item_id}>
                    <td><strong>{o.ordinance_number || '—'}</strong></td>
                    <td>{o.title}</td>
                    <td>{o.meeting_date || '—'} · {o.body}</td>
                    <td>{[o.minutes_motion_by, o.minutes_second_by].filter(Boolean).join(' / ') || '—'}</td>
                    <td>{o.minutes_vote || '—'}</td>
                    <td><span className="badge">{o.minutes_action || 'Pending'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

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
            <ItemMinutesCard agendaId={agenda.id} item={item} rosterMembers={rosterMembers} onSaved={onAgendaUpdated} />
          </React.Fragment>
        );
      })}
    </div>
  );
}
