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

const MODULE_LABELS = {
  core: 'Core & Settings',
  agendas: 'Agendas & Minutes',
  permits: 'Building & Zoning Permits',
  complaints: 'Code Complaints & 311',
  citations: 'Municipal Citations',
  utilities: 'Utility Billing',
  records: 'Records & FOIA',
  licensing: 'Licensing & Compliance',
  communications: 'Website & Communications',
  calendar: 'City Calendar & Rentals',
  codification: 'Municipal Codification',
};

function moduleTitle(modId) {
  if (MODULE_LABELS[modId]) return MODULE_LABELS[modId];
  return (modId || 'Other').replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export default function UsersPage({ me, permissionsCatalog = [] }) {
  const [tab, setTab] = useState('directory');
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
  const [grantsUser, setGrantsUser] = useState(null);
  const [grantsDraft, setGrantsDraft] = useState([]);
  const [savingGrants, setSavingGrants] = useState(false);
  const showToast = useToast();

  const { groupedPerms, permByKey } = useMemo(() => {
    const groups = new Map();
    const byKey = new Map();
    for (const p of permissionsCatalog) {
      byKey.set(p.key, p);
      const modId = p.module || 'other';
      if (!groups.has(modId)) groups.set(modId, []);
      groups.get(modId).push(p);
    }
    return {
      groupedPerms: Array.from(groups.entries()).map(([id, items]) => ({ id, title: moduleTitle(id), items })),
      permByKey: byKey,
    };
  }, [permissionsCatalog]);

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
      setTab('directory');
      await loadUsers();
    } catch (error) {
      setErr(error.message);
    }
  };

  const openGrantsModal = (u) => {
    setGrantsUser(u);
    setGrantsDraft(Array.isArray(u.permissions) ? [...u.permissions] : []);
  };

  const toggleDraftPerm = (key) => {
    setGrantsDraft(prev => (prev.includes(key) ? prev.filter(p => p !== key) : [...prev, key]));
  };

  const handleSaveGrants = async () => {
    if (!grantsUser) return;
    setSavingGrants(true);
    try {
      await api(`/api/users/${grantsUser.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ permissions: grantsDraft }),
      });
      setGrantsUser(null);
      await loadUsers();
      showToast('Module grants updated.', 'success');
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      setSavingGrants(false);
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

      <div className="tabs">
        <button type="button" className={`btn sm${tab === 'directory' ? ' active' : ''}`} onClick={() => setTab('directory')}>
          Users Directory ({users.length})
        </button>
        <button type="button" className={`btn sm${tab === 'add' ? ' active' : ''}`} onClick={() => setTab('add')}>
          + Add User
        </button>
      </div>

      {tab === 'add' && (
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
        {groupedPerms.length > 0 && (
          <div style={{ marginTop: '.95rem' }}>
            <div style={{ fontSize: '.86rem', fontWeight: 600, color: '#334e68', marginBottom: '.45rem' }}>
              Additional Module Permissions (optional{newPerms.length > 0 ? ` — ${newPerms.length} selected` : ''})
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '.75rem' }}>
              {groupedPerms.map(grp => (
                <div key={grp.id} style={{ border: '1px solid #e2e8f0', borderRadius: '6px', padding: '.6rem .75rem', background: '#f8fafc' }}>
                  <div style={{ fontSize: '.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: '#475569', marginBottom: '.4rem' }}>
                    {grp.title}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '.35rem' }}>
                    {grp.items.map(p => (
                      <label key={p.key} style={{ display: 'flex', alignItems: 'flex-start', gap: '.45rem', fontSize: '.84rem', cursor: 'pointer', lineHeight: 1.35 }}>
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
              ))}
            </div>
          </div>
        )}
        {err && <div className="error-msg" role="alert">{err}</div>}
      </div>
      )}

      {tab === 'directory' && (
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
                      <span className="muted" style={{ whiteSpace: 'nowrap' }}>All permissions (*)</span>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '.45rem', flexWrap: 'wrap' }}>
                        {explicit.length === 0 ? (
                          <span className="muted" style={{ fontSize: '.82rem', whiteSpace: 'nowrap' }}>Role preset only</span>
                        ) : (
                          <>
                            {explicit.slice(0, 2).map(key => {
                              const p = permByKey.get(key);
                              return (
                                <span
                                  key={key}
                                  className="badge"
                                  title={p ? `${p.label} (${key})` : key}
                                  style={{ background: '#eff6ff', color: '#1d4ed8', fontWeight: 500, maxWidth: '210px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                >
                                  {p ? p.label : key}
                                </span>
                              );
                            })}
                            {explicit.length > 2 && (
                              <span
                                className="badge"
                                title={explicit.slice(2).map(k => permByKey.get(k)?.label || k).join('\n')}
                                style={{ background: '#f1f5f9', color: '#475569', whiteSpace: 'nowrap' }}
                              >
                                +{explicit.length - 2} more
                              </span>
                            )}
                          </>
                        )}
                        <button
                          type="button"
                          className="btn sm"
                          style={{ whiteSpace: 'nowrap' }}
                          onClick={() => openGrantsModal(u)}
                        >
                          Edit Grants
                        </button>
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
      )}

      {grantsUser && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="grants-modal-title"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1rem',
            zIndex: 1000,
          }}
          onClick={(e) => { if (e.target === e.currentTarget && !savingGrants) setGrantsUser(null); }}
        >
          <div className="card" style={{ width: '100%', maxWidth: '760px', maxHeight: '85vh', overflowY: 'auto', margin: 0 }}>
            <div className="between" style={{ marginBottom: '.4rem' }}>
              <h2 id="grants-modal-title" style={{ margin: 0 }}>
                Module Grants — {grantsUser.username}
              </h2>
              <span className="badge" style={{ background: '#f1f5f9', color: '#334e68' }}>
                {ROLE_LABELS[grantsUser.role] || grantsUser.role}
              </span>
            </div>
            <p className="muted" style={{ fontSize: '.86rem', marginTop: 0, marginBottom: '.85rem' }}>
              Select any additional module permissions to grant beyond this user&apos;s default role preset.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: '.75rem' }}>
              {groupedPerms.map(grp => (
                <div key={grp.id} style={{ border: '1px solid #e2e8f0', borderRadius: '6px', padding: '.65rem .8rem', background: '#f8fafc' }}>
                  <div style={{ fontSize: '.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: '#475569', marginBottom: '.45rem' }}>
                    {grp.title}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '.4rem' }}>
                    {grp.items.map(p => (
                      <label key={p.key} style={{ display: 'flex', alignItems: 'flex-start', gap: '.45rem', fontSize: '.86rem', cursor: 'pointer', lineHeight: 1.35 }}>
                        <input
                          type="checkbox"
                          style={{ width: 'auto', margin: '0.18rem 0 0', flexShrink: 0 }}
                          checked={grantsDraft.includes(p.key)}
                          onChange={() => toggleDraftPerm(p.key)}
                        />
                        <span>{p.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="between" style={{ marginTop: '1rem', paddingTop: '.75rem', borderTop: '1px solid #e2e8f0' }}>
              <button
                type="button"
                className="btn sm"
                disabled={savingGrants || grantsDraft.length === 0}
                onClick={() => setGrantsDraft([])}
              >
                Clear Extra Grants ({grantsDraft.length})
              </button>
              <div className="actions">
                <button type="button" className="btn" disabled={savingGrants} onClick={() => setGrantsUser(null)}>
                  Cancel
                </button>
                <button type="button" className="btn primary" disabled={savingGrants} onClick={handleSaveGrants}>
                  {savingGrants ? 'Saving…' : 'Save Grants'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
