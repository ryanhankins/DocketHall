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

const PERMIT_NOTIFICATION_EVENTS = [
  {
    key: 'permits_submitted',
    label: 'New Permit Application Submitted',
    description: 'Sent when an applicant or staff member submits a new permit application.',
  },
  {
    key: 'permits_updated',
    label: 'Permit Status Changed',
    description: 'Sent when staff updates a permit application status (e.g., approved, needs info, issued, denied).',
  },
];

export default function PermitCatalogAdminPage() {
  const [settings, setSettings] = useState({
    general_instructions: '',
    required_documents_note: '',
    fee_schedule_url: '',
    fee_schedule_label: '',
    payment_instructions: '',
    payment_url: '',
  });
  const [types, setTypes] = useState([]);
  const [uses, setUses] = useState([]);

  const [newTypeName, setNewTypeName] = useState('');
  const [newTypeKind, setNewTypeKind] = useState('construction');
  const [newTypeExpRule, setNewTypeExpRule] = useState('none');
  const [newUseTypeId, setNewUseTypeId] = useState('');
  const [newUseName, setNewUseName] = useState('');
  const [newUseFee, setNewUseFee] = useState('');
  const [reqCoi, setReqCoi] = useState(true);
  const [reqPlans, setReqPlans] = useState(false);
  const [reqSurvey, setReqSurvey] = useState(false);
  const [msg, setMsg] = useState({ text: '', isError: false });
  const showToast = useToast();

  const loadCatalog = useCallback(async () => {
    const data = await api('/api/permits/admin/catalog');
    if (data.settings) setSettings(data.settings);
    const tList = Array.isArray(data.types) ? data.types : [];
    setTypes(tList);
    setUses(Array.isArray(data.uses) ? data.uses : []);
    setNewUseTypeId(prev => (prev && tList.some(t => String(t.id) === prev) ? prev : (tList[0] ? String(tList[0].id) : '')));
  }, []);

  useEffect(() => {
    loadCatalog().catch(e => showToast(e.message, 'error'));
  }, [loadCatalog, showToast]);

  const handleSaveSettings = async (e) => {
    e.preventDefault();
    setMsg({ text: '', isError: false });
    try {
      await api('/api/permits/admin/settings', {
        method: 'PUT',
        body: JSON.stringify(settings),
      });
      setMsg({ text: 'Portal settings saved.', isError: false });
    } catch (err) {
      setMsg({ text: err.message, isError: true });
    }
  };

  return (
    <section id="section-permits-catalog-admin">
      <div className="between" style={{ marginBottom: '1rem' }}>
        <h1 style={{ margin: 0 }}>Permit Catalog &amp; Portal Settings</h1>
        <a href="/portal" target="_blank" rel="noreferrer" className="btn sm">Open Public Permits Portal</a>
      </div>

      <div className="card">
        <h2>Public Portal Instructions &amp; Payment Links</h2>
        <form onSubmit={handleSaveSettings}>
          <div className="field" style={{ marginBottom: '.75rem' }}>
            <label>General Instructions</label>
            <textarea rows={3} value={settings.general_instructions} onChange={(e) => setSettings(s => ({ ...s, general_instructions: e.target.value }))} />
          </div>
          <div className="field" style={{ marginBottom: '.75rem' }}>
            <label>Required Documents Checklist</label>
            <textarea rows={3} value={settings.required_documents_note} onChange={(e) => setSettings(s => ({ ...s, required_documents_note: e.target.value }))} />
          </div>
          <div className="row" style={{ marginBottom: '.75rem' }}>
            <div className="field" style={{ flex: 1, minWidth: '200px' }}>
              <label>Fee Schedule Link Label</label>
              <input value={settings.fee_schedule_label} onChange={(e) => setSettings(s => ({ ...s, fee_schedule_label: e.target.value }))} />
            </div>
            <div className="field" style={{ flex: 2, minWidth: '240px' }}>
              <label>Fee Schedule URL (optional PDF or webpage)</label>
              <input placeholder="https://..." value={settings.fee_schedule_url} onChange={(e) => setSettings(s => ({ ...s, fee_schedule_url: e.target.value }))} />
            </div>
          </div>
          <div className="row" style={{ marginBottom: '.85rem' }}>
            <div className="field" style={{ flex: 2, minWidth: '240px' }}>
              <label>Payment Instructions</label>
              <input value={settings.payment_instructions} onChange={(e) => setSettings(s => ({ ...s, payment_instructions: e.target.value }))} />
            </div>
            <div className="field" style={{ flex: 1, minWidth: '220px' }}>
              <label>External Payment URL (optional)</label>
              <input placeholder="https://..." value={settings.payment_url} onChange={(e) => setSettings(s => ({ ...s, payment_url: e.target.value }))} />
            </div>
          </div>
          <button type="submit" className="btn primary">Save Portal Settings</button>
          {msg.text && <div className={msg.isError ? 'error-msg' : 'ok-msg'} role="status">{msg.text}</div>}
        </form>
      </div>

      <div className="card">
        <h2>Permit Types &amp; Uses Catalog</h2>
        <form
          className="row"
          style={{ marginBottom: '1rem', alignItems: 'flex-end' }}
          onSubmit={async (e) => {
            e.preventDefault();
            if (!newTypeName.trim()) return;
            await api('/api/permits/admin/types', {
              method: 'POST',
              body: JSON.stringify({
                name: newTypeName.trim(),
                sort_order: types.length + 1,
                kind: newTypeKind,
                expiration_rule: newTypeExpRule,
              }),
            });
            setNewTypeName('');
            await loadCatalog();
          }}
        >
          <div className="field" style={{ flex: 2, minWidth: '200px' }}>
            <label>New Permit / License Type</label>
            <input placeholder="e.g. Small Craft Permits, Golf Cart Permits" value={newTypeName} onChange={(e) => setNewTypeName(e.target.value)} />
          </div>
          <div className="field" style={{ minWidth: '170px' }}>
            <label>Form Style</label>
            <select
              value={newTypeKind}
              onChange={(e) => {
                const k = e.target.value;
                setNewTypeKind(k);
                if (k === 'annual_license' && newTypeExpRule === 'none') setNewTypeExpRule('calendar_year');
              }}
            >
              <option value="construction">Zoning / Construction</option>
              <option value="annual_license">Annual License / Permit</option>
            </select>
          </div>
          <div className="field" style={{ minWidth: '180px' }}>
            <label>Auto-Expiration on Issue</label>
            <select value={newTypeExpRule} onChange={(e) => setNewTypeExpRule(e.target.value)}>
              <option value="none">None</option>
              <option value="calendar_year">End of Year (Dec 31)</option>
              <option value="one_year">1 Year (365 days)</option>
            </select>
          </div>
          <button type="submit" className="btn sm primary">Add Permit Type</button>
        </form>

        <form
          className="row"
          style={{ marginBottom: '1.1rem', alignItems: 'flex-end' }}
          onSubmit={async (e) => {
            e.preventDefault();
            if (!newUseTypeId || !newUseName.trim()) return;
            await api('/api/permits/admin/uses', {
              method: 'POST',
              body: JSON.stringify({
                permit_type_id: Number(newUseTypeId),
                name: newUseName.trim(),
                fee_amount: newUseFee.trim(),
                requires_coi: reqCoi,
                requires_plans: reqPlans,
                requires_survey: reqSurvey,
                sort_order: uses.length + 1,
              }),
            });
            setNewUseName('');
            setNewUseFee('');
            await loadCatalog();
          }}
        >
          <div className="field" style={{ minWidth: '190px' }}>
            <label>Permit Type</label>
            <select value={newUseTypeId} onChange={(e) => setNewUseTypeId(e.target.value)}>
              {types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: 2, minWidth: '200px' }}>
            <label>Permit Application / Use</label>
            <input placeholder="e.g. Temporary Banner" value={newUseName} onChange={(e) => setNewUseName(e.target.value)} />
          </div>
          <div className="field" style={{ minWidth: '110px' }}>
            <label>Fee (optional)</label>
            <input placeholder="$75" value={newUseFee} onChange={(e) => setNewUseFee(e.target.value)} />
          </div>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem', fontSize: '.84rem', cursor: 'pointer' }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={reqCoi} onChange={(e) => setReqCoi(e.target.checked)} />
            <span>COI</span>
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem', fontSize: '.84rem', cursor: 'pointer' }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={reqPlans} onChange={(e) => setReqPlans(e.target.checked)} />
            <span>Plans</span>
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem', fontSize: '.84rem', cursor: 'pointer' }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={reqSurvey} onChange={(e) => setReqSurvey(e.target.checked)} />
            <span>Survey</span>
          </label>
          <button type="submit" className="btn sm primary">Add Use</button>
        </form>

        <table>
          <thead>
            <tr><th>Permit / License Type</th><th>Form Style &amp; Renewal</th><th>Application / Use</th><th>Fee</th><th>Requirements</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {types.map(t => {
              const tUses = uses.filter(u => u.permit_type_id === t.id);
              const kindControls = (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '.25rem' }}>
                  <select
                    aria-label={`${t.name} form style`}
                    style={{ width: 'auto', fontSize: '.82rem', padding: '2px 6px' }}
                    value={t.kind || 'construction'}
                    onChange={async (e) => {
                      await api(`/api/permits/admin/types/${t.id}`, {
                        method: 'PATCH',
                        body: JSON.stringify({ kind: e.target.value }),
                      });
                      await loadCatalog();
                    }}
                  >
                    <option value="construction">Zoning / Construction</option>
                    <option value="annual_license">Annual License / Permit</option>
                  </select>
                  <select
                    aria-label={`${t.name} expiration rule`}
                    style={{ width: 'auto', fontSize: '.82rem', padding: '2px 6px' }}
                    value={t.expiration_rule || 'none'}
                    onChange={async (e) => {
                      await api(`/api/permits/admin/types/${t.id}`, {
                        method: 'PATCH',
                        body: JSON.stringify({ expiration_rule: e.target.value }),
                      });
                      await loadCatalog();
                    }}
                  >
                    <option value="none">No Auto-Expiration</option>
                    <option value="calendar_year">Expires Dec 31</option>
                    <option value="one_year">Expires +365 Days</option>
                  </select>
                </div>
              );
              if (!tUses.length) {
                return (
                  <tr key={`t-${t.id}`}>
                    <td><strong>{t.name}</strong></td>
                    <td>{kindControls}</td>
                    <td className="muted">(No uses yet)</td>
                    <td>—</td>
                    <td>—</td>
                    <td>
                      <button
                        type="button"
                        className="btn sm danger"
                        onClick={async () => {
                          await api(`/api/permits/admin/types/${t.id}`, { method: 'DELETE' });
                          await loadCatalog();
                        }}
                      >
                        Remove Type
                      </button>
                    </td>
                  </tr>
                );
              }
              return tUses.map((u, uIdx) => (
                <tr key={`u-${u.id}`}>
                  <td>{t.name}</td>
                  <td>{uIdx === 0 ? kindControls : ''}</td>
                  <td>{u.name}</td>
                  <td>{u.fee_amount || '—'}</td>
                  <td className="muted">
                    {[u.requires_coi && 'COI', u.requires_plans && 'Plans', u.requires_survey && 'Survey'].filter(Boolean).join(', ') || 'None'}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn sm danger"
                      onClick={async () => {
                        await api(`/api/permits/admin/uses/${u.id}`, { method: 'DELETE' });
                        await loadCatalog();
                      }}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ));
            })}
          </tbody>
        </table>
      </div>

      <ModuleNotificationsCard
        moduleId="permits"
        title="Permit Email Notifications"
        events={PERMIT_NOTIFICATION_EVENTS}
      />
    </section>
  );
}
