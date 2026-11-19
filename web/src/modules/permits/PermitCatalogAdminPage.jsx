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
  const [editIdx, setEditIdx] = useState(null);
  const [editDraft, setEditDraft] = useState(null);

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
    <div style={{ padding: '.6rem', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, marginTop: '.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.45rem', flexWrap: 'wrap', gap: '.4rem' }}>
        <strong style={{ fontSize: '.82rem' }}>Custom Form Questions ({fields.length})</strong>
        <button
          type="button"
          className="btn sm"
          style={{ fontSize: '.74rem', padding: '2px 8px' }}
          onClick={() => onSave(VARIANCE_TEMPLATE_FIELDS)}
        >
          Load Variance Template
        </button>
      </div>
      {fields.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.3rem', marginBottom: '.6rem' }}>
          {fields.map((f, idx) => (
            <div key={`${f.key}-${idx}`} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 4, padding: '4px 8px', fontSize: '.78rem' }}>
              {editIdx === idx && editDraft ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.3rem', alignItems: 'center' }}>
                  <input
                    placeholder="Section"
                    value={editDraft.section || ''}
                    onChange={(e) => setEditDraft(d => ({ ...d, section: e.target.value }))}
                    style={{ fontSize: '.76rem', padding: '3px 6px' }}
                  />
                  <select
                    value={editDraft.type || 'text'}
                    onChange={(e) => setEditDraft(d => ({ ...d, type: e.target.value }))}
                    style={{ fontSize: '.76rem', padding: '3px 6px' }}
                  >
                    <option value="text">Short Text</option>
                    <option value="textarea">Long Text</option>
                    <option value="yes_no_explain">Yes / No + Explain</option>
                    <option value="impervious_table">Impervious Surface Table</option>
                    <option value="number">Number</option>
                    <option value="date">Date</option>
                  </select>
                  <input
                    placeholder="Question / Field Label"
                    value={editDraft.label || ''}
                    onChange={(e) => setEditDraft(d => ({ ...d, label: e.target.value }))}
                    style={{ fontSize: '.76rem', padding: '3px 6px', gridColumn: '1 / -1' }}
                  />
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.25rem', fontSize: '.75rem' }}>
                    <input
                      type="checkbox"
                      style={{ width: 'auto' }}
                      checked={Boolean(editDraft.required)}
                      onChange={(e) => setEditDraft(d => ({ ...d, required: e.target.checked }))}
                    />
                    Required
                  </label>
                  <div style={{ display: 'flex', gap: '.25rem', justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      className="btn sm primary"
                      style={{ fontSize: '.72rem', padding: '2px 7px' }}
                      onClick={async () => {
                        const next = fields.map((item, i) => (i === idx ? { ...item, ...editDraft } : item));
                        await onSave(next);
                        setEditIdx(null);
                        setEditDraft(null);
                      }}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      className="btn sm"
                      style={{ fontSize: '.72rem', padding: '2px 7px' }}
                      onClick={() => { setEditIdx(null); setEditDraft(null); }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.4rem' }}>
                  <div>
                    {f.section && <span className="muted">[{f.section}] </span>}
                    <strong>{f.label}</strong>{' '}
                    <span className="muted">({f.type}{f.required ? ', required' : ''})</span>
                  </div>
                  <div style={{ display: 'flex', gap: '.25rem', flexShrink: 0 }}>
                    <button
                      type="button"
                      className="btn sm"
                      style={{ fontSize: '.72rem', padding: '1px 6px' }}
                      onClick={() => { setEditIdx(idx); setEditDraft({ ...f }); }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="btn sm danger"
                      style={{ fontSize: '.72rem', padding: '1px 6px' }}
                      onClick={() => onSave(fields.filter((_, i) => i !== idx))}
                    >
                      &times;
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.3rem' }}>
        <input
          placeholder="Section (e.g. G. City Code)"
          value={section}
          onChange={(e) => setSection(e.target.value)}
          style={{ fontSize: '.76rem', padding: '3px 6px' }}
        />
        <select value={ftype} onChange={(e) => setFtype(e.target.value)} style={{ fontSize: '.76rem', padding: '3px 6px' }}>
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
          style={{ fontSize: '.76rem', padding: '3px 6px', gridColumn: '1 / -1' }}
        />
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.25rem', fontSize: '.76rem' }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={req} onChange={(e) => setReq(e.target.checked)} />
          Required
        </label>
        <button type="button" className="btn sm primary" style={{ fontSize: '.75rem', padding: '2px 8px' }} onClick={addField}>
          + Add Question
        </button>
      </div>
    </div>
  );
}

function PermitCategoryCard({ permitType, uses, onReload, showToast, expandSignal }) {
  const [expanded, setExpanded] = useState(false);
  const [editingCat, setEditingCat] = useState(false);
  const [catName, setCatName] = useState(permitType.name || '');
  const [catDesc, setCatDesc] = useState(permitType.description || '');
  const [catKind, setCatKind] = useState(permitType.kind || 'construction');
  const [catExp, setCatExp] = useState(permitType.expiration_rule || 'none');
  const [catReqFields, setCatReqFields] = useState(Array.isArray(permitType.required_fields) ? permitType.required_fields : []);

  const [editingUseId, setEditingUseId] = useState(null);
  const [useDraft, setUseDraft] = useState(null);

  const [newItemName, setNewItemName] = useState('');
  const [newItemFee, setNewItemFee] = useState('');
  const [newItemCoi, setNewItemCoi] = useState(true);
  const [newItemPlans, setNewItemPlans] = useState(false);
  const [newItemSurvey, setNewItemSurvey] = useState(false);

  useEffect(() => {
    if (expandSignal?.v !== undefined) {
      setExpanded(Boolean(expandSignal.open));
    }
  }, [expandSignal]);

  const startEditCat = () => {
    setCatName(permitType.name || '');
    setCatDesc(permitType.description || '');
    setCatKind(permitType.kind || 'construction');
    setCatExp(permitType.expiration_rule || 'none');
    setCatReqFields(Array.isArray(permitType.required_fields) ? permitType.required_fields : []);
    setExpanded(true);
    setEditingCat(true);
  };

  const saveCat = async (e) => {
    e.preventDefault();
    if (!catName.trim()) return;
    try {
      await api(`/api/permits/admin/types/${permitType.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: catName.trim(),
          description: catDesc.trim(),
          kind: catKind,
          expiration_rule: catExp,
          required_fields: catReqFields,
        }),
      });
      setEditingCat(false);
      await onReload();
      showToast(`Saved "${catName.trim()}"`, 'ok');
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  return (
    <div style={{ border: '1px solid #cbd5e1', borderRadius: 8, padding: '.75rem .85rem', marginBottom: '.65rem', background: '#fff' }}>
      <div className="between" style={{ gap: '.5rem', flexWrap: 'wrap', marginBottom: expanded ? '.65rem' : 0 }}>
        <div
          role="button"
          tabIndex={0}
          onClick={() => setExpanded(v => !v)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(v => !v); } }}
          style={{ cursor: 'pointer', flex: 1, minWidth: 240 }}
        >
          <span style={{ display: 'inline-block', width: '1.1rem', fontWeight: 700, color: '#475569' }}>
            {expanded ? '▾' : '▸'}
          </span>
          <strong style={{ fontSize: '1.02rem' }}>{permitType.name}</strong>
          <span className="badge draft" style={{ marginLeft: '.5rem' }}>
            {uses.length} {uses.length === 1 ? 'item' : 'items'}
          </span>
          <span className="badge" style={{ marginLeft: '.35rem' }}>
            {permitType.kind === 'annual_license' ? 'Annual License' : 'Zoning / Construction'}
          </span>
          {permitType.expiration_rule && permitType.expiration_rule !== 'none' && (
            <span className="badge" style={{ marginLeft: '.35rem' }}>
              {permitType.expiration_rule === 'calendar_year' ? 'Expires Dec 31' : 'Expires +365d'}
            </span>
          )}
          <span className="muted" style={{ marginLeft: '.5rem', fontSize: '.82rem' }}>
            {(permitType.required_fields || []).length} required · {(permitType.custom_fields || []).length} custom
          </span>
          {permitType.description && <div className="muted" style={{ fontSize: '.84rem', marginTop: 2, marginLeft: '1.1rem' }}>{permitType.description}</div>}
        </div>
        <div className="actions">
          <button type="button" className="btn sm" onClick={() => setExpanded(v => !v)}>
            {expanded ? 'Collapse' : 'Expand'}
          </button>
          <button type="button" className="btn sm" onClick={() => (editingCat ? setEditingCat(false) : startEditCat())}>
            {editingCat ? 'Close Editor' : 'Edit Category & Form'}
          </button>
          <button
            type="button"
            className="btn sm danger"
            onClick={async () => {
              if (!window.confirm(`Remove category "${permitType.name}" and its items?`)) return;
              try {
                await api(`/api/permits/admin/types/${permitType.id}`, { method: 'DELETE' });
                await onReload();
              } catch (err) {
                showToast(err.message, 'error');
              }
            }}
          >
            Remove Category
          </button>
        </div>
      </div>

      {expanded && editingCat && (
        <form onSubmit={saveCat} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '.75rem', marginBottom: '.75rem' }}>
          <div className="row" style={{ marginBottom: '.55rem' }}>
            <div className="field" style={{ flex: 2, minWidth: 180 }}>
              <label>Category Name</label>
              <input value={catName} onChange={(e) => setCatName(e.target.value)} required />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 160 }}>
              <label>Form Style</label>
              <select value={catKind} onChange={(e) => setCatKind(e.target.value)}>
                <option value="construction">Zoning / Construction</option>
                <option value="annual_license">Annual License / Permit</option>
              </select>
            </div>
            <div className="field" style={{ flex: 1, minWidth: 160 }}>
              <label>Auto-Expiration</label>
              <select value={catExp} onChange={(e) => setCatExp(e.target.value)}>
                <option value="none">No Auto-Expiration</option>
                <option value="calendar_year">Expires Dec 31</option>
                <option value="one_year">Expires +365 Days</option>
              </select>
            </div>
          </div>
          <div className="field" style={{ marginBottom: '.55rem' }}>
            <label>Description (optional)</label>
            <input value={catDesc} onChange={(e) => setCatDesc(e.target.value)} />
          </div>
          <div className="field" style={{ marginBottom: '.55rem' }}>
            <label>Required Standard Fields</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.35rem .8rem', padding: '.4rem .55rem', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 4 }}>
              {PERMIT_FIELD_OPTIONS.map(([fk, fl]) => {
                const checked = catReqFields.includes(fk);
                return (
                  <label key={fk} style={{ display: 'inline-flex', alignItems: 'center', gap: '.25rem', fontSize: '.8rem', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      style={{ width: 'auto' }}
                      checked={checked}
                      onChange={() => setCatReqFields(prev => (checked ? prev.filter(x => x !== fk) : [...prev, fk]))}
                    />
                    <span>{fl}</span>
                  </label>
                );
              })}
            </div>
          </div>
          <div className="actions" style={{ marginBottom: '.4rem' }}>
            <button type="submit" className="btn sm primary">Save Category Settings</button>
            <button type="button" className="btn sm" onClick={() => setEditingCat(false)}>Cancel</button>
          </div>

          <CustomFieldsEditor
            permitType={permitType}
            onSave={async (next) => {
              await api(`/api/permits/admin/types/${permitType.id}`, {
                method: 'PATCH',
                body: JSON.stringify({ custom_fields: next }),
              });
              await onReload();
            }}
          />
        </form>
      )}

      {expanded && (
        <>
          <table>
        <thead>
          <tr><th>Permit Item / Use</th><th>Fee</th><th>Required Attachments</th><th style={{ width: 150 }}>Actions</th></tr>
        </thead>
        <tbody>
          {uses.length === 0 ? (
            <tr><td colSpan={4} className="muted">No permit items in this category yet. Add one below.</td></tr>
          ) : uses.map((u) => {
            const isEditingUse = editingUseId === u.id && useDraft;
            if (isEditingUse) {
              return (
                <tr key={`u-${u.id}`} style={{ background: '#f8fafc' }}>
                  <td>
                    <input
                      aria-label="Item name"
                      value={useDraft.name}
                      onChange={(e) => setUseDraft(d => ({ ...d, name: e.target.value }))}
                      style={{ fontSize: '.85rem', padding: '3px 6px' }}
                    />
                  </td>
                  <td>
                    <input
                      aria-label="Fee"
                      placeholder="$75"
                      value={useDraft.fee_amount}
                      onChange={(e) => setUseDraft(d => ({ ...d, fee_amount: e.target.value }))}
                      style={{ fontSize: '.85rem', padding: '3px 6px', width: 95 }}
                    />
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', fontSize: '.82rem' }}>
                      {[
                        ['requires_coi', 'COI'],
                        ['requires_plans', 'Plans'],
                        ['requires_survey', 'Survey'],
                      ].map(([prop, lbl]) => (
                        <label key={prop} style={{ display: 'inline-flex', alignItems: 'center', gap: '.25rem', cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            style={{ width: 'auto' }}
                            checked={Boolean(useDraft[prop])}
                            onChange={(e) => setUseDraft(d => ({ ...d, [prop]: e.target.checked }))}
                          />
                          {lbl}
                        </label>
                      ))}
                    </div>
                  </td>
                  <td>
                    <div className="actions">
                      <button
                        type="button"
                        className="btn sm primary"
                        onClick={async () => {
                          if (!useDraft.name.trim()) return;
                          try {
                            await api(`/api/permits/admin/uses/${u.id}`, {
                              method: 'PATCH',
                              body: JSON.stringify({
                                name: useDraft.name.trim(),
                                fee_amount: useDraft.fee_amount.trim(),
                                requires_coi: Boolean(useDraft.requires_coi),
                                requires_plans: Boolean(useDraft.requires_plans),
                                requires_survey: Boolean(useDraft.requires_survey),
                              }),
                            });
                            setEditingUseId(null);
                            setUseDraft(null);
                            await onReload();
                            showToast('Permit item updated', 'ok');
                          } catch (err) {
                            showToast(err.message, 'error');
                          }
                        }}
                      >
                        Save
                      </button>
                      <button type="button" className="btn sm" onClick={() => { setEditingUseId(null); setUseDraft(null); }}>
                        Cancel
                      </button>
                    </div>
                  </td>
                </tr>
              );
            }
            return (
              <tr key={`u-${u.id}`}>
                <td>{u.name}</td>
                <td>{u.fee_amount || '—'}</td>
                <td className="muted">
                  {[u.requires_coi && 'COI', u.requires_plans && 'Plans', u.requires_survey && 'Survey'].filter(Boolean).join(', ') || 'None'}
                </td>
                <td>
                  <div className="actions">
                    <button
                      type="button"
                      className="btn sm"
                      onClick={() => {
                        setEditingUseId(u.id);
                        setUseDraft({
                          name: u.name || '',
                          fee_amount: u.fee_amount || '',
                          requires_coi: Boolean(u.requires_coi),
                          requires_plans: Boolean(u.requires_plans),
                          requires_survey: Boolean(u.requires_survey),
                        });
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="btn sm danger"
                      onClick={async () => {
                        await api(`/api/permits/admin/uses/${u.id}`, { method: 'DELETE' });
                        await onReload();
                      }}
                    >
                      Remove
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <form
        className="row"
        style={{ marginTop: '.6rem', paddingTop: '.55rem', borderTop: '1px dashed #e2e8f0', alignItems: 'center', gap: '.5rem' }}
        onSubmit={async (e) => {
          e.preventDefault();
          if (!newItemName.trim()) return;
          try {
            await api('/api/permits/admin/uses', {
              method: 'POST',
              body: JSON.stringify({
                permit_type_id: permitType.id,
                name: newItemName.trim(),
                fee_amount: newItemFee.trim(),
                requires_coi: newItemCoi,
                requires_plans: newItemPlans,
                requires_survey: newItemSurvey,
                sort_order: uses.length + 1,
              }),
            });
            setNewItemName('');
            setNewItemFee('');
            await onReload();
          } catch (err) {
            showToast(err.message, 'error');
          }
        }}
      >
        <input
          placeholder={`+ Add item under ${permitType.name}...`}
          value={newItemName}
          onChange={(e) => setNewItemName(e.target.value)}
          style={{ flex: 2, minWidth: 180, fontSize: '.84rem', padding: '4px 8px' }}
        />
        <input
          placeholder="Fee (e.g. $75)"
          value={newItemFee}
          onChange={(e) => setNewItemFee(e.target.value)}
          style={{ width: 105, fontSize: '.84rem', padding: '4px 8px' }}
        />
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.25rem', fontSize: '.8rem', cursor: 'pointer' }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={newItemCoi} onChange={(e) => setNewItemCoi(e.target.checked)} />
          COI
        </label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.25rem', fontSize: '.8rem', cursor: 'pointer' }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={newItemPlans} onChange={(e) => setNewItemPlans(e.target.checked)} />
          Plans
        </label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.25rem', fontSize: '.8rem', cursor: 'pointer' }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={newItemSurvey} onChange={(e) => setNewItemSurvey(e.target.checked)} />
          Survey
        </label>
        <button type="submit" className="btn sm primary">Add Item</button>
      </form>
        </>
      )}
    </div>
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
  const [expandSignal, setExpandSignal] = useState(null);
  const [msg, setMsg] = useState({ text: '', isError: false });
  const showToast = useToast();

  const loadCatalog = useCallback(async () => {
    const data = await api('/api/permits/admin/catalog');
    if (data.settings) setSettings(data.settings);
    const tList = Array.isArray(data.types) ? data.types : [];
    setTypes(tList);
    setUses(Array.isArray(data.uses) ? data.uses : []);
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
        <div className="between" style={{ marginBottom: '.35rem' }}>
          <h2 style={{ margin: 0 }}>Permit Categories &amp; Items</h2>
          <div className="actions">
            <button type="button" className="btn sm" onClick={() => setExpandSignal({ open: true, v: Date.now() })}>
              Expand All
            </button>
            <button type="button" className="btn sm" onClick={() => setExpandSignal({ open: false, v: Date.now() })}>
              Collapse All
            </button>
          </div>
        </div>
        <p className="muted" style={{ marginTop: 0, marginBottom: '.85rem', fontSize: '.88rem' }}>
          Each <strong>Permit Category</strong> (e.g., Building Permit, Variance Application) defines the form fields and renewal rules.
          Inside each category, add specific <strong>Permit Items</strong> (e.g., Deck, New Home) with their fee and required attachments (COI, Plans, Survey).
        </p>

        <form
          className="row"
          style={{ marginBottom: '1.1rem', alignItems: 'flex-end', paddingBottom: '.9rem', borderBottom: '1px solid #e2e8f0' }}
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
            <label>New Permit Category</label>
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
          <button type="submit" className="btn sm primary">+ Add Category</button>
        </form>

        {types.map((t) => (
          <PermitCategoryCard
            key={t.id}
            permitType={t}
            uses={uses.filter(u => u.permit_type_id === t.id)}
            onReload={loadCatalog}
            showToast={showToast}
            expandSignal={expandSignal}
          />
        ))}
      </div>

      <ModuleNotificationsCard
        moduleId="permits"
        title="Permit Email Notifications"
        events={PERMIT_NOTIFICATION_EVENTS}
      />
    </section>
  );
}
