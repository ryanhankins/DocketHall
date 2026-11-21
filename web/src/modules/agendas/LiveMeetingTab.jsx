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
import { api } from '../../core/api.js';
import { useToast } from '../../core/toast.jsx';

function formatClock(sec) {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

function summarizeRollCall(rc) {
  let ayes = 0;
  let nays = 0;
  let abstains = 0;
  for (const r of rc || []) {
    if (r.vote === 'aye') ayes += 1;
    else if (r.vote === 'nay') nays += 1;
    else if (r.vote === 'abstain') abstains += 1;
  }
  if (ayes === 0 && nays === 0 && abstains === 0) return '';
  return abstains > 0 ? `${ayes}-${nays}-${abstains}` : `${ayes}-${nays}`;
}

export default function LiveMeetingTab({ agenda, onAgendaUpdated, onSwitchTab }) {
  const items = agenda.items || [];
  const [idx, setIdx] = useState(0);
  const [roster, setRoster] = useState([]);

  // Speaker timer state
  const [durationSec, setDurationSec] = useState(180);
  const [remainingSec, setRemainingSec] = useState(180);
  const [timerRunning, setTimerRunning] = useState(false);
  const [speakerName, setSpeakerName] = useState('');

  // Current item minutes state
  const item = items[idx] || null;
  const [action, setAction] = useState('');
  const [motionBy, setMotionBy] = useState('');
  const [secondBy, setSecondBy] = useState('');
  const [vote, setVote] = useState('');
  const [notes, setNotes] = useState('');
  const [rollCall, setRollCall] = useState([]);
  const [saving, setSaving] = useState(false);
  const showToast = useToast();

  useEffect(() => {
    api('/api/agendas/council-members')
      .then((d) => setRoster(d.members || []))
      .catch(() => setRoster([]));
  }, []);

  useEffect(() => {
    if (idx >= items.length && items.length > 0) {
      setIdx(items.length - 1);
    }
  }, [idx, items.length]);

  useEffect(() => {
    if (!item) return;
    setAction(item.minutes_action || '');
    setMotionBy(item.minutes_motion_by || '');
    setSecondBy(item.minutes_second_by || '');
    setVote(item.minutes_vote || '');
    setNotes(item.minutes_notes || '');
    const existing = Array.isArray(item.minutes_roll_call) ? item.minutes_roll_call : [];
    if (existing.length > 0) {
      setRollCall(existing);
    } else if (roster.length > 0) {
      setRollCall(roster.map((m) => ({ member: m, vote: '' })));
    } else {
      setRollCall([]);
    }
  }, [item, roster]);

  useEffect(() => {
    if (!timerRunning) return undefined;
    const t = setInterval(() => {
      setRemainingSec((prev) => {
        if (prev <= 1) {
          setTimerRunning(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [timerRunning]);

  const setDurationPreset = (secs) => {
    setTimerRunning(false);
    setDurationSec(secs);
    setRemainingSec(secs);
  };

  const setMemberVote = (member, nextVote) => {
    const nextRc = rollCall.some((r) => r.member === member)
      ? rollCall.map((r) => (r.member === member ? { ...r, vote: r.vote === nextVote ? '' : nextVote } : r))
      : [...rollCall, { member, vote: nextVote }];
    setRollCall(nextRc);
    const autoSummary = summarizeRollCall(nextRc);
    if (autoSummary) setVote(autoSummary);
  };

  const saveCurrentItem = useCallback(async (advanceNext = false) => {
    if (!item) return;
    setSaving(true);
    try {
      const cleanedRc = rollCall.filter((r) => r.member && r.vote);
      const updated = await api(`/api/agendas/${agenda.id}/items/${item.id}/minutes`, {
        method: 'PATCH',
        body: JSON.stringify({
          minutes_action: action.trim(),
          minutes_motion_by: motionBy.trim(),
          minutes_second_by: secondBy.trim(),
          minutes_vote: vote.trim(),
          minutes_notes: notes.trim(),
          minutes_roll_call: cleanedRc,
        }),
      });
      onAgendaUpdated?.(updated);
      showToast(`Saved vote/action for Item ${item.position}`, 'ok');
      if (advanceNext && idx < items.length - 1) {
        setIdx((i) => i + 1);
      }
    } catch (err) {
      showToast(err.message || 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  }, [agenda.id, item, action, motionBy, secondBy, vote, notes, rollCall, idx, items.length, onAgendaUpdated, showToast]);

  const stampMeetingEvent = async (label) => {
    const stamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const line = `${label} at ${stamp}.`;
    const cur = (agenda.minutes_notes || '').trim();
    const nextNotes = cur ? `${cur}\n${line}` : line;
    try {
      const updated = await api(`/api/agendas/${agenda.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ minutes_notes: nextNotes }),
      });
      onAgendaUpdated?.(updated);
      showToast(line, 'ok');
    } catch (err) {
      showToast(err.message || 'Failed to record timestamp', 'error');
    }
  };

  return (
    <div id="live-meeting-pane" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <datalist id="live-action-datalist">
        <option value="Approved" />
        <option value="Approved as Amended" />
        <option value="Denied" />
        <option value="Tabled" />
        <option value="Referred" />
        <option value="No Action" />
        <option value="Informational" />
      </datalist>

      {/* Top Clerk Controls + Item Stepper */}
      <div className="card" style={{ marginBottom: 0 }}>
        <div className="between" style={{ gap: '.75rem', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
            <button type="button" className="btn sm" disabled={idx <= 0} onClick={() => setIdx((i) => Math.max(0, i - 1))}>
              &larr; Prev Item
            </button>
            <select
              aria-label="Jump to agenda item"
              value={idx}
              onChange={(e) => setIdx(Number(e.target.value))}
              style={{ width: 'auto', maxWidth: 320 }}
            >
              {items.map((it, i) => (
                <option key={it.id} value={i}>
                  {it.position}. {it.title}
                </option>
              ))}
            </select>
            <button type="button" className="btn sm" disabled={idx >= items.length - 1} onClick={() => setIdx((i) => Math.min(items.length - 1, i + 1))}>
              Next Item &rarr;
            </button>
          </div>
          <div className="actions">
            <button type="button" className="btn sm" onClick={() => stampMeetingEvent('Meeting called to order')}>
              Call to Order
            </button>
            <button type="button" className="btn sm" onClick={() => stampMeetingEvent('Meeting adjourned')}>
              Adjourn
            </button>
            <button
              type="button"
              className="btn sm primary"
              onClick={async () => {
                const updated = await api(`/api/agendas/${agenda.id}/generate-minutes-draft`, { method: 'POST' });
                onAgendaUpdated?.(updated);
                showToast('Generated draft minutes from live votes', 'ok');
                onSwitchTab?.('minutes');
              }}
            >
              Compile Draft Minutes
            </button>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem', alignItems: 'start' }}>
        {/* Left: Current Agenda Item + Speaker Timer */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="card" style={{ marginBottom: 0 }}>
            {!item ? (
              <p className="muted" style={{ margin: 0 }}>No agenda items yet. Add items in Edit Items &amp; Documents.</p>
            ) : (
              <>
                <div className="between" style={{ marginBottom: '.4rem', flexWrap: 'wrap', gap: '.4rem' }}>
                  <span className="badge draft">{item.section || 'Agenda Item'}</span>
                  <span className="muted" style={{ fontSize: '.84rem' }}>Item {idx + 1} of {items.length}</span>
                </div>
                <h2 style={{ margin: '0 0 .5rem' }}>{item.position}. {item.title}</h2>
                {item.presenter && <p style={{ margin: '0 0 .35rem' }}><strong>Presenter:</strong> {item.presenter}</p>}
                {item.recommended_motion && (
                  <p style={{ margin: '0 0 .35rem', background: '#f8fafc', padding: '.5rem .65rem', borderRadius: 6, border: '1px solid #e2e8f0' }}>
                    <strong>Recommended Motion:</strong> {item.recommended_motion}
                  </p>
                )}
                {item.fiscal_impact && <p style={{ margin: '0 0 .35rem' }}><strong>Fiscal Impact:</strong> {item.fiscal_impact}</p>}
                {item.description && <p className="muted" style={{ margin: '.4rem 0 0', whiteSpace: 'pre-wrap' }}>{item.description}</p>}
                {(item.documents || []).length > 0 && (
                  <div style={{ marginTop: '.65rem', paddingTop: '.55rem', borderTop: '1px solid #e2e8f0' }}>
                    <strong style={{ fontSize: '.85rem' }}>Attachments ({item.documents.length}):</strong>
                    <ul style={{ margin: '.3rem 0 0', paddingLeft: '1.15rem', fontSize: '.86rem' }}>
                      {item.documents.map((d) => (
                        <li key={d.id}>{d.title} <span className="muted">[{d.doc_type}]</span></li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Public Comment Speaker Timer */}
          <div className="card" style={{ marginBottom: 0 }}>
            <div className="between" style={{ marginBottom: '.6rem', flexWrap: 'wrap', gap: '.4rem' }}>
              <h3 style={{ margin: 0 }}>Public Comment Speaker Timer</h3>
              <div style={{ display: 'flex', gap: '.3rem' }}>
                {[120, 180, 300].map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={`btn sm${durationSec === s ? ' active' : ''}`}
                    onClick={() => setDurationPreset(s)}
                  >
                    {s / 60}m
                  </button>
                ))}
              </div>
            </div>
            <div className="row" style={{ alignItems: 'center', gap: '.75rem', flexWrap: 'wrap' }}>
              <div
                style={{
                  fontSize: '2rem',
                  fontWeight: 700,
                  fontVariantNumeric: 'tabular-nums',
                  padding: '.35rem .85rem',
                  borderRadius: 8,
                  background: remainingSec === 0 ? '#fee2e2' : (remainingSec <= 30 ? '#fef3c7' : '#f1f5f9'),
                  color: remainingSec === 0 ? '#b91c1c' : (remainingSec <= 30 ? '#92400e' : '#0f172a'),
                }}
              >
                {formatClock(remainingSec)}
              </div>
              <input
                placeholder="Speaker name (optional)"
                value={speakerName}
                onChange={(e) => setSpeakerName(e.target.value)}
                style={{ flex: 1, minWidth: 160 }}
              />
              <div className="actions">
                <button
                  type="button"
                  className="btn sm primary"
                  onClick={() => {
                    if (remainingSec === 0) setRemainingSec(durationSec);
                    setTimerRunning((v) => !v);
                  }}
                >
                  {timerRunning ? 'Pause' : 'Start'}
                </button>
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => {
                    setTimerRunning(false);
                    setRemainingSec(durationSec);
                  }}
                >
                  Reset
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Live Motion, Second & Roll-Call Vote */}
        {item && (
          <div className="card" style={{ marginBottom: 0 }}>
            <h3 style={{ marginTop: 0 }}>Live Motion &amp; Roll-Call Vote</h3>
            <div className="row" style={{ marginBottom: '.6rem' }}>
              <div className="field" style={{ flex: 1, minWidth: 150 }}>
                <label>Action / Outcome</label>
                <input list="live-action-datalist" placeholder="e.g. Approved" value={action} onChange={(e) => setAction(e.target.value)} />
              </div>
              <div className="field" style={{ flex: 1, minWidth: 140 }}>
                <label>Vote Tally</label>
                <input placeholder="e.g. 5-0" value={vote} onChange={(e) => setVote(e.target.value)} />
              </div>
            </div>
            <div className="row" style={{ marginBottom: '.6rem' }}>
              <div className="field" style={{ flex: 1, minWidth: 150 }}>
                <label>Motion By</label>
                <input
                  list="live-roster-datalist"
                  placeholder="Councilmember…"
                  value={motionBy}
                  onChange={(e) => setMotionBy(e.target.value)}
                />
              </div>
              <div className="field" style={{ flex: 1, minWidth: 150 }}>
                <label>Second By</label>
                <input
                  list="live-roster-datalist"
                  placeholder="Councilmember…"
                  value={secondBy}
                  onChange={(e) => setSecondBy(e.target.value)}
                />
              </div>
              <datalist id="live-roster-datalist">
                {roster.map((m) => <option key={m} value={m} />)}
              </datalist>
            </div>

            {rollCall.length > 0 && (
              <div style={{ marginBottom: '.65rem' }}>
                <div style={{ fontWeight: 600, fontSize: '.86rem', marginBottom: '.35rem' }}>Roll-Call Vote</div>
                <div style={{ display: 'grid', gap: '.35rem' }}>
                  {rollCall.map((rc) => (
                    <div key={rc.member} className="between" style={{ padding: '.3rem .5rem', border: '1px solid #e2e8f0', borderRadius: 6, gap: '.4rem' }}>
                      <strong style={{ fontSize: '.88rem' }}>{rc.member}</strong>
                      <div style={{ display: 'flex', gap: '.25rem' }}>
                        {['aye', 'nay', 'abstain', 'absent'].map((vk) => (
                          <button
                            key={vk}
                            type="button"
                            className={`btn sm${rc.vote === vk ? ' primary' : ''}`}
                            onClick={() => setMemberVote(rc.member, vk)}
                            style={{ textTransform: 'capitalize', padding: '.15rem .45rem', fontSize: '.78rem' }}
                          >
                            {vk}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="field" style={{ marginBottom: '.7rem' }}>
              <label>Item Discussion / Minutes Notes</label>
              <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes for this item…" />
            </div>

            <div className="actions">
              <button type="button" className="btn primary" disabled={saving} onClick={() => saveCurrentItem(false)}>
                {saving ? 'Saving…' : 'Save Vote & Action'}
              </button>
              {idx < items.length - 1 && (
                <button type="button" className="btn" disabled={saving} onClick={() => saveCurrentItem(true)}>
                  Save &amp; Next Item &rarr;
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
