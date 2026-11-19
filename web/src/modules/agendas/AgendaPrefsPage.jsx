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
import { api, formatTime12h, toTimeInputValue } from '../../core/api.js';
import { useToast } from '../../core/toast.jsx';
import ModuleNotificationsCard from '../../core/ModuleNotificationsCard.jsx';

const AGENDA_NOTIFICATION_EVENTS = [
  {
    key: 'agendas_council_submission',
    label: 'New Council Submission',
    description: 'Sent when a councilmember submits a proposed agenda item.',
  },
  {
    key: 'agendas_finalized',
    label: 'Agenda Finalized',
    description: 'Sent when an agenda is moved to a finalized status.',
  },
];

export default function AgendaPrefsPage() {
  const [coverSheets, setCoverSheets] = useState(true);
  const [pageNumbers, setPageNumbers] = useState(true);
  const [cityName, setCityName] = useState('');
  const [meetingLocation, setMeetingLocation] = useState('');
  const [meetingTime, setMeetingTime] = useState('');
  const [otherNotes, setOtherNotes] = useState('');
  const [footerDisclosures, setFooterDisclosures] = useState('');
  const [bodies, setBodies] = useState([]);
  const [sections, setSections] = useState([]);
  const [categories, setCategories] = useState([]);
  const [newBody, setNewBody] = useState('');
  const [newSection, setNewSection] = useState('');
  const [newCatName, setNewCatName] = useState('');
  const [newCatWarn, setNewCatWarn] = useState(false);
  const [postingNoticeHours, setPostingNoticeHours] = useState('72');
  const [templates, setTemplates] = useState([]);
  const [tplLoading, setTplLoading] = useState(true);
  const [msg, setMsg] = useState({ text: '', isError: false });
  const showToast = useToast();

  const loadTemplates = useCallback(async () => {
    setTplLoading(true);
    try {
      const list = await api('/api/agendas/templates');
      setTemplates(Array.isArray(list) ? list : []);
    } finally {
      setTplLoading(false);
    }
  }, []);

  useEffect(() => {
    api('/api/agendas/preferences')
      .then((prefs) => {
        setCoverSheets(!!prefs.include_item_cover_sheets);
        setPageNumbers(!!prefs.include_page_numbers);
        setCityName(prefs.city_name || '');
        setMeetingLocation(prefs.meeting_location || '');
        setMeetingTime(toTimeInputValue(prefs.meeting_time));
        setOtherNotes(prefs.other_notes || '');
        setFooterDisclosures(prefs.footer_disclosures || '');
        setBodies(Array.isArray(prefs.bodies) ? prefs.bodies : []);
        setSections(Array.isArray(prefs.sections) ? prefs.sections : []);
        setPostingNoticeHours(String(prefs.posting_notice_hours ?? 72));
        setCategories(
          Array.isArray(prefs.categories) && prefs.categories.length
            ? prefs.categories.map(c => ({ name: c.name, warn_on_leave: !!c.warn_on_leave }))
            : [
                { name: 'In-Progress Agendas', warn_on_leave: false },
                { name: 'Finalized Agendas', warn_on_leave: true },
              ],
        );
      })
      .catch(e => showToast(e.message, 'error'));
    loadTemplates().catch(() => {});
  }, [loadTemplates, showToast]);

  const handleSave = async (e) => {
    e.preventDefault();
    setMsg({ text: '', isError: false });
    try {
      const saved = await api('/api/agendas/preferences', {
        method: 'PUT',
        body: JSON.stringify({
          include_item_cover_sheets: coverSheets,
          include_page_numbers: pageNumbers,
          city_name: cityName.trim(),
          meeting_location: meetingLocation.trim(),
          meeting_time: meetingTime.trim(),
          other_notes: otherNotes.trim(),
          footer_disclosures: footerDisclosures.trim(),
          bodies,
          sections,
          categories,
          posting_notice_hours: Math.max(0, Number.parseInt(postingNoticeHours || '0', 10) || 0),
        }),
      });
      setBodies([...(saved.bodies || [])]);
      setSections([...(saved.sections || [])]);
      if (Array.isArray(saved.categories)) {
        setCategories(saved.categories.map(c => ({ name: c.name, warn_on_leave: !!c.warn_on_leave })));
      }
      setMsg({ text: 'Preferences saved.', isError: false });
    } catch (err) {
      setMsg({ text: err.message, isError: true });
    }
  };

  return (
    <section id="section-preferences-agenda">
      <h1>Agenda Preferences</h1>
      <div className="card">
        <p className="muted" style={{ marginTop: 0 }}>
          These settings apply to all agendas when generating a PDF packet.
        </p>
        <form onSubmit={handleSave}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '.55rem', marginBottom: '.75rem', cursor: 'pointer' }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={coverSheets} onChange={(e) => setCoverSheets(e.target.checked)} />
            <span>Include a cover sheet before each agenda item (with the item title and TOC page number pointing to the cover sheet)</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '.55rem', marginBottom: '1.25rem', cursor: 'pointer' }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={pageNumbers} onChange={(e) => setPageNumbers(e.target.checked)} />
            <span>Add agenda page numbers to each page (e.g. Page 1 of 18)</span>
          </label>

          <h2 style={{ margin: '1rem 0 .75rem', fontSize: '1rem' }}>Cover Sheet Details</h2>
          <div className="row" style={{ marginBottom: '.75rem' }}>
            <div className="field" style={{ flex: 1, minWidth: '200px' }}>
              <label htmlFor="pref-city-name">City Name</label>
              <input id="pref-city-name" placeholder="e.g. City of Northfield" value={cityName} onChange={(e) => setCityName(e.target.value)} />
            </div>
            <div className="field" style={{ flex: 1, minWidth: '220px' }}>
              <label htmlFor="pref-meeting-location">Meeting Location</label>
              <input id="pref-meeting-location" placeholder="e.g. City Hall Council Chambers" value={meetingLocation} onChange={(e) => setMeetingLocation(e.target.value)} />
            </div>
            <div className="field" style={{ minWidth: '150px' }}>
              <label htmlFor="pref-meeting-time">Meeting Time</label>
              <input id="pref-meeting-time" type="time" value={meetingTime} onChange={(e) => setMeetingTime(e.target.value)} />
            </div>
          </div>
          <div className="field" style={{ marginBottom: '.75rem' }}>
            <label htmlFor="pref-other-notes">Other Notes / Standing Information</label>
            <textarea id="pref-other-notes" rows={2} placeholder="e.g. Televised live on Channel 12; public comment limited to 3 minutes" value={otherNotes} onChange={(e) => setOtherNotes(e.target.value)} />
          </div>
          <div className="field" style={{ marginBottom: '1.1rem' }}>
            <label htmlFor="pref-footer-disclosures">Page Footer / Accessibility &amp; Legal Disclosures</label>
            <textarea id="pref-footer-disclosures" rows={3} placeholder="e.g. Auxiliary aids and services are available upon request 48 hours prior to the meeting." value={footerDisclosures} onChange={(e) => setFooterDisclosures(e.target.value)} />
          </div>

          <div className="field" style={{ maxWidth: 320, marginBottom: '1rem' }}>
            <label htmlFor="pref-notice-hours">Open-Meeting Posting Notice Window (hours, 0 disables)</label>
            <input
              id="pref-notice-hours"
              type="number"
              min={0}
              max={720}
              value={postingNoticeHours}
              onChange={(e) => setPostingNoticeHours(e.target.value)}
            />
          </div>

          <h2 style={{ margin: '1rem 0 .4rem', fontSize: '1rem' }}>Governing Bodies</h2>
          <p className="muted" style={{ margin: '0 0 .6rem' }}>
            Bodies available when creating or editing an agenda (e.g. City Council, Parks Committee).
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.45rem', marginBottom: '.65rem' }}>
            {bodies.map((b, idx) => (
              <span key={b} className="badge draft" style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem', padding: '.25rem .55rem', fontSize: '.85rem' }}>
                {b}
                {bodies.length > 1 && (
                  <button
                    type="button"
                    aria-label={`Remove ${b}`}
                    style={{ border: 0, background: 'transparent', cursor: 'pointer', fontWeight: 700, padding: 0, lineHeight: 1 }}
                    onClick={() => setBodies(prev => prev.filter((_, i) => i !== idx))}
                  >
                    &times;
                  </button>
                )}
              </span>
            ))}
          </div>
          <div className="row" style={{ marginBottom: '1.1rem' }}>
            <div className="field" style={{ minWidth: '220px' }}>
              <input
                placeholder="Add governing body (e.g. Finance Committee)"
                value={newBody}
                onChange={(e) => setNewBody(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const v = newBody.trim();
                    if (v && !bodies.includes(v)) setBodies(prev => [...prev, v]);
                    setNewBody('');
                  }
                }}
              />
            </div>
            <button
              type="button"
              className="btn sm"
              onClick={() => {
                const v = newBody.trim();
                if (v && !bodies.includes(v)) setBodies(prev => [...prev, v]);
                setNewBody('');
              }}
            >
              Add Body
            </button>
          </div>

          <h2 style={{ margin: '1rem 0 .4rem', fontSize: '1rem' }}>Agenda Sections</h2>
          <p className="muted" style={{ margin: '0 0 .6rem' }}>
            Suggested section headings when adding or editing agenda items (e.g. Consent, Old Business, New Business).
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.45rem', marginBottom: '.65rem' }}>
            {sections.map((s, idx) => (
              <span key={s} className="badge draft" style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem', padding: '.25rem .55rem', fontSize: '.85rem' }}>
                {s}
                <button
                  type="button"
                  aria-label={`Remove ${s}`}
                  style={{ border: 0, background: 'transparent', cursor: 'pointer', fontWeight: 700, padding: 0, lineHeight: 1 }}
                  onClick={() => setSections(prev => prev.filter((_, i) => i !== idx))}
                >
                  &times;
                </button>
              </span>
            ))}
          </div>
          <div className="row" style={{ marginBottom: '1.1rem' }}>
            <div className="field" style={{ minWidth: '220px' }}>
              <input
                placeholder="Add section (e.g. Executive Session)"
                value={newSection}
                onChange={(e) => setNewSection(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const v = newSection.trim();
                    if (v && !sections.includes(v)) setSections(prev => [...prev, v]);
                    setNewSection('');
                  }
                }}
              />
            </div>
            <button
              type="button"
              className="btn sm"
              onClick={() => {
                const v = newSection.trim();
                if (v && !sections.includes(v)) setSections(prev => [...prev, v]);
                setNewSection('');
              }}
            >
              Add Section
            </button>
          </div>

          <h2 style={{ margin: '1rem 0 .4rem', fontSize: '1rem' }}>Agenda Categories</h2>
          <p className="muted" style={{ margin: '0 0 .6rem' }}>
            Categories shown in Manage Agendas. Enable &ldquo;Warn when removing&rdquo; to require confirmation before moving an agenda out of that category.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.4rem', marginBottom: '.65rem' }}>
            {categories.map((cat, idx) => (
              <div key={cat.name} className="between" style={{ padding: '.45rem .65rem', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', flexWrap: 'wrap' }}>
                  <strong>{cat.name}</strong>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem', fontSize: '.85rem', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      style={{ width: 'auto' }}
                      checked={!!cat.warn_on_leave}
                      onChange={(e) => setCategories(prev => prev.map((c, i) => (i === idx ? { ...c, warn_on_leave: e.target.checked } : c)))}
                    />
                    <span>Warn when removing</span>
                  </label>
                </div>
                {categories.length > 1 && (
                  <button
                    type="button"
                    className="btn sm danger"
                    onClick={() => setCategories(prev => prev.filter((_, i) => i !== idx))}
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="row" style={{ marginBottom: '1.1rem', alignItems: 'center' }}>
            <div className="field" style={{ minWidth: '220px' }}>
              <input
                placeholder="Add category (e.g. Archived Agendas)"
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const v = newCatName.trim();
                    if (v && !categories.some(c => c.name === v)) {
                      setCategories(prev => [...prev, { name: v, warn_on_leave: newCatWarn }]);
                    }
                    setNewCatName('');
                    setNewCatWarn(false);
                  }
                }}
              />
            </div>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem', fontSize: '.88rem', cursor: 'pointer' }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={newCatWarn} onChange={(e) => setNewCatWarn(e.target.checked)} />
              <span>Warn when removing</span>
            </label>
            <button
              type="button"
              className="btn sm"
              onClick={() => {
                const v = newCatName.trim();
                if (v && !categories.some(c => c.name === v)) {
                  setCategories(prev => [...prev, { name: v, warn_on_leave: newCatWarn }]);
                }
                setNewCatName('');
                setNewCatWarn(false);
              }}
            >
              Add Category
            </button>
          </div>

          <button type="submit" className="btn primary">Save Preferences</button>
          {msg.text && <div className={msg.isError ? 'error-msg' : 'ok-msg'} role="status">{msg.text}</div>}
        </form>
      </div>

      <div className="card">
        <h2>Meeting Templates</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Reusable templates available when creating a new agenda. You can also save any agenda as a template from its detail page.
        </p>
        {tplLoading ? (
          <div className="muted">Loading…</div>
        ) : !templates.length ? (
          <div className="muted">No saved meeting templates.</div>
        ) : (
          <table>
            <thead>
              <tr><th>Template Name</th><th>Body</th><th>Time</th><th>Items</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {templates.map(t => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td>{t.body || '—'}</td>
                  <td>{t.meeting_time ? formatTime12h(t.meeting_time) : '—'}</td>
                  <td>{t.item_count}</td>
                  <td>
                    <button
                      type="button"
                      className="btn sm danger"
                      onClick={async () => {
                        if (!confirm(`Delete template "${t.name}"?`)) return;
                        await api(`/api/agendas/templates/${t.id}`, { method: 'DELETE' });
                        await loadTemplates();
                      }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <ModuleNotificationsCard
        moduleId="agendas"
        title="Agenda Email Notifications"
        events={AGENDA_NOTIFICATION_EVENTS}
      />
    </section>
  );
}
