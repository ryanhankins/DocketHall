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

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, formatSize } from '../../core/api.js';
import { useToast } from '../../core/toast.jsx';
import CustomFieldsRenderer from './CustomFieldsRenderer.jsx';

export default function PermitApplyPage({ initialTypeId = null, initialUseId = null, onNavigate }) {
  const [catalog, setCatalog] = useState({ settings: {}, types: [], uses: [] });
  const [typeId, setTypeId] = useState('');
  const [useId, setUseId] = useState('');
  const [applicantName, setApplicantName] = useState('');
  const [applicantEmail, setApplicantEmail] = useState('');
  const [applicantPhone, setApplicantPhone] = useState('');
  const [propertyAddress, setPropertyAddress] = useState('');
  const [buildingName, setBuildingName] = useState('');
  const [suiteName, setSuiteName] = useState('');
  const [parcelId, setParcelId] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [contractorName, setContractorName] = useState('');
  const [contractorLicense, setContractorLicense] = useState('');
  const [contractorCheck, setContractorCheck] = useState(null);
  const [projectDesc, setProjectDesc] = useState('');
  const [estValue, setEstValue] = useState('');
  const [projectName, setProjectName] = useState('');
  const [customData, setCustomData] = useState({});
  const [prerequisitePermitId, setPrerequisitePermitId] = useState('');
  const [linkCandidates, setLinkCandidates] = useState([]);
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  const [docCategory, setDocCategory] = useState('Certificate of Insurance');
  const [queuedDocs, setQueuedDocs] = useState([]); // { file, category }
  const [dropActive, setDropActive] = useState(false);
  const [parcelSearch, setParcelSearch] = useState('');
  const [parcelResults, setParcelResults] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef(null);
  const showToast = useToast();

  useEffect(() => {
    api('/api/permits/catalog')
      .then((data) => {
        setCatalog(data);
        const types = data.types || [];
        const uses = data.uses || [];
        const chosenType = (initialTypeId && types.find(t => t.id === initialTypeId)) || types[0];
        if (chosenType) {
          setTypeId(String(chosenType.id));
          const typeUses = uses.filter(u => u.permit_type_id === chosenType.id);
          const chosenUse = (initialUseId && typeUses.find(u => u.id === initialUseId)) || typeUses[0];
          if (chosenUse) setUseId(String(chosenUse.id));
        }
      })
      .catch(e => showToast(e.message, 'error'));
    api('/api/permits/link-candidates')
      .then((rows) => setLinkCandidates(Array.isArray(rows) ? rows : []))
      .catch(() => {});
    try {
      const raw = sessionStorage.getItem('civicdesk_permit_prefill');
      if (raw) {
        sessionStorage.removeItem('civicdesk_permit_prefill');
        const pf = JSON.parse(raw);
        if (pf.project_name) setProjectName(pf.project_name);
        if (pf.property_address) setPropertyAddress(pf.property_address);
        if (pf.parcel_id) setParcelId(pf.parcel_id);
        if (pf.owner_name) setOwnerName(pf.owner_name);
        if (pf.applicant_name) setApplicantName(pf.applicant_name);
        if (pf.applicant_email) setApplicantEmail(pf.applicant_email);
        if (pf.applicant_phone) setApplicantPhone(pf.applicant_phone);
        if (pf.prerequisite_permit_id) setPrerequisitePermitId(String(pf.prerequisite_permit_id));
      }
    } catch {}
  }, [initialTypeId, initialUseId, showToast]);

  const selectedType = useMemo(
    () => (catalog.types || []).find(t => String(t.id) === String(typeId)) || null,
    [catalog.types, typeId],
  );
  const isAnnualLicense = selectedType?.kind === 'annual_license';
  const reqFields = useMemo(
    () => new Set(selectedType?.required_fields || (isAnnualLicense ? [] : ['property_address'])),
    [selectedType, isAnnualLicense],
  );
  const isReq = (f) => reqFields.has(f);

  const availableUses = useMemo(
    () => (catalog.uses || []).filter(u => String(u.permit_type_id) === String(typeId)),
    [catalog.uses, typeId],
  );

  const selectedUse = useMemo(
    () => availableUses.find(u => String(u.id) === String(useId)) || null,
    [availableUses, useId],
  );

  const addFiles = (files) => {
    const list = Array.from(files || []);
    if (!list.length) return;
    setQueuedDocs(prev => [...prev, ...list.map(file => ({ file, category: docCategory }))]);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErr('');
    setSubmitting(true);
    try {
      const created = await api('/api/permits', {
        method: 'POST',
        body: JSON.stringify({
          permit_type_id: Number(typeId),
          permit_use_id: Number(useId),
          applicant_name: applicantName.trim(),
          applicant_email: applicantEmail.trim(),
          applicant_phone: applicantPhone.trim(),
          property_address: propertyAddress.trim(),
          building_name: buildingName.trim(),
          suite_name: suiteName.trim(),
          parcel_id: parcelId.trim(),
          owner_name: ownerName.trim(),
          contractor_name: contractorName.trim(),
          contractor_license: contractorLicense.trim(),
          project_description: projectDesc.trim(),
          estimated_value: estValue.trim(),
          project_name: projectName.trim(),
          custom_data: customData,
          prerequisite_permit_id: prerequisitePermitId ? Number(prerequisitePermitId) : null,
          accepted_terms: acceptedTerms,
        }),
      });
      for (const item of queuedDocs) {
        const fd = new FormData();
        fd.append('file', item.file);
        fd.append('doc_category', item.category);
        await api(`/api/permits/${created.id}/documents`, { method: 'POST', body: fd });
      }
      showToast(`Permit ${created.permit_number} submitted`, 'ok');
      onNavigate('#my-permits');
    } catch (error) {
      setErr(error.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section id="section-permits-apply">
      <div className="between" style={{ marginBottom: '1rem' }}>
        <h1 style={{ margin: 0 }}>Apply for a Permit</h1>
        <a href="/portal" target="_blank" rel="noreferrer" className="btn sm">View Public Permits Portal</a>
      </div>

      {catalog.settings?.required_documents_note && (
        <div className="card" style={{ background: '#f8fafc' }}>
          <h2 style={{ marginBottom: '.45rem' }}>Required Documents &amp; Instructions</h2>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: '.9rem', color: '#334e68' }}>
            {catalog.settings.required_documents_note}
          </pre>
        </div>
      )}

      <div className="card">
        <form onSubmit={handleSubmit}>
          <div className="row" style={{ marginBottom: '.85rem' }}>
            <div className="field" style={{ flex: 1, minWidth: '220px' }}>
              <label htmlFor="permit-type-sel">Permit Type</label>
              <select
                id="permit-type-sel"
                required
                value={typeId}
                onChange={(e) => {
                  const nextType = e.target.value;
                  setTypeId(nextType);
                  const firstUse = (catalog.uses || []).find(u => String(u.permit_type_id) === nextType);
                  setUseId(firstUse ? String(firstUse.id) : '');
                }}
              >
                {(catalog.types || []).map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            <div className="field" style={{ flex: 2, minWidth: '260px' }}>
              <label htmlFor="permit-use-sel">Permit Application / Use</label>
              <select id="permit-use-sel" required value={useId} onChange={(e) => setUseId(e.target.value)}>
                {availableUses.map(u => (
                  <option key={u.id} value={u.id}>{u.name}{u.fee_amount ? ` (${u.fee_amount})` : ''}</option>
                ))}
              </select>
            </div>
          </div>

          {selectedUse && (selectedUse.requires_coi || selectedUse.requires_plans || selectedUse.requires_survey) && (
            <div className="muted" style={{ fontSize: '.86rem', marginBottom: '.85rem' }}>
              <strong>Checklist for this permit:</strong>{' '}
              {[
                selectedUse.requires_coi && 'Certificate of Insurance',
                selectedUse.requires_plans && 'Design Plans',
                selectedUse.requires_survey && 'Land Survey / Photos',
              ].filter(Boolean).join(' · ')}
            </div>
          )}

          {!isAnnualLicense && (
            <div className="row" style={{ marginBottom: '.75rem', alignItems: 'flex-end' }}>
              <div className="field" style={{ flex: 2, minWidth: '220px' }}>
                <label htmlFor="perm-parcel-lookup">Parcel Lookup (optional — search saved parcels)</label>
                <input
                  id="perm-parcel-lookup"
                  type="search"
                  placeholder="Search by Parcel ID, Address, or Owner..."
                  value={parcelSearch}
                  onChange={async (e) => {
                    const q = e.target.value;
                    setParcelSearch(q);
                    if (q.trim().length >= 2) {
                      const list = await api(`/api/permits/parcels?q=${encodeURIComponent(q)}`).catch(() => []);
                      setParcelResults(Array.isArray(list) ? list : []);
                    } else {
                      setParcelResults([]);
                    }
                  }}
                />
              </div>
              {parcelResults.length > 0 && (
                <div className="field" style={{ flex: 2, minWidth: '240px' }}>
                  <label>Select Matching Parcel</label>
                  <select
                    defaultValue=""
                    onChange={(e) => {
                      const pr = parcelResults.find(x => String(x.id) === e.target.value);
                      if (pr) {
                        if (pr.address) setPropertyAddress(pr.address);
                        if (pr.building_name) setBuildingName(pr.building_name);
                        if (pr.suite_name) setSuiteName(pr.suite_name);
                        if (pr.parcel_id) setParcelId(pr.parcel_id);
                        if (pr.owner_name) setOwnerName(pr.owner_name);
                        setParcelResults([]);
                      }
                    }}
                  >
                    <option value="">Choose parcel to auto-fill…</option>
                    {parcelResults.map(pr => (
                      <option key={pr.id} value={pr.id}>
                        {pr.parcel_id} — {pr.address || pr.owner_name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

          <div className="row" style={{ marginBottom: '.75rem' }}>
            <div className="field" style={{ flex: 2, minWidth: '220px' }}>
              <label htmlFor="perm-app-name">Applicant Full Name *</label>
              <input id="perm-app-name" required value={applicantName} onChange={(e) => setApplicantName(e.target.value)} />
            </div>
            <div className="field" style={{ flex: 1, minWidth: '180px' }}>
              <label htmlFor="perm-app-email">Email{isReq('applicant_email') ? ' *' : ''}</label>
              <input id="perm-app-email" type="email" required={isReq('applicant_email')} value={applicantEmail} onChange={(e) => setApplicantEmail(e.target.value)} />
            </div>
            <div className="field" style={{ flex: 1, minWidth: '160px' }}>
              <label htmlFor="perm-app-phone">Phone{isReq('applicant_phone') ? ' *' : ''}</label>
              <input id="perm-app-phone" required={isReq('applicant_phone')} value={applicantPhone} onChange={(e) => setApplicantPhone(e.target.value)} />
            </div>
          </div>

          <div className="row" style={{ marginBottom: '.75rem' }}>
            <div className="field" style={{ flex: 2, minWidth: '240px' }}>
              <label htmlFor="perm-prop-addr">
                {isAnnualLicense ? 'Location / Rack / Resident Address' : 'Land Address'}{isReq('property_address') ? ' *' : ' (optional)'}
              </label>
              <input
                id="perm-prop-addr"
                required={isReq('property_address')}
                placeholder={isAnnualLicense ? 'e.g. Park Rack #4 or 101 Main St' : 'e.g. 101 Main St'}
                value={propertyAddress}
                onChange={(e) => setPropertyAddress(e.target.value)}
              />
            </div>
            <div className="field" style={{ flex: 1, minWidth: '150px' }}>
              <label htmlFor="perm-bldg">{isAnnualLicense ? 'Beach / Zone' : 'Building Name'}{isReq('building_name') ? ' *' : ''}</label>
              <input id="perm-bldg" required={isReq('building_name')} value={buildingName} onChange={(e) => setBuildingName(e.target.value)} />
            </div>
            <div className="field" style={{ flex: 1, minWidth: '120px' }}>
              <label htmlFor="perm-suite">{isAnnualLicense ? 'Rack / Slot / Tag #' : 'Suite / Unit ID'}{isReq('suite_name') ? ' *' : ''}</label>
              <input id="perm-suite" required={isReq('suite_name')} value={suiteName} onChange={(e) => setSuiteName(e.target.value)} />
            </div>
          </div>

          {(!isAnnualLicense || isReq('parcel_id') || isReq('owner_name') || isReq('estimated_value') || isReq('contractor_name') || isReq('contractor_license')) && (
            <>
              <div className="row" style={{ marginBottom: '.75rem' }}>
                <div className="field" style={{ flex: 1, minWidth: '160px' }}>
                  <label htmlFor="perm-parcel">Parcel Number{isReq('parcel_id') ? ' *' : ''}</label>
                  <input id="perm-parcel" required={isReq('parcel_id')} value={parcelId} onChange={(e) => setParcelId(e.target.value)} />
                </div>
                <div className="field" style={{ flex: 1, minWidth: '180px' }}>
                  <label htmlFor="perm-owner">Owner Name{isReq('owner_name') ? ' *' : ''}</label>
                  <input id="perm-owner" required={isReq('owner_name')} value={ownerName} onChange={(e) => setOwnerName(e.target.value)} />
                </div>
                <div className="field" style={{ flex: 1, minWidth: '150px' }}>
                  <label htmlFor="perm-value">Estimated Project Value{isReq('estimated_value') ? ' *' : ''}</label>
                  <input id="perm-value" required={isReq('estimated_value')} placeholder="e.g. $15,000" value={estValue} onChange={(e) => setEstValue(e.target.value)} />
                </div>
              </div>

              <div className="row" style={{ marginBottom: '.75rem' }}>
                <div className="field" style={{ flex: 1, minWidth: '200px' }}>
                  <label htmlFor="perm-contractor">Contractor Name{isReq('contractor_name') ? ' *' : ' (if applicable)'}</label>
                  <input id="perm-contractor" required={isReq('contractor_name')} value={contractorName} onChange={(e) => setContractorName(e.target.value)} />
                </div>
                <div className="field" style={{ flex: 1, minWidth: '180px' }}>
                  <label htmlFor="perm-license">Contractor State License #{isReq('contractor_license') ? ' *' : ''}</label>
                  <input
                    id="perm-license"
                    required={isReq('contractor_license')}
                    placeholder="e.g. MN-GC-40821"
                    value={contractorLicense}
                    onChange={(e) => {
                      setContractorLicense(e.target.value);
                      if (!e.target.value.trim()) setContractorCheck(null);
                    }}
                    onBlur={async () => {
                      const lic = contractorLicense.trim();
                      if (!lic) { setContractorCheck(null); return; }
                      try {
                        const res = await api(`/api/permits/contractors/check?license=${encodeURIComponent(lic)}`);
                        setContractorCheck(res);
                        if (res?.matched && res.contractor?.business_name && !contractorName.trim()) {
                          setContractorName(res.contractor.business_name);
                        }
                      } catch {
                        setContractorCheck(null);
                      }
                    }}
                  />
                  {contractorCheck?.matched && contractorCheck.compliant && (
                    <div style={{ fontSize: '.8rem', color: '#15803d', marginTop: 4 }}>
                      Verified Active: {contractorCheck.contractor?.business_name} (COI Exp: {contractorCheck.contractor?.insurance_expires_at || 'On file'})
                    </div>
                  )}
                  {contractorCheck?.matched && !contractorCheck.compliant && (
                    <div style={{ fontSize: '.8rem', color: '#b91c1c', marginTop: 4, fontWeight: 600 }}>
                      Compliance Gate Blocked: {contractorCheck.issues.join('; ')}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          <div className="row" style={{ marginBottom: '.85rem' }}>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="perm-project-name">Project Name (optional, groups related permits)</label>
              <input
                id="perm-project-name"
                placeholder="e.g. 2026 Smith Lakeside Garage & Variance"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
              />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="perm-prereq">Prerequisite / Enabling Permit (optional)</label>
              <select
                id="perm-prereq"
                value={prerequisitePermitId}
                onChange={(e) => setPrerequisitePermitId(e.target.value)}
              >
                <option value="">None (standalone permit)</option>
                {linkCandidates.map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.permit_number} — {c.permit_type_name} ({c.status}){c.project_name ? ` [${c.project_name}]` : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="field" style={{ marginBottom: '.85rem' }}>
            <label htmlFor="perm-desc">
              {isAnnualLicense ? 'Vessel / Item Details (make, color, length, notes)' : 'Project Description / Scope of Work'}{isReq('project_description') ? ' *' : ''}
            </label>
            <textarea
              id="perm-desc"
              rows={3}
              required={isReq('project_description')}
              placeholder={isAnnualLicense ? 'e.g. 12ft blue kayak, registration or description...' : 'Describe the proposed work, dimensions, setbacks, etc.'}
              value={projectDesc}
              onChange={(e) => setProjectDesc(e.target.value)}
            />
          </div>

          {(selectedType?.custom_fields || []).length > 0 && (
            <div style={{ marginBottom: '1rem' }}>
              <CustomFieldsRenderer
                fields={selectedType.custom_fields}
                value={customData}
                onChange={setCustomData}
              />
            </div>
          )}

          <div className="field" style={{ marginBottom: '.9rem' }}>
            <label>Upload Supporting Documents (COI, Design Plans, Survey)</label>
            <div className="row" style={{ marginBottom: '.4rem', alignItems: 'center' }}>
              <select value={docCategory} onChange={(e) => setDocCategory(e.target.value)} style={{ width: 'auto' }}>
                <option value="Certificate of Insurance">Certificate of Insurance</option>
                <option value="Design Plans">Design Plans</option>
                <option value="Land Survey / Photos">Land Survey / Photos</option>
                <option value="Other">Other</option>
              </select>
              <button type="button" className="btn sm" onClick={() => fileRef.current?.click()}>Select Files</button>
              <input
                ref={fileRef}
                type="file"
                multiple
                hidden
                onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
              />
            </div>
            <div
              className={`drop-zone${dropActive ? ' file-drag-over' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDropActive(true); }}
              onDragLeave={() => setDropActive(false)}
              onDrop={(e) => { e.preventDefault(); setDropActive(false); addFiles(e.dataTransfer?.files); }}
            >
              Drag &amp; drop supporting documents here (tagged as &ldquo;{docCategory}&rdquo;)
            </div>
            {queuedDocs.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.4rem', marginTop: '.45rem' }}>
                {queuedDocs.map((q, idx) => (
                  <span key={`${q.file.name}-${idx}`} className="badge draft" style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem' }}>
                    <span>[{q.category}] {q.file.name} ({formatSize(q.file.size)})</span>
                    <button
                      type="button"
                      style={{ border: 0, background: 'transparent', cursor: 'pointer', fontWeight: 700, padding: 0, lineHeight: 1 }}
                      onClick={() => setQueuedDocs(prev => prev.filter((_, i) => i !== idx))}
                    >
                      &times;
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginBottom: '1rem', cursor: 'pointer' }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={acceptedTerms} onChange={(e) => setAcceptedTerms(e.target.checked)} />
            <span>I certify that the information and documents provided are accurate and that all contractors hold valid licenses.</span>
          </label>

          <button type="submit" className="btn primary" disabled={submitting}>
            {submitting ? 'Submitting…' : 'Submit Permit Application'}
          </button>
          {err && <div className="error-msg" role="alert">{err}</div>}
        </form>
      </div>
    </section>
  );
}
