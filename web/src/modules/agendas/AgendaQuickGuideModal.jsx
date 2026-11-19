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

import React, { useEffect, useRef } from 'react';

export default function AgendaQuickGuideModal({ open, onClose, onNavigate }) {
  const dlgRef = useRef(null);

  useEffect(() => {
    const dlg = dlgRef.current;
    if (!dlg) return;
    if (open && !dlg.open) dlg.showModal();
    if (!open && dlg.open) dlg.close();
  }, [open]);

  return (
    <dialog
      ref={dlgRef}
      onCancel={(e) => { e.preventDefault(); onClose?.(); }}
      style={{ maxWidth: 680, width: '94%' }}
    >
      <div className="between" style={{ marginBottom: '.75rem' }}>
        <h2 style={{ margin: 0 }}>Clerk &amp; Councilmember Quick Guide</h2>
        <button type="button" className="btn sm" onClick={onClose}>Close</button>
      </div>

      <div style={{ display: 'grid', gap: '.85rem', fontSize: '.92rem', lineHeight: 1.5 }}>
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '.75rem' }}>
          <strong style={{ color: '#1e3a8a' }}>1. City Clerk / Staff Workflow</strong>
          <ul style={{ margin: '.4rem 0 0', paddingLeft: '1.2rem', display: 'grid', gap: '.25rem' }}>
            <li>
              <strong>Set Up Once:</strong> Configure your governing bodies, standard sections, 72-hour posting notice window, and email routing under{' '}
              {onNavigate ? (
                <button type="button" className="link-btn" onClick={() => { onClose?.(); onNavigate('#preferences-agenda'); }}>
                  Agenda Preferences
                </button>
              ) : (
                <strong>Agenda Preferences</strong>
              )}.
            </li>
            <li><strong>Build Faster with Templates:</strong> Build one standard meeting structure and click <strong>Save as Template</strong> (or <strong>Clone</strong> a past meeting) so future agendas take seconds.</li>
            <li><strong>Add Items &amp; Attachments:</strong> Add agenda items, attach PDFs/Office docs/images, or pull scheduled annual items from <strong>Todos &amp; Backlog</strong>.</li>
            <li><strong>Finalize &amp; Publish:</strong> Change the agenda category to <strong>Finalized Agendas</strong> to publish the Summary PDF, Full Packet PDF, and trigger Public Email Alerts. Editing items afterward automatically marks the agenda <strong>Amended</strong>.</li>
            <li><strong>Record Minutes &amp; Media:</strong> Enter attendance, motions, and votes in the <strong>Minutes</strong> tab (drafts carry a red <code>DRAFT</code> watermark until marked <strong>Approved</strong>) and attach a Video/Audio recording link.</li>
          </ul>
        </div>

        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '.75rem' }}>
          <strong style={{ color: '#1e3a8a' }}>2. Councilmember Workflow</strong>
          <ul style={{ margin: '.4rem 0 0', paddingLeft: '1.2rem', display: 'grid', gap: '.25rem' }}>
            <li><strong>Review Packets:</strong> View finalized <strong>Summary</strong>, <strong>Full Packet</strong>, <strong>Minutes</strong>, and meeting recordings under <strong>Propose Agenda Item</strong>.</li>
            <li><strong>Propose New Items:</strong> Submit a proposed agenda item (with optional supporting files) for an upcoming meeting; staff can accept it directly onto the target agenda.</li>
          </ul>
        </div>

        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '.75rem' }}>
          <strong style={{ color: '#1e3a8a' }}>3. Public Access</strong>
          <p style={{ margin: '.4rem 0 0' }}>
            Residents can filter published agendas by <strong>Board</strong> and <strong>Year</strong> on the Public Portal, download Summary/Full Packet/Minutes PDFs, watch meeting recordings, and subscribe to automatic <strong>Public Email Alerts</strong>.
          </p>
        </div>
      </div>

      <div className="actions" style={{ marginTop: '1rem', justifyContent: 'flex-end' }}>
        <button type="button" className="btn primary" onClick={onClose}>Got it</button>
      </div>
    </dialog>
  );
}
