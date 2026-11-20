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
import { api } from './api.js';
import { useToast } from './toast.jsx';

export default function ModuleNotificationsCard({ moduleId, title = 'Email Notifications', events = [] }) {
  const showToast = useToast();
  const [users, setUsers] = useState([]);
  const [rules, setRules] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [userList, routing] = await Promise.all([
        api('/api/integrations/notification-users'),
        api(`/api/integrations/notifications/${moduleId}`),
      ]);
      setUsers(Array.isArray(userList) ? userList : []);
      const initial = {};
      const loadedRules = routing?.rules || {};
      for (const ev of events) {
        const existing = loadedRules[ev.key] || {};
        initial[ev.key] = {
          user_ids: Array.isArray(existing.user_ids) ? existing.user_ids : [],
          extra_emails: existing.extra_emails || '',
        };
      }
      setRules(initial);
    } finally {
      setLoading(false);
    }
  }, [moduleId, events]);

  useEffect(() => {
    load().catch((e) => showToast(e.message, 'error'));
  }, [load, showToast]);

  function toggleUser(eventKey, userId) {
    setRules((prev) => {
      const cur = prev[eventKey] || { user_ids: [], extra_emails: '' };
      const exists = cur.user_ids.includes(userId);
      const nextIds = exists
        ? cur.user_ids.filter((id) => id !== userId)
        : [...cur.user_ids, userId];
      return {
        ...prev,
        [eventKey]: { ...cur, user_ids: nextIds },
      };
    });
  }

  function setExtraEmails(eventKey, value) {
    setRules((prev) => {
      const cur = prev[eventKey] || { user_ids: [], extra_emails: '' };
      return {
        ...prev,
        [eventKey]: { ...cur, extra_emails: value },
      };
    });
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await api(`/api/integrations/notifications/${moduleId}`, {
        method: 'PUT',
        body: JSON.stringify({ rules }),
      });
      if (res?.rules) {
        setRules((prev) => ({ ...prev, ...res.rules }));
      }
      showToast('Notification routing saved', 'ok');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card" style={{ marginTop: '1rem' }}>
      <div className="between" style={{ marginBottom: '.6rem' }}>
        <div>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: '.88rem' }}>
            Choose which DocketHall users and additional email addresses receive each notification type.
            Outgoing SMTP server settings are configured under Admin → Integrations.
          </p>
        </div>
      </div>

      {loading ? (
        <p className="muted">Loading notification settings…</p>
      ) : (
        <form onSubmit={handleSave} style={{ display: 'grid', gap: '1rem' }}>
          {events.map((ev) => {
            const rule = rules[ev.key] || { user_ids: [], extra_emails: '' };
            return (
              <div
                key={ev.key}
                style={{
                  border: '1px solid #e2e8f0',
                  borderRadius: 6,
                  padding: '.85rem',
                  background: '#f8fafc',
                  display: 'grid',
                  gap: '.65rem',
                }}
              >
                <div>
                  <strong style={{ fontSize: '.95rem' }}>{ev.label}</strong>
                  {ev.description && (
                    <div className="muted" style={{ fontSize: '.82rem', marginTop: 2 }}>
                      {ev.description}
                    </div>
                  )}
                </div>

                <div>
                  <div style={{ fontSize: '.82rem', fontWeight: 600, marginBottom: '.35rem' }}>
                    Notify DocketHall Users
                  </div>
                  {users.length === 0 ? (
                    <div className="muted" style={{ fontSize: '.82rem' }}>
                      No active users currently have an email address configured in User Management.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.6rem 1.1rem' }}>
                      {users.map((u) => (
                        <label
                          key={u.id}
                          style={{ display: 'flex', alignItems: 'center', gap: '.4rem', fontSize: '.88rem' }}
                        >
                          <input
                            type="checkbox"
                            style={{ width: 'auto' }}
                            checked={rule.user_ids.includes(u.id)}
                            onChange={() => toggleUser(ev.key, u.id)}
                          />
                          <span>
                            {u.username} <span className="muted">({u.email})</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor={`extra-${moduleId}-${ev.key}`} style={{ fontSize: '.82rem' }}>
                    Additional Email Addresses (comma-separated, optional)
                  </label>
                  <input
                    id={`extra-${moduleId}-${ev.key}`}
                    placeholder="e.g. clerk@city.gov, inspector@city.gov"
                    value={rule.extra_emails}
                    onChange={(e) => setExtraEmails(ev.key, e.target.value)}
                  />
                </div>
              </div>
            );
          })}

          <div className="actions">
            <button type="submit" className="btn primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save Notification Routing'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
