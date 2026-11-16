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

export default function ModulesPage({ onModulesChanged }) {
  const [modules, setModules] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const showToast = useToast();

  const loadModules = useCallback(async () => {
    const list = await api('/api/modules/admin');
    setModules(Array.isArray(list) ? list : []);
  }, []);

  useEffect(() => {
    loadModules().catch(e => showToast(e.message, 'error'));
  }, [loadModules, showToast]);

  const handleToggle = async (mod) => {
    setBusyId(mod.id);
    try {
      const updated = await api(`/api/modules/admin/${mod.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: !mod.enabled }),
      });
      setModules(Array.isArray(updated) ? updated : []);
      showToast(`${mod.name} ${!mod.enabled ? 'enabled' : 'disabled'}`, 'ok');
      await onModulesChanged?.();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section id="section-modules">
      <h1>Manage Modules</h1>
      <div className="card">
        <p className="muted" style={{ marginTop: 0 }}>
          Enable or disable pluggable CivicDesk modules. Disabling a module hides its navigation and disables its API routes while preserving its database records.
        </p>
        <table>
          <thead>
            <tr>
              <th>Module</th>
              <th>Description</th>
              <th>Permissions</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {modules.map(m => (
              <tr key={m.id}>
                <td>
                  <strong>{m.name}</strong>
                  <div className="muted" style={{ fontSize: '.8rem' }}>{m.id}</div>
                </td>
                <td>{m.description}</td>
                <td className="muted" style={{ fontSize: '.82rem' }}>
                  {(m.permissions || []).map(p => p.key).join(', ') || '—'}
                </td>
                <td>
                  <span className={`badge ${m.enabled ? 'active' : 'disabled'}`}>
                    {m.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </td>
                <td>
                  <button
                    type="button"
                    className={`btn sm${m.enabled ? ' danger' : ' primary'}`}
                    disabled={busyId === m.id}
                    onClick={() => handleToggle(m)}
                  >
                    {m.enabled ? 'Disable' : 'Enable'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
