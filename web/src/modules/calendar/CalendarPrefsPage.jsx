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
import ModuleNotificationsCard from '../../core/ModuleNotificationsCard.jsx';

const CALENDAR_NOTIFICATION_EVENTS = [
  {
    key: 'calendar_reservation_requested',
    label: 'New Facility Reservation Request',
    description: 'Sent when a resident submits a request to reserve a municipal facility (e.g. Village Hall).',
  },
];

export default function CalendarPrefsPage() {
  const showToast = useToast();
  const [facilities, setFacilities] = useState([]);
  const [form, setForm] = useState({ name: '', daily_fee: '$75.00', capacity: '', description: '', rules: '' });

  const load = useCallback(async () => {
    const list = await api('/api/calendar/facilities');
    setFacilities(Array.isArray(list) ? list : []);
  }, []);

  useEffect(() => {
    load().catch((e) => showToast(e.message, 'error'));
  }, [load, showToast]);

  return (
    <section id="section-preferences-calendar">
      <h1>Calendar &amp; Rental Settings</h1>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Reservable Facilities</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Configure which municipal spaces or facilities residents can request to reserve on the Public Portal and their daily rental fee.
        </p>

        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!form.name.trim()) return;
            await api('/api/calendar/facilities', {
              method: 'POST',
              body: JSON.stringify({ ...form, sort_order: facilities.length + 1 }),
            });
            setForm({ name: '', daily_fee: '$0.00', capacity: '', description: '', rules: '' });
            showToast('Facility added', 'ok');
            await load();
          }}
          style={{ display: 'grid', gap: '.65rem', marginBottom: '1rem' }}
        >
          <div className="row">
            <div className="field" style={{ flex: 2, minWidth: 200 }}>
              <label>Facility Name *</label>
              <input required placeholder="e.g. Park Pavilion, Fire Hall" value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="field" style={{ minWidth: 120 }}>
              <label>Daily Fee</label>
              <input placeholder="$75.00" value={form.daily_fee} onChange={(e) => setForm(f => ({ ...f, daily_fee: e.target.value }))} />
            </div>
            <div className="field" style={{ minWidth: 120 }}>
              <label>Capacity (optional)</label>
              <input placeholder="e.g. 60 people" value={form.capacity} onChange={(e) => setForm(f => ({ ...f, capacity: e.target.value }))} />
            </div>
          </div>
          <div className="row">
            <div className="field" style={{ flex: 1, minWidth: 220 }}>
              <label>Description</label>
              <input placeholder="Brief description shown on Public Portal" value={form.description} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))} />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 220 }}>
              <label>Rental Rules / Notes</label>
              <input placeholder="e.g. Key pickup at City Hall" value={form.rules} onChange={(e) => setForm(f => ({ ...f, rules: e.target.value }))} />
            </div>
          </div>
          <div>
            <button type="submit" className="btn sm primary">Add Reservable Facility</button>
          </div>
        </form>

        <table>
          <thead>
            <tr><th>Facility</th><th>Daily Fee</th><th>Capacity</th><th>Status</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {facilities.map((fac) => (
              <tr key={fac.id}>
                <td>
                  <strong>{fac.name}</strong>
                  {fac.description && <div className="muted" style={{ fontSize: '.82rem' }}>{fac.description}</div>}
                </td>
                <td>
                  <input
                    aria-label={`Daily fee for ${fac.name}`}
                    style={{ width: 95, padding: '2px 6px', fontSize: '.85rem' }}
                    defaultValue={fac.daily_fee}
                    onBlur={async (e) => {
                      const next = e.target.value.trim();
                      if (next && next !== fac.daily_fee) {
                        await api(`/api/calendar/facilities/${fac.id}`, {
                          method: 'PATCH',
                          body: JSON.stringify({ daily_fee: next }),
                        });
                        showToast(`Updated ${fac.name} fee`, 'ok');
                        await load();
                      }
                    }}
                  />
                </td>
                <td>{fac.capacity || '—'}</td>
                <td>
                  <span className={`badge ${fac.is_active ? 'active' : 'disabled'}`}>
                    {fac.is_active ? 'Active' : 'Hidden'}
                  </span>
                </td>
                <td>
                  <div className="actions">
                    <button
                      type="button"
                      className="btn sm"
                      onClick={async () => {
                        await api(`/api/calendar/facilities/${fac.id}`, {
                          method: 'PATCH',
                          body: JSON.stringify({ is_active: !fac.is_active }),
                        });
                        await load();
                      }}
                    >
                      {fac.is_active ? 'Hide' : 'Enable'}
                    </button>
                    <button
                      type="button"
                      className="btn sm danger"
                      onClick={async () => {
                        if (!confirm(`Remove "${fac.name}" and its reservations?`)) return;
                        await api(`/api/calendar/facilities/${fac.id}`, { method: 'DELETE' });
                        await load();
                      }}
                    >
                      Remove
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ModuleNotificationsCard
        moduleId="calendar"
        title="Reservation Email Notifications"
        events={CALENDAR_NOTIFICATION_EVENTS}
      />
    </section>
  );
}
