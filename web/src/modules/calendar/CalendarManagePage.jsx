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

export default function CalendarManagePage() {
  const showToast = useToast();
  const [tab, setTab] = useState('reservations');
  const [reservations, setReservations] = useState([]);
  const [events, setEvents] = useState([]);
  const [statusFilter, setStatusFilter] = useState('all');

  const [evForm, setEvForm] = useState({
    title: '',
    event_date: '',
    start_time: '',
    end_time: '',
    location: '',
    category: 'Community Event',
    description: '',
    is_public: true,
  });

  const loadAll = useCallback(async () => {
    const [resList, evList] = await Promise.all([
      api(`/api/calendar/reservations?status=${encodeURIComponent(statusFilter)}`),
      api('/api/calendar/events'),
    ]);
    setReservations(Array.isArray(resList) ? resList : []);
    setEvents(Array.isArray(evList) ? evList : []);
  }, [statusFilter]);

  useEffect(() => {
    loadAll().catch((e) => showToast(e.message, 'error'));
  }, [loadAll, showToast]);

  return (
    <section id="section-calendar-manage">
      <h1>Calendar &amp; Facility Reservations</h1>

      <div className="tabs">
        <button type="button" className={`btn sm${tab === 'reservations' ? ' active' : ''}`} onClick={() => setTab('reservations')}>
          Facility Reservations ({reservations.length})
        </button>
        <button type="button" className={`btn sm${tab === 'events' ? ' active' : ''}`} onClick={() => setTab('events')}>
          City Events &amp; Closures ({events.length})
        </button>
      </div>

      {tab === 'reservations' ? (
        <div className="card">
          <div className="between" style={{ marginBottom: '.75rem' }}>
            <h2 style={{ margin: 0 }}>Reservation Requests</h2>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ width: 'auto' }}>
              <option value="all">All Statuses</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="declined">Declined</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
          {!reservations.length ? (
            <p className="muted" style={{ margin: 0 }}>No facility reservations found.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Reservation #</th>
                  <th>Facility</th>
                  <th>Event Date</th>
                  <th>Requester</th>
                  <th>Fee / Payment</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {reservations.map((r) => (
                  <tr key={r.id}>
                    <td><strong>{r.reservation_number}</strong></td>
                    <td>
                      <div><strong>{r.facility_name}</strong></div>
                      {r.event_title && <div className="muted" style={{ fontSize: '.82rem' }}>{r.event_title}</div>}
                    </td>
                    <td>
                      <div>{r.event_date}</div>
                      <div className="muted" style={{ fontSize: '.8rem' }}>
                        {r.rental_mode === 'hourly' && r.start_time && r.end_time
                          ? `${r.start_time}–${r.end_time} (Hourly)`
                          : 'Full Day (24hrs)'}
                      </div>
                    </td>
                    <td>
                      <div>{r.requester_name}</div>
                      <div className="muted" style={{ fontSize: '.82rem' }}>
                        {[r.requester_email, r.requester_phone].filter(Boolean).join(' · ') || '—'}
                      </div>
                    </td>
                    <td>
                      <div>{r.fee_amount}</div>
                      <select
                        aria-label={`Payment status for ${r.reservation_number}`}
                        value={r.payment_status}
                        style={{ width: 'auto', fontSize: '.78rem', padding: '2px 5px', marginTop: 2 }}
                        onChange={async (e) => {
                          await api(`/api/calendar/reservations/${r.id}`, {
                            method: 'PATCH',
                            body: JSON.stringify({ payment_status: e.target.value }),
                          });
                          showToast('Payment status updated', 'ok');
                          await loadAll();
                        }}
                      >
                        <option value="unpaid">Unpaid</option>
                        <option value="paid">Paid</option>
                        <option value="waived">Waived</option>
                      </select>
                    </td>
                    <td>
                      <span className={`badge ${r.status === 'approved' ? 'active' : r.status === 'pending' ? 'draft' : 'disabled'}`}>
                        {r.status}
                      </span>
                    </td>
                    <td>
                      <div className="actions">
                        {r.status !== 'approved' && (
                          <button
                            type="button"
                            className="btn sm primary"
                            onClick={async () => {
                              try {
                                await api(`/api/calendar/reservations/${r.id}`, {
                                  method: 'PATCH',
                                  body: JSON.stringify({ status: 'approved' }),
                                });
                                showToast(`${r.reservation_number} approved`, 'ok');
                                await loadAll();
                              } catch (err) {
                                showToast(err.message, 'error');
                              }
                            }}
                          >
                            Approve
                          </button>
                        )}
                        {r.status === 'pending' && (
                          <button
                            type="button"
                            className="btn sm"
                            onClick={async () => {
                              await api(`/api/calendar/reservations/${r.id}`, {
                                method: 'PATCH',
                                body: JSON.stringify({ status: 'declined' }),
                              });
                              showToast(`${r.reservation_number} declined`, 'ok');
                              await loadAll();
                            }}
                          >
                            Decline
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn sm danger"
                          onClick={async () => {
                            if (!confirm(`Delete reservation ${r.reservation_number}?`)) return;
                            await api(`/api/calendar/reservations/${r.id}`, { method: 'DELETE' });
                            await loadAll();
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
          )}
        </div>
      ) : (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>City Events, Holidays &amp; Closures</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Finalized council/board meetings appear on the Public Calendar automatically. Add community events, holidays, or public works notices below.
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await api('/api/calendar/events', {
                  method: 'POST',
                  body: JSON.stringify(evForm),
                });
                setEvForm({
                  title: '',
                  event_date: '',
                  start_time: '',
                  end_time: '',
                  location: '',
                  category: 'Community Event',
                  description: '',
                  is_public: true,
                });
                showToast('Calendar event added', 'ok');
                await loadAll();
              } catch (err) {
                showToast(err.message, 'error');
              }
            }}
            style={{ marginBottom: '1rem', display: 'grid', gap: '.65rem' }}
          >
            <div className="row">
              <div className="field" style={{ flex: 2, minWidth: 200 }}>
                <label>Event Title *</label>
                <input required placeholder="e.g. City Hall Closed — Thanksgiving" value={evForm.title} onChange={(e) => setEvForm(f => ({ ...f, title: e.target.value }))} />
              </div>
              <div className="field" style={{ minWidth: 150 }}>
                <label>Date *</label>
                <input type="date" required value={evForm.event_date} onChange={(e) => setEvForm(f => ({ ...f, event_date: e.target.value }))} />
              </div>
              <div className="field" style={{ minWidth: 160 }}>
                <label>Category</label>
                <select value={evForm.category} onChange={(e) => setEvForm(f => ({ ...f, category: e.target.value }))}>
                  <option value="Community Event">Community Event</option>
                  <option value="Holiday / Closure">Holiday / Closure</option>
                  <option value="Public Works">Public Works</option>
                  <option value="Public Hearing">Public Hearing</option>
                  <option value="Other">Other</option>
                </select>
              </div>
            </div>
            <div className="row">
              <div className="field" style={{ minWidth: 130 }}>
                <label>Start Time (optional)</label>
                <input placeholder="e.g. 9:00 AM" value={evForm.start_time} onChange={(e) => setEvForm(f => ({ ...f, start_time: e.target.value }))} />
              </div>
              <div className="field" style={{ flex: 1, minWidth: 180 }}>
                <label>Location (optional)</label>
                <input placeholder="e.g. Community Center" value={evForm.location} onChange={(e) => setEvForm(f => ({ ...f, location: e.target.value }))} />
              </div>
              <div className="field" style={{ flex: 2, minWidth: 220 }}>
                <label>Notes / Description</label>
                <input value={evForm.description} onChange={(e) => setEvForm(f => ({ ...f, description: e.target.value }))} />
              </div>
            </div>
            <div>
              <button type="submit" className="btn sm primary">Add Calendar Event</button>
            </div>
          </form>

          {!events.length ? (
            <p className="muted" style={{ margin: 0 }}>No custom calendar events added yet.</p>
          ) : (
            <table>
              <thead>
                <tr><th>Date</th><th>Title</th><th>Category</th><th>Time / Location</th><th>Action</th></tr>
              </thead>
              <tbody>
                {events.map((ev) => (
                  <tr key={ev.id}>
                    <td>{ev.event_date}</td>
                    <td><strong>{ev.title}</strong></td>
                    <td><span className="badge draft">{ev.category}</span></td>
                    <td className="muted">{[ev.start_time, ev.location].filter(Boolean).join(' · ') || '—'}</td>
                    <td>
                      <button
                        type="button"
                        className="btn sm danger"
                        onClick={async () => {
                          await api(`/api/calendar/events/${ev.id}`, { method: 'DELETE' });
                          await loadAll();
                        }}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  );
}
