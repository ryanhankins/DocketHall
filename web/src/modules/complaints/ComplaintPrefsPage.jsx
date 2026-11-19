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

import React, { useEffect, useState } from 'react';
import { api } from '../../core/api.js';
import ModuleNotificationsCard from '../../core/ModuleNotificationsCard.jsx';
import { useToast } from '../../core/toast.jsx';
import { ORDINANCE_PRESETS } from './constants.jsx';

const COMPLAINT_NOTIFICATION_EVENTS = [
  {
    key: 'complaints_submitted',
    label: 'New Complaint Filed',
    description: 'Sent when a resident or staff member submits a new complaint.',
  },
  {
    key: 'complaints_escalated',
    label: 'Notice of Violation Issued',
    description: 'Sent when staff issues a Notice of Violation for a complaint.',
  },
];

export default function ComplaintPrefsPage() {
  const [codeCitation, setCodeCitation] = useState('');
  const [privacyStatute, setPrivacyStatute] = useState('');
  const [maxComplianceDays, setMaxComplianceDays] = useState(60);
  const [presetsText, setPresetsText] = useState(ORDINANCE_PRESETS.join('\n'));
  const [saving, setSaving] = useState(false);
  const showToast = useToast();

  useEffect(() => {
    api('/api/complaints/settings')
      .then((s) => {
        if (!s) return;
        setCodeCitation(s.code_citation || '');
        setPrivacyStatute(s.privacy_statute || '');
        setMaxComplianceDays(s.max_compliance_days ?? 60);
        if (Array.isArray(s.ordinance_presets) && s.ordinance_presets.length) {
          setPresetsText(s.ordinance_presets.join('\n'));
        }
      })
      .catch(() => {});
  }, []);

  const handleSaveSettings = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const presets = presetsText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      const saved = await api('/api/complaints/settings', {
        method: 'PUT',
        body: JSON.stringify({
          code_citation: codeCitation.trim(),
          privacy_statute: privacyStatute.trim(),
          max_compliance_days: Number(maxComplianceDays) || 0,
          ordinance_presets: presets.length ? presets : ORDINANCE_PRESETS,
        }),
      });
      setPresetsText((saved.ordinance_presets || ORDINANCE_PRESETS).join('\n'));
      showToast('Complaint settings saved', 'ok');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section id="section-preferences-complaints">
      <h1>Complaint Preferences</h1>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Ordinance &amp; Enforcement Settings</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Customize optional local code/statute citations, Notice of Violation compliance window, and ordinance categories.
        </p>
        <form onSubmit={handleSaveSettings}>
          <div className="row" style={{ marginBottom: '.75rem' }}>
            <div className="field" style={{ flex: 1, minWidth: 200 }}>
              <label htmlFor="cp-code-citation">Local Code Citation (optional)</label>
              <input
                id="cp-code-citation"
                placeholder="e.g. City Code Chapter 10"
                value={codeCitation}
                onChange={(e) => setCodeCitation(e.target.value)}
              />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 200 }}>
              <label htmlFor="cp-privacy-statute">Public-Records Privacy Citation (optional)</label>
              <input
                id="cp-privacy-statute"
                placeholder="e.g. applicable state public-records law"
                value={privacyStatute}
                onChange={(e) => setPrivacyStatute(e.target.value)}
              />
            </div>
            <div className="field" style={{ width: 190 }}>
              <label htmlFor="cp-max-days">Max NOV Compliance Days (0 = none)</label>
              <input
                id="cp-max-days"
                type="number"
                min={0}
                max={3650}
                value={maxComplianceDays}
                onChange={(e) => setMaxComplianceDays(e.target.value)}
              />
            </div>
          </div>
          <div className="field" style={{ marginBottom: '.85rem' }}>
            <label htmlFor="cp-presets">Ordinance / Category Presets (one per line)</label>
            <textarea
              id="cp-presets"
              rows={6}
              value={presetsText}
              onChange={(e) => setPresetsText(e.target.value)}
            />
          </div>
          <button type="submit" className="btn primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save Complaint Settings'}
          </button>
        </form>
      </div>
      <ModuleNotificationsCard
        moduleId="complaints"
        title="Complaint Email Notifications"
        events={COMPLAINT_NOTIFICATION_EVENTS}
      />
    </section>
  );
}
