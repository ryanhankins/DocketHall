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
import { api } from '../../core/api.js';
import { useToast } from '../../core/toast.jsx';
import PermitDetailWorkspace from './PermitDetailWorkspace.jsx';

export function permitStatusBadge(status) {
  if (status === 'issued' || status === 'approved' || status === 'closed') return 'badge active';
  if (status === 'denied') return 'badge disabled';
  return 'badge draft';
}

export function permitExpiryInfo(expiresAt) {
  if (!expiresAt) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const exp = new Date(`${expiresAt}T00:00:00`);
  if (Number.isNaN(exp.getTime())) return null;
  const diffDays = Math.ceil((exp - today) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return { label: `Expired (${expiresAt})`, cls: 'badge disabled' };
  if (diffDays <= 30) return { label: `Expires in ${diffDays}d (${expiresAt})`, cls: 'badge draft' };
  return { label: `Expires ${expiresAt}`, cls: 'muted' };
}

export default function MyPermitsPage({ onNavigate }) {
  const [permits, setPermits] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [paymentInfo, setPaymentInfo] = useState({ instructions: '', url: '' });
  const showToast = useToast();

  const loadPermits = useCallback(async () => {
    const [list, cat] = await Promise.all([
      api('/api/permits/mine'),
      api('/api/permits/public/catalog').catch(() => ({ settings: {} })),
    ]);
    setPermits(Array.isArray(list) ? list : []);
    setPaymentInfo({
      instructions: cat.settings?.payment_instructions || '',
      url: cat.settings?.payment_url || '',
    });
  }, []);

  useEffect(() => {
    loadPermits().catch(e => showToast(e.message, 'error'));
  }, [loadPermits, showToast]);

  const selectedPermit = useMemo(
    () => permits.find(p => p.id === selectedId) || null,
    [permits, selectedId],
  );

  if (selectedPermit) {
    return (
      <section id="section-my-permits">
        <PermitDetailWorkspace
          permit={selectedPermit}
          isManager={false}
          onUpdated={(updated) => setPermits(prev => prev.map(x => (x.id === updated.id ? updated : x)))}
          onBack={() => setSelectedId(null)}
        />
      </section>
    );
  }

  return (
    <section id="section-my-permits">
      <div className="between" style={{ marginBottom: '1rem' }}>
        <h1 style={{ margin: 0 }}>My Permits</h1>
        <button type="button" className="btn primary" onClick={() => onNavigate('#permits-apply')}>
          + Apply for Permit
        </button>
      </div>

      {paymentInfo.instructions && (
        <div className="card" style={{ background: '#f8fafc' }}>
          <div className="between">
            <div>
              <strong>Payment Information:</strong>{' '}
              <span className="muted">{paymentInfo.instructions}</span>
            </div>
            {paymentInfo.url && (
              <a className="btn sm primary" href={paymentInfo.url} target="_blank" rel="noreferrer">
                Pay Online
              </a>
            )}
          </div>
        </div>
      )}

      {!permits.length ? (
        <div className="card muted">
          You have not submitted any permit applications yet.
        </div>
      ) : (
        <div className="card">
          <h2>My Permits</h2>
          <table>
            <thead>
              <tr>
                <th>Application / Permit #</th>
                <th>Parcel #</th>
                <th>Unit ID</th>
                <th>Location</th>
                <th>Permit Type</th>
                <th>Permit Use</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {permits.map(p => (
                <tr key={p.id}>
                  <td>
                    <button type="button" className="link-btn" onClick={() => setSelectedId(p.id)}>
                      {p.permit_number}
                    </button>
                  </td>
                  <td>{p.parcel_id || '—'}</td>
                  <td>{p.suite_name || '—'}</td>
                  <td>{p.property_address}</td>
                  <td>{p.permit_type_name}</td>
                  <td>{p.permit_use_name}</td>
                  <td>
                    <span className={permitStatusBadge(p.status)}>{p.status.replace('_', ' ')}</span>
                    {(() => {
                      const exp = permitExpiryInfo(p.expires_at);
                      return exp && exp.cls !== 'muted'
                        ? <div style={{ marginTop: 4 }}><span className={exp.cls}>{exp.label}</span></div>
                        : null;
                    })()}
                  </td>
                  <td>
                    <div className="actions">
                      <button type="button" className="btn sm primary" onClick={() => setSelectedId(p.id)}>Open</button>
                      <a className="btn sm" href={`/api/permits/${p.id}/pdf`} target="_blank" rel="noreferrer">PDF</a>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
