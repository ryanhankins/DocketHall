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

const PERMIT_FIELD_OPTIONS = [
  ['applicant_email', 'Email'],
  ['applicant_phone', 'Phone'],
  ['property_address', 'Address / Location'],
  ['building_name', 'Building / Zone'],
  ['suite_name', 'Suite / Rack #'],
  ['parcel_id', 'Parcel #'],
  ['owner_name', 'Owner'],
  ['contractor_name', 'Contractor'],
  ['contractor_license', 'License #'],
  ['estimated_value', 'Est. Value'],
  ['project_description', 'Description'],
];

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

const VARIANCE_TEMPLATE_FIELDS = [
  { key: 'legal_description', section: 'E. Legal Description', label: 'Legal Description of Property', type: 'textarea', required: false, help_text: 'Lot, Block, Subdivision, or metes & bounds from deed/survey.' },
  { key: 'city_code_sections', section: 'G. Applicable City Code Sections', label: 'City Code Section(s) from which variance is requested', type: 'text', required: true, help_text: 'List the specific zoning or city code section numbers.' },
  { key: 'variance_request_details', section: 'H. Variance Request', label: 'State how you wish to vary from the City Code', type: 'textarea', required: true, help_text: 'Describe exact dimensions, setbacks, height, or impervious surface relief requested.' },
  { key: 'practical_difficulties_unique', section: 'J. Variance Criteria', label: '1. Are there practical difficulties or particular hardships due to unique circumstances of the property?', type: 'yes_no_explain', required: true, help_text: '' },
  { key: 'strict_interpretation_hardship', section: 'J. Variance Criteria', label: '2. Would strict interpretation of the Zoning Ordinance deprive the property of reasonable use?', type: 'yes_no_explain', required: true, help_text: '' },
  { key: 'not_self_created', section: 'J. Variance Criteria', label: '3. Are the unique circumstances NOT created by the landowner?', type: 'yes_no_explain', required: true, help_text: '' },
  { key: 'no_special_privilege', section: 'J. Variance Criteria', label: '4. Will granting the variance avoid conferring a special privilege denied to neighboring properties?', type: 'yes_no_explain', required: true, help_text: '' },
  { key: 'essential_character_preserved', section: 'J. Variance Criteria', label: '5. Is the variance in harmony with the Zoning Ordinance and will it preserve the essential character of the locality?', type: 'yes_no_explain', required: true, help_text: '' },
  { key: 'other_gov_permits', section: 'K. Other Governmental Permits', label: 'Are other governmental permits required (DNR, Watershed District, County, State)?', type: 'yes_no_explain', required: false, help_text: '' },
  { key: 'exceeds_25_impervious', section: 'L. Impervious Surface', label: 'Does the proposed project exceed 25% total impervious surface on the lot?', type: 'yes_no_explain', required: false, help_text: '' },
  { key: 'impervious_surface_table', section: 'L. Impervious Surface', label: 'Impervious Surface Breakdown (sq ft)', type: 'impervious_table', required: false, help_text: '', rows: ['Home Footprint', 'Garage', 'Deck / Porch / Patio', 'Driveway / Parking', 'Sidewalks / Walkways', 'Shed / Accessory Structures', 'Pool / Spa', 'Retaining Walls / Other', 'Total Impervious Surface (sq ft)', 'Lot Area / % Impervious'] },
];

