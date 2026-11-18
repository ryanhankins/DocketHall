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
import { api, formatDate } from '../../core/api.js';
import { useToast } from '../../core/toast.jsx';
import { permitExpiryInfo, permitStatusBadge } from './MyPermitsPage.jsx';
import PermitDetailWorkspace from './PermitDetailWorkspace.jsx';

export default function PermitsReviewPage({ onNavigate, initialId = null }) {
  const [permits, setPermits] = useState([]);
  const [selectedId, setSelectedId] = useState(initialId);
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [showParcels, setShowParcels] = useState(false);
  const [parcels, setParcels] = useState([]);
  const [parcelQuery, setParcelQuery] = useState('');
  const [newParcel, setNewParcel] = useState({ parcel_id: '', address: '', building_name: '', suite_name: '', owner_name: '' });
  const showToast = useToast();

  const loadAll = useCallback(async () => {
    const list = await api('/api/permits');
    setPermits(Array.isArray(list) ? list : []);
  }, []);

  const loadParcels = useCallback(async (q = '') => {
    const list = await api(`/api/permits/parcels?q=${encodeURIComponent(q)}`);
    setParcels(Array.isArray(list) ? list : []);
  }, []);

  useEffect(() => {
    loadAll().catch(e => showToast(e.message, 'error'));
  }, [loadAll, showToast]);

  useEffect(() => {
    if (showParcels) loadParcels(parcelQuery).catch(() => {});
  }, [showParcels, parcelQuery, loadParcels]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return permits.filter(p => {
      if (statusFilter !== 'all' && p.status !== statusFilter) return false;
      if (q) {
        const hay = `${p.permit_number} ${p.permit_type_name} ${p.permit_use_name} ${p.applicant_name} ${p.property_address} ${p.parcel_id}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [permits, statusFilter, search]);

  const feeTotals = useMemo(() => {
    let total = 0;
    let paid = 0;
    let unpaid = 0;
    for (const p of filtered) {
      const n = Number.parseFloat(String(p.fee_amount || '').replace(/[^0-9.-]/g, ''));
      if (!Number.isFinite(n)) continue;
      total += n;
      if (p.payment_status === 'paid') paid += n;
      else if (p.payment_status === 'unpaid') unpaid += n;
    }
    const fmt = (v) => v.toLocaleString(undefined, { style: 'currency', currency: 'USD' });
    return { total: fmt(total), paid: fmt(paid), unpaid: fmt(unpaid) };
  }, [filtered]);

  const exportUrl = `/api/permits/export.csv?status=${encodeURIComponent(statusFilter)}&q=${encodeURIComponent(search.trim())}`;

  const selectedPermit = useMemo(
    () => permits.find(p => p.id === selectedId) || null,
    [permits, selectedId],
  );

  if (selectedPermit) {
    return (
      <section id="section-permits-review">
        <PermitDetailWorkspace
          permit={selectedPermit}
          isManager
          onUpdated={(updated) => setPermits(prev => prev.map(x => (x.id === updated.id ? updated : x)))}
          onBack={() => setSelectedId(null)}
        />
      </section>
    );
  }

  return (
    <section id="section-permits-review">
      <div className="between" style={{ marginBottom: '1rem' }}>
        <h1 style={{ margin: 0 }}>Permit Review Queue</h1>
        <div className="actions">
          <button type="button" className="btn sm" onClick={() => setShowParcels(v => !v)}>
            {showParcels ? 'Hide Parcel Directory' : 'Parcel Directory'}
          </button>
          <button type="button" className="btn sm primary" onClick={() => onNavigate('#permits-apply')}>
            + Add Permit
          </button>
        </div>
      </div>

      {showParcels && (
        <div className="card">
          <h2>Parcel / Property Directory</h2>
          <form
            className="row"
            style={{ marginBottom: '.85rem', alignItems: 'flex-end' }}
            onSubmit={async (e) => {
              e.preventDefault();
              await api('/api/permits/parcels', { method: 'POST', body: JSON.stringify(newParcel) });
              setNewParcel({ parcel_id: '', address: '', building_name: '', suite_name: '', owner_name: '' });
              showToast('Parcel saved', 'ok');
              await loadParcels(parcelQuery);
            }}
          >
            <div className="field" style={{ minWidth: '140px' }}>
              <label>Parcel ID *</label>
              <input required placeholder="e.g. 12-030-21" value={newParcel.parcel_id} onChange={(e) => setNewParcel(p => ({ ...p, parcel_id: e.target.value }))} />
            </div>
            <div className="field" style={{ flex: 2, minWidth: '180px' }}>
              <label>Address</label>
              <input placeholder="207 Birchwood Ave" value={newParcel.address} onChange={(e) => setNewParcel(p => ({ ...p, address: e.target.value }))} />
            </div>
            <div className="field" style={{ flex: 1, minWidth: '130px' }}>
              <label>Owner Name</label>
              <input value={newParcel.owner_name} onChange={(e) => setNewParcel(p => ({ ...p, owner_name: e.target.value }))} />
            </div>
            <div className="field" style={{ minWidth: '110px' }}>
              <label>Building</label>
              <input value={newParcel.building_name} onChange={(e) => setNewParcel(p => ({ ...p, building_name: e.target.value }))} />
            </div>
            <div className="field" style={{ minWidth: '90px' }}>
              <label>Suite/Unit</label>
              <input value={newParcel.suite_name} onChange={(e) => setNewParcel(p => ({ ...p, suite_name: e.target.value }))} />
            </div>
            <button type="submit" className="btn sm primary">Save Parcel</button>
          </form>
          <div className="field" style={{ maxWidth: '320px', marginBottom: '.6rem' }}>
            <input type="search" placeholder="Search parcels..." value={parcelQuery} onChange={(e) => setParcelQuery(e.target.value)} />
          </div>
          {!parcels.length ? (
            <p className="muted">No saved parcels yet.</p>
          ) : (
            <table>
              <thead>
                <tr><th>Parcel ID</th><th>Address</th><th>Owner</th><th>Building / Unit</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {parcels.map(pr => (
                  <tr key={pr.id}>
                    <td><strong>{pr.parcel_id}</strong></td>
                    <td>{pr.address || '—'}</td>
                    <td>{pr.owner_name || '—'}</td>
                    <td>{pr.building_name || '—'}{pr.suite_name ? ` / ${pr.suite_name}` : ''}</td>
                    <td>
                      <button
                        type="button"
                        className="btn sm danger"
                        onClick={async () => {
                          await api(`/api/permits/parcels/${pr.id}`, { method: 'DELETE' });
                          await loadParcels(parcelQuery);
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

      <div className="card">
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: 1, minWidth: '200px' }}>
            <label htmlFor="perm-rev-search">Search Permits</label>
            <input id="perm-rev-search" type="search" placeholder="Number, parcel, address, applicant, permit type..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="perm-rev-status">Status</label>
            <select id="perm-rev-status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">All ({permits.length})</option>
              <option value="submitted">Submitted</option>
              <option value="under_review">Under Review</option>
              <option value="needs_info">Needs Info</option>
              <option value="approved">Approved</option>
              <option value="issued">Issued</option>
              <option value="denied">Denied</option>
              <option value="closed">Closed</option>
            </select>
          </div>
          <a className="btn" href={exportUrl} download="permits_export.csv">Export CSV</a>
        </div>
        <div className="muted" style={{ fontSize: '.85rem', marginTop: '.6rem' }}>
          Showing <strong>{filtered.length}</strong> permit(s) · Assessed Fees: <strong>{feeTotals.total}</strong> (Paid: {feeTotals.paid} · Unpaid: {feeTotals.unpaid})
        </div>
      </div>

      <div className="card">
        {!filtered.length ? (
          <p className="muted">No matching permit applications.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Permit #</th>
                <th>Permit Type / Use</th>
                <th>Applicant</th>
                <th>Location / Parcel</th>
                <th>Status</th>
                <th>Submitted</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => (
                <tr key={p.id}>
                  <td>
                    <button type="button" className="link-btn" onClick={() => setSelectedId(p.id)}>
                      {p.permit_number}
                    </button>
                  </td>
                  <td>
                    <div><strong>{p.permit_type_name}</strong></div>
                    <div className="muted" style={{ fontSize: '.82rem' }}>{p.permit_use_name}</div>
                  </td>
                  <td>{p.applicant_name}</td>
                  <td>
                    <div>{p.property_address}</div>
                    {p.parcel_id && <div className="muted" style={{ fontSize: '.82rem' }}>Parcel: {p.parcel_id}</div>}
                  </td>
                  <td>
                    <span className={permitStatusBadge(p.status)}>{p.status.replace('_', ' ')}</span>
                    {(() => {
                      const exp = permitExpiryInfo(p.expires_at);
                      return exp && exp.cls !== 'muted'
                        ? <div style={{ marginTop: 4 }}><span className={exp.cls}>{exp.label}</span></div>
                        : null;
                    })()}
                  </td>
                  <td className="muted">{formatDate(p.created_at)}</td>
                  <td>
                    <div className="actions">
                      <button type="button" className="btn sm primary" onClick={() => setSelectedId(p.id)}>Manage</button>
                      <button
                        type="button"
                        className="btn sm danger"
                        onClick={async () => {
                          if (!confirm(`Delete permit ${p.permit_number}?`)) return;
                          await api(`/api/permits/${p.id}`, { method: 'DELETE' });
                          setPermits(prev => prev.filter(x => x.id !== p.id));
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
    </section>
  );
}
