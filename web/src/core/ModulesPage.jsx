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
import ServiceIcon from './ServiceIcon.jsx';
import { useToast } from './toast.jsx';

export default function ModulesPage({ onModulesChanged }) {
  const [modules, setModules] = useState([]);
  const [presets, setPresets] = useState([]);
  const [expanded, setExpanded] = useState({});
  const [busyId, setBusyId] = useState(null);
  const [busyPreset, setBusyPreset] = useState('');
  const showToast = useToast();

  const loadAll = useCallback(async () => {
    const [list, presetList] = await Promise.all([
      api('/api/modules/admin'),
      api('/api/modules/admin/presets').catch(() => []),
    ]);
    setModules(Array.isArray(list) ? list : []);
    setPresets(Array.isArray(presetList) ? presetList : []);
  }, []);

  useEffect(() => {
    loadAll().catch(e => showToast(e.message, 'error'));
  }, [loadAll, showToast]);

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

  const handleFeatureToggle = async (mod, feat) => {
    const key = `${mod.id}:${feat.key}`;
    setBusyId(key);
    try {
      const updated = await api(`/api/modules/admin/${mod.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ features: { [feat.key]: !feat.enabled } }),
      });
      setModules(Array.isArray(updated) ? updated : []);
      showToast(`${feat.label} ${!feat.enabled ? 'enabled' : 'disabled'}`, 'ok');
      await onModulesChanged?.();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleApplyPreset = async (preset) => {
    setBusyPreset(preset.id);
    try {
      const updated = await api('/api/modules/admin/preset', {
        method: 'POST',
        body: JSON.stringify({ preset: preset.id }),
      });
      setModules(Array.isArray(updated) ? updated : []);
      showToast(`Applied "${preset.label}" profile`, 'ok');
      await onModulesChanged?.();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setBusyPreset('');
    }
  };

  return (
    <section id="section-modules">
      <h1>Manage Modules</h1>

      {presets.length > 0 && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Quick Complexity Presets</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Start simple and grow over time. Applying a preset configures modules and sub-features in one click without deleting any existing data.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '.75rem' }}>
            {presets.map(p => (
              <div
                key={p.id}
                style={{
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  padding: '.85rem',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: '.6rem',
                }}
              >
                <div>
                  <div style={{ fontWeight: 700, marginBottom: '.25rem' }}>{p.label}</div>
                  <div className="muted" style={{ fontSize: '.84rem', lineHeight: 1.4 }}>{p.description}</div>
                  <div className="muted" style={{ fontSize: '.78rem', marginTop: '.4rem' }}>
                    {p.enabled_modules.length} modules active
                  </div>
                </div>
                <button
                  type="button"
                  className="btn sm primary"
                  disabled={!!busyPreset}
                  onClick={() => handleApplyPreset(p)}
                >
                  {busyPreset === p.id ? 'Applying…' : `Apply ${p.label}`}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Modules &amp; Sub-Features</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Enable or disable pluggable CivicDesk modules, or expand a module to toggle finer-grained capabilities. Disabling a module or feature hides its navigation while preserving database records.
        </p>
        <table>
          <thead>
            <tr>
              <th>Module</th>
              <th>Description</th>
              <th>Sub-Features</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {modules.map(m => {
              const feats = Array.isArray(m.features) ? m.features : [];
              const onCount = feats.filter(f => f.enabled).length;
              const isOpen = !!expanded[m.id];
              return (
                <React.Fragment key={m.id}>
                  <tr>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem' }}>
                        <ServiceIcon id={m.id} size={18} badge />
                        <div>
                          <strong>{m.name}</strong>
                          <div className="muted" style={{ fontSize: '.8rem' }}>{m.id}</div>
                        </div>
                      </div>
                    </td>
                    <td>{m.description}</td>
                    <td>
                      {feats.length > 0 ? (
                        <button
                          type="button"
                          className="btn sm"
                          onClick={() => setExpanded(prev => ({ ...prev, [m.id]: !prev[m.id] }))}
                        >
                          {isOpen ? 'Hide' : 'Configure'} ({onCount}/{feats.length})
                        </button>
                      ) : (
                        <span className="muted" style={{ fontSize: '.82rem' }}>Standard</span>
                      )}
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
                  {isOpen && feats.length > 0 && (
                    <tr>
                      <td colSpan={5} style={{ background: '#f8fafc', padding: '.75rem 1rem' }}>
                        <div style={{ fontWeight: 600, fontSize: '.86rem', marginBottom: '.45rem' }}>
                          {m.name} Capabilities {!m.enabled && <span className="muted">(module currently disabled)</span>}
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '.5rem' }}>
                          {feats.map(f => (
                            <label
                              key={f.key}
                              style={{
                                display: 'flex',
                                alignItems: 'flex-start',
                                gap: '.5rem',
                                background: '#fff',
                                border: '1px solid #e2e8f0',
                                borderRadius: '6px',
                                padding: '.5rem .65rem',
                                cursor: 'pointer',
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={!!f.enabled}
                                disabled={busyId === `${m.id}:${f.key}`}
                                onChange={() => handleFeatureToggle(m, f)}
                                style={{ width: 'auto', marginTop: '.2rem' }}
                              />
                              <div>
                                <div style={{ fontWeight: 600, fontSize: '.86rem' }}>{f.label}</div>
                                {f.description && (
                                  <div className="muted" style={{ fontSize: '.78rem' }}>{f.description}</div>
                                )}
                              </div>
                            </label>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