function CustomFieldsEditor({ permitType, onSave }) {
  const fields = Array.isArray(permitType.custom_fields) ? permitType.custom_fields : [];
  const [section, setSection] = useState('');
  const [label, setLabel] = useState('');
  const [ftype, setFtype] = useState('text');
  const [req, setReq] = useState(false);

  const addField = async () => {
    if (!label.trim()) return;
    const next = [
      ...fields,
      {
        key: label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || `field_${fields.length + 1}`,
        section: section.trim() || 'Additional Questions',
        label: label.trim(),
        type: ftype,
        required: req,
        help_text: '',
      },
    ];
    await onSave(next);
    setLabel('');
    setReq(false);
  };

  return (
    <details style={{ marginTop: 2 }}>
      <summary style={{ cursor: 'pointer', fontSize: '.78rem', color: '#7c3aed' }}>
        Custom Form Fields ({fields.length})
      </summary>
      <div style={{ padding: '.5rem', background: '#f8fafc', borderRadius: 6, marginTop: 4, minWidth: 290, maxWidth: 420 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.4rem' }}>
          <span className="muted" style={{ fontSize: '.75rem' }}>Structured questions shown on application</span>
          <button
            type="button"
            className="btn sm"
            style={{ fontSize: '.72rem', padding: '2px 6px' }}
            onClick={() => onSave(VARIANCE_TEMPLATE_FIELDS)}
          >
            Load Variance Template
          </button>
        </div>
        {fields.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.25rem', marginBottom: '.5rem' }}>
            {fields.map((f, idx) => (
              <div key={`${f.key}-${idx}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.35rem', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 4, padding: '3px 6px', fontSize: '.75rem' }}>
                <div>
                  {f.section && <span className="muted">[{f.section}] </span>}
                  <strong>{f.label}</strong>{' '}
                  <span className="muted">({f.type}{f.required ? ', req' : ''})</span>
                </div>
                <button
                  type="button"
                  className="btn sm danger"
                  style={{ fontSize: '.7rem', padding: '1px 5px' }}
                  onClick={() => onSave(fields.filter((_, i) => i !== idx))}
                >
                  &times;
                </button>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.3rem' }}>
          <input
            placeholder="Section (e.g. G. City Code)"
            value={section}
            onChange={(e) => setSection(e.target.value)}
            style={{ fontSize: '.75rem', padding: '3px 6px' }}
          />
          <select value={ftype} onChange={(e) => setFtype(e.target.value)} style={{ fontSize: '.75rem', padding: '3px 6px' }}>
            <option value="text">Short Text</option>
            <option value="textarea">Long Text</option>
            <option value="yes_no_explain">Yes / No + Explain</option>
            <option value="impervious_table">Impervious Surface Table</option>
            <option value="number">Number</option>
            <option value="date">Date</option>
          </select>
          <input
            placeholder="Question / Field Label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            style={{ fontSize: '.75rem', padding: '3px 6px', gridColumn: '1 / -1' }}
          />
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.25rem', fontSize: '.75rem' }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={req} onChange={(e) => setReq(e.target.checked)} />
            Required
          </label>
          <button type="button" className="btn sm primary" style={{ fontSize: '.74rem', padding: '2px 8px' }} onClick={addField}>
            + Add Field
          </button>
        </div>
      </div>
    </details>
  );
}

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
                  <details style={{ marginTop: 2 }}>
                    <summary style={{ cursor: 'pointer', fontSize: '.78rem', color: '#2563eb' }}>
                      Required Fields ({(t.required_fields || []).length})
                    </summary>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.25rem .6rem', padding: '.35rem', background: '#f8fafc', borderRadius: 4, marginTop: 2, maxWidth: 260 }}>
                      {PERMIT_FIELD_OPTIONS.map(([fk, fl]) => {
                        const checked = (t.required_fields || []).includes(fk);
                        return (
                          <label key={fk} style={{ display: 'inline-flex', alignItems: 'center', gap: '.25rem', fontSize: '.76rem', cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              style={{ width: 'auto' }}
                              checked={checked}
                              onChange={async () => {
                                const cur = Array.isArray(t.required_fields) ? t.required_fields : [];
                                const next = checked ? cur.filter(x => x !== fk) : [...cur, fk];
                                await api(`/api/permits/admin/types/${t.id}`, {
                                  method: 'PATCH',
                                  body: JSON.stringify({ required_fields: next }),
                                });
                                await loadCatalog();
                              }}
                            />
                            <span>{fl}</span>
                          </label>
                        );
                      })}
                    </div>
                  </details>
                  <CustomFieldsEditor
                    permitType={t}
                    onSave={async (next) => {
                      await api(`/api/permits/admin/types/${t.id}`, {
                        method: 'PATCH',
                        body: JSON.stringify({ custom_fields: next }),
                      });
                      await loadCatalog();
                    }}
                  />
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
