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

import { useState } from 'react';
import { api } from '../../core/api.js';
import { useToast } from '../../core/toast.jsx';
import { ORDINANCE_PRESETS } from './constants.jsx';

export default function ComplaintsFilePage({ me, onNavigate }) {
  const toast = useToast();

  const [isAnonymous, setIsAnonymous] = useState(false);
  const [isRealProperty, setIsRealProperty] = useState(true);
  const [complainantName, setComplainantName] = useState('');
  const [complainantEmail, setComplainantEmail] = useState(me?.email || '');
  const [complainantPhone, setComplainantPhone] = useState('');
  const [complainantAddress, setComplainantAddress] = useState('');

  const [subjectProperty, setSubjectProperty] = useState('');
  const [subjectPerson, setSubjectPerson] = useState('');
  const [ordinance, setOrdinance] = useState('');
  const [dateObserved, setDateObserved] = useState('');
  const [conduct, setConduct] = useState('');
  const [files, setFiles] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [submittedRec, setSubmittedRec] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!conduct.trim()) {
      toast.error('Please describe the conduct being complained about.');
      return;
    }
    setSubmitting(true);
    try {
      const created = await api('/api/complaints', {
        method: 'POST',
        body: JSON.stringify({
          intake_channel: isAnonymous ? 'anonymous' : 'written',
          is_anonymous: isAnonymous,
          is_real_property_complaint: isRealProperty,
          complainant_name: isAnonymous ? '' : complainantName,
          complainant_email: isAnonymous ? '' : complainantEmail,
          complainant_phone: isAnonymous ? '' : complainantPhone,
          complainant_address: isAnonymous ? '' : complainantAddress,
          subject_property_address: subjectProperty,
          subject_person_name: subjectPerson,
          ordinance_section: ordinance,
          date_observed: dateObserved,
          conduct_description: conduct,
        }),
      });

      for (const f of files) {
        const fd = new FormData();
        fd.append('file', f);
        fd.append('doc_category', 'evidence');
        fd.append('title', f.name);
        await api(`/api/complaints/${created.id}/documents`, {
          method: 'POST',
          body: fd,
        });
      }

      setSubmittedRec(created);
      toast.success(`Complaint ${created.complaint_number} submitted`);
      setConduct('');
      setSubjectProperty('');
      setSubjectPerson('');
      setDateObserved('');
      setFiles([]);
    } catch (err) {
      toast.error(err.message || 'Failed to submit complaint');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 1040 }}>
      <div>
        <h2 style={{ margin: 0 }}>File an Administrative Complaint (Section 618)</h2>
        <p className="muted" style={{ margin: '4px 0 0' }}>
          There is <strong>no cost or fee</strong> to file a complaint. Pursuant to City Code Section 618.020
          and Minnesota Statutes § 13.44, your name and contact details are kept{' '}
          <strong>confidential</strong> and are never published in the Complaint Log Book.
        </p>
      </div>

      {submittedRec && (
        <div
          className="card"
          style={{ background: '#f0fdf4', border: '1px solid #86efac', display: 'grid', gap: 8 }}
        >
          <div>
            <strong>Complaint Filed:</strong> {submittedRec.complaint_number}
          </div>
          <div className="muted" style={{ fontSize: 14 }}>
            Your complaint has been logged for staff review under Section 618.030.
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {!submittedRec.is_anonymous && (
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={() => onNavigate('my-complaints')}
              >
                Track in My Complaints
              </button>
            )}
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => onNavigate('complaints-log')}
            >
              View Public Complaint Log Book
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setSubmittedRec(null)}
            >
              File Another Complaint
            </button>
          </div>
        </div>
      )}

      <form className="card" onSubmit={handleSubmit} style={{ display: 'grid', gap: 14 }}>
        <div
          style={{
            background: '#eff6ff',
            border: '1px solid #bfdbfe',
            borderRadius: 8,
            padding: 12,
            display: 'grid',
            gap: 8,
          }}
        >
          <strong>Complainant Privacy &amp; Contact (Confidential)</strong>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={isAnonymous}
              onChange={(e) => setIsAnonymous(e.target.checked)}
            />
            <span>
              File anonymously (accepted at staff discretion per Section 618.020; no personal contact stored)
            </span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={isRealProperty}
              onChange={(e) => setIsRealProperty(e.target.checked)}
            />
            <span>
              Complaint involves the use of real property (protected under MN Stat. § 13.44)
            </span>
          </label>

          {!isAnonymous && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
                gap: 10,
                marginTop: 4,
              }}
            >
              <label>
                <div className="muted" style={{ fontSize: 12 }}>Your Name (Private)</div>
                <input
                  className="input"
                  value={complainantName}
                  onChange={(e) => setComplainantName(e.target.value)}
                  placeholder="Full name (kept confidential)"
                />
              </label>
              <label>
                <div className="muted" style={{ fontSize: 12 }}>Email (Private)</div>
                <input
                  type="email"
                  className="input"
                  value={complainantEmail}
                  onChange={(e) => setComplainantEmail(e.target.value)}
                  placeholder="For staff / Council notice"
                />
              </label>
              <label>
                <div className="muted" style={{ fontSize: 12 }}>Phone (Private)</div>
                <input
                  className="input"
                  value={complainantPhone}
                  onChange={(e) => setComplainantPhone(e.target.value)}
                  placeholder="(651) 555-0100"
                />
              </label>
              <label>
                <div className="muted" style={{ fontSize: 12 }}>Your Address (Private)</div>
                <input
                  className="input"
                  value={complainantAddress}
                  onChange={(e) => setComplainantAddress(e.target.value)}
                  placeholder="Street address"
                />
              </label>
            </div>
          )}
        </div>

        <h3 style={{ margin: '4px 0 0' }}>Complaint Details (Section 618.020)</h3>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 12,
          }}
        >
          <label>
            <div className="muted" style={{ fontSize: 12 }}>Property / Location Involved</div>
            <input
              className="input"
              value={subjectProperty}
              onChange={(e) => setSubjectProperty(e.target.value)}
              placeholder="e.g. 123 Birchwood Ave"
            />
          </label>
          <label>
            <div className="muted" style={{ fontSize: 12 }}>Person(s) Involved (if known)</div>
            <input
              className="input"
              value={subjectPerson}
              onChange={(e) => setSubjectPerson(e.target.value)}
              placeholder="Optional"
            />
          </label>
          <label>
            <div className="muted" style={{ fontSize: 12 }}>Ordinance Provision (if known)</div>
            <input
              className="input"
              list="ordinance-presets"
              value={ordinance}
              onChange={(e) => setOrdinance(e.target.value)}
              placeholder="Select or enter code section"
            />
            <datalist id="ordinance-presets">
              {ORDINANCE_PRESETS.map((opt) => (
                <option key={opt} value={opt} />
              ))}
            </datalist>
          </label>
          <label>
            <div className="muted" style={{ fontSize: 12 }}>Date Observed</div>
            <input
              type="date"
              className="input"
              value={dateObserved}
              onChange={(e) => setDateObserved(e.target.value)}
            />
          </label>
        </div>

        <label style={{ display: 'block', width: '100%' }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Specific Conduct Complained About *</div>
          <textarea
            className="input"
            rows={8}
            required
            style={{ width: '100%', minHeight: 180, boxSizing: 'border-box', resize: 'vertical' }}
            value={conduct}
            onChange={(e) => setConduct(e.target.value)}
            placeholder="Describe the conduct, location, and any prior personal contact attempts (Section 618.010 / 618.020)..."
          />
        </label>

        <label>
          <div className="muted" style={{ fontSize: 12 }}>Supporting Photos or Documents (optional)</div>
          <input
            type="file"
            multiple
            onChange={(e) => setFiles(Array.from(e.target.files || []))}
          />
          {files.length > 0 && (
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              {files.length} file(s) selected
            </div>
          )}
        </label>

        <div style={{ display: 'flex', gap: 8 }}>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Submitting...' : 'Submit Complaint (No Fee)'}
          </button>
        </div>
      </form>
    </div>
  );
}
