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
import { ROLE_LABELS, api, formatDate } from './api.js';
import { InlineEditable } from './InlineEditable.jsx';
import { useToast } from './toast.jsx';

export default function UsersPage({ me, permissionsCatalog = [] }) {
  const [users, setUsers] = useState([]);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('council_member');
  const [newPerms, setNewPerms] = useState([]);
  const [err, setErr] = useState('');
  const [pwBanner, setPwBanner] = useState(null);
  const [copied, setCopied] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const showToast = useToast();

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    return users.filter(u => {
      if (roleFilter === '_staff_council') {
        if (!['admin', 'admin_staff', 'non_admin_staff', 'council_member'].includes(u.role)) return false;
      } else if (roleFilter && u.role !== roleFilter) {
        return false;
      }
      if (!q) return true;
      return `${u.username || ''} ${u.email || ''}`.toLowerCase().includes(q);
    });
  }, [users, userSearch, roleFilter]);

  const loadUsers = useCallback(async () => {
    const list = await api('/api/users');
    setUsers(Array.isArray(list) ? list : []);
  }, []);

  useEffect(() => {
    loadUsers().catch(e => showToast(e.message, 'error'));
  }, [loadUsers, showToast]);

  const toggleNewPerm = (key) => {
    setNewPerms(prev => (prev.includes(key) ? prev.filter(p => p !== key) : [...prev, key]));
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setErr('');
    try {
      const created = await api('/api/users', {
        method: 'POST',
        body: JSON.stringify({ username: username.trim(), email: email.trim(), role, permissions: newPerms }),
      });
      setUsername('');
      setEmail('');
      setRole('council_member');
      setNewPerms([]);
      setPwBanner({ username: created.username, password: created.generated_password });
      setCopied(false);
      await loadUsers();
    } catch (error) {
      setErr(error.message);
    }
  };

  const handleToggleUserPerm = async (u, permKey) => {
    const cur = Array.isArray(u.permissions) ? u.permissions : [];
    const next = cur.includes(permKey) ? cur.filter(p => p !== permKey) : [...cur, permKey];
    try {
      await api(`/api/users/${u.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ permissions: next }),
      });
      await loadUsers();
    } catch (error) {
      showToast(error.message, 'error');
    }
  };

  return (
    <section id="section-users">
      <h1>Manage Users</h1>

      {pwBanner && (
        <div className="banner show" role="status">
          <div>
            <strong>Temporary password for {pwBanner.username}:</strong>{' '}
            <code>{pwBanner.password}</code>{' '}
            <span className="muted">(shown once)</span>
          </div>
          <div className="actions">
            <button
              type="button"
              className="btn sm"
              onClick={async () => {
                await navigator.clipboard.writeText(pwBanner.password);
                setCopied(true);
              }}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button type="button" className="btn sm" onClick={() => setPwBanner(null)}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div className="card">
        <h2>Add User</h2>
        <form onSubmit={handleCreate} className="row">
          <div className="field">
            <label htmlFor="new-username">Username</label>
            <input
              id="new-username"
              required
              minLength={2}
              maxLength={64}
              pattern="[A-Za-z0-9._-]+"
              placeholder="e.g. jsmith"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="new-email">Email (optional)</label>
            <input
              id="new-email"
              type="email"
              placeholder="e.g. jsmith@city.gov"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="new-role">User Type</label>
            <select id="new-role" value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="council_member">Council Member</option>
              <option value="admin_staff">Administrative Staff</option>
              <option value="non_admin_staff">Non-Administrative Staff</option>
              <option value="applicant">Applicant / Citizen</option>
              <option value="read_only">Read-Only</option>
            </select>
          </div>
          <button type="submit" className="btn primary">Create User</button>
        </form>
        {permissionsCatalog.length > 0 && (
          <div style={{ marginTop: '.75rem' }}>
            <div className="muted" style={{ fontSize: '.8rem', marginBottom: '.35rem' }}>
              Additional Module Permissions (optional, beyond role preset):
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '.45rem 1rem', alignItems: 'start' }}>
              {permissionsCatalog.map(p => (
                <label key={p.key} style={{ display: 'flex', alignItems: 'flex-start', gap: '.45rem', fontSize: '.86rem', cursor: 'pointer', lineHeight: 1.35 }}>
                  <input
                    type="checkbox"
                    style={{ width: 'auto', margin: '0.18rem 0 0', flexShrink: 0 }}
                    checked={newPerms.includes(p.key)}
                    onChange={() => toggleNewPerm(p.key)}
                  />
                  <span>{p.label}</span>
                </label>
              ))}
            </div>
          </div>
        )}
        {err && <div className="error-msg" role="alert">{err}</div>}
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '.75rem', marginBottom: '.85rem' }}>
          <h2 style={{ margin: 0 }}>Users ({filteredUsers.length} of {users.length})</h2>
          <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
            <input
              placeholder="Search username or email…"
              aria-label="Search users"
              style={{ minWidth: '210px' }}
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
            />
            <select
              aria-label="Filter by user type"
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
            >
              <option value="">All User Types</option>
              <option value="_staff_council">Staff &amp; Council Only</option>
              <option value="admin">Admin</option>
              <option value="admin_staff">Administrative Staff</option>
              <option value="non_admin_staff">Non-Administrative Staff</option>
              <option value="council_member">Council Member</option>
              <option value="applicant">Applicant / Citizen</option>
              <option value="read_only">Read-Only</option>
            </select>
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th>Username</th>
              <th>Email</th>
              <th>User Type</th>
              <th>Module Grants</th>
              <th>Status</th>
              <th>Last Login</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredUsers.length === 0 ? (
              <tr><td colSpan={7} className="muted">No users match your search or filter.</td></tr>
            ) : filteredUsers.map(u => {
              const isSelf = me && u.id === me.id;
              const explicit = Array.isArray(u.permissions) ? u.permissions : [];
              return (
                <tr key={u.id}>
                  <td>{u.username}</td>
                  <td>
                    <InlineEditable
                      value={u.email || ''}
                      placeholder="Add email…"
                      title="Click to edit email"
                      onSave={async (next) => {
                        await api(`/api/users/${u.id}`, {
                          method: 'PATCH',
                          body: JSON.stringify({ email: next }),
                        });
                        await loadUsers();
                      }}
                    />
                  </td>
                  <td>
                    {u.role === 'admin' ? (
                      ROLE_LABELS.admin
                    ) : (
                      <select
                        value={u.role}
                        aria-label={`User type for ${u.username}`}
                        style={{ padding: '.25rem .45rem', fontSize: '.85rem' }}
                        onChange={async (e) => {
                          try {
                            await api(`/api/users/${u.id}`, {
                              method: 'PATCH',
                              body: JSON.stringify({ role: e.target.value }),
                            });
                            await loadUsers();
                          } catch (error) {
                            showToast(error.message, 'error');
                          }
                        }}
                      >
                        <option value="council_member">Council Member</option>
                        <option value="admin_staff">Administrative Staff</option>
                        <option value="non_admin_staff">Non-Administrative Staff</option>
                        <option value="applicant">Applicant / Citizen</option>
                        <option value="read_only">Read-Only</option>
                      </select>
                    )}
                  </td>
                  <td>
                    {u.role === 'admin' ? (
                      <span className="muted">All (*)</span>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '.2rem' }}>
                        {permissionsCatalog.map(p => (
                          <label key={p.key} style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem', fontSize: '.8rem', cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              style={{ width: 'auto' }}
                              checked={explicit.includes(p.key)}
                              onChange={() => handleToggleUserPerm(u, p.key)}
                            />
                            <span>{p.key}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </td>
                  <td>
                    <span className={`badge ${u.is_active ? 'active' : 'disabled'}`}>
                      {u.is_active ? 'Active' : 'Disabled'}
                    </span>
                  </td>
                  <td>{formatDate(u.last_login_at)}</td>
                  <td>
                    <div className="actions">
                      {!isSelf && (
                        <button
                          type="button"
                          className="btn sm"
                          onClick={async () => {
                            await api(`/api/users/${u.id}`, {
                              method: 'PATCH',
                              body: JSON.stringify({ is_active: !u.is_active }),
                            });
                            await loadUsers();
                          }}
                        >
                          {u.is_active ? 'Disable' : 'Enable'}
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn sm"
                        onClick={async () => {
                          const res = await api(`/api/users/${u.id}/reset-password`, { method: 'POST' });
                          setPwBanner({ username: res.username, password: res.generated_password });
                          setCopied(false);
                        }}
                      >
                        Reset Password
                      </button>
                      {!isSelf && (
                        <button
                          type="button"
                          className="btn sm danger"
                          onClick={async () => {
                            if (!confirm(`Remove user "${u.username}"? This cannot be undone.`)) return;
                            await api(`/api/users/${u.id}`, { method: 'DELETE' });
                            await loadUsers();
                          }}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
