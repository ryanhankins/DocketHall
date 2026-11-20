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

import React, { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { useToast } from './toast.jsx';

function statusBadge(status) {
  if (status === 'pass') return <span className="badge active">PASS</span>;
  if (status === 'warn') return <span className="badge draft">WARN</span>;
  return <span className="badge disabled">FAIL</span>;
}

export default function PdfComplianceButton({
  url,
  title = 'PDF Document',
  label = 'Check PDF',
  className = 'btn sm',
}) {
  const showToast = useToast();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const dlgRef = useRef(null);

  useEffect(() => {
    const dlg = dlgRef.current;
    if (!dlg) return;
    if (result && !dlg.open) dlg.showModal();
    if (!result && dlg.open) dlg.close();
  }, [result]);

  const runCheck = async () => {
    setBusy(true);
    try {
      const data = await api(url);
      setResult(data);
    } catch (err) {
      showToast(err.message || 'Failed to check PDF compliance', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className={className}
        disabled={busy}
        onClick={runCheck}
        aria-label={`Check WCAG 2.1 AA compliance for ${title}`}
        title={`Check PDF accessibility compliance (${title})`}
      >
        {busy ? 'Checking…' : label}
      </button>

      <dialog
        ref={dlgRef}
        onCancel={(e) => { e.preventDefault(); setResult(null); }}
        style={{ maxWidth: 620 }}
      >
        {result && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.75rem', marginBottom: '.75rem' }}>
              <h2 style={{ margin: 0 }}>PDF Accessibility Check</h2>
              <span className={`badge ${result.summary === 'Compliant' ? 'active' : (result.summary === 'Needs Attention' ? 'draft' : 'disabled')}`}>
                {result.summary} ({result.score}%)
              </span>
            </div>
            <div className="muted" style={{ fontSize: '.86rem', marginBottom: '.85rem' }}>
              <strong>{result.filename || title}</strong> &middot; {result.page_count} page(s)
            </div>
            <div style={{ display: 'grid', gap: '.5rem', maxHeight: '55vh', overflowY: 'auto' }}>
              {(result.checks || []).map((c) => (
                <div
                  key={c.id}
                  style={{
                    border: '1px solid #d9e2ec',
                    borderRadius: 6,
                    padding: '.55rem .7rem',
                    background: '#f8fafc',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.5rem', marginBottom: '.2rem' }}>
                    <strong style={{ fontSize: '.88rem' }}>{c.label}</strong>
                    {statusBadge(c.status)}
                  </div>
                  <div className="muted" style={{ fontSize: '.83rem' }}>{c.detail}</div>
                </div>
              ))}
            </div>
            <div className="dialog-actions">
              <button type="button" className="btn primary" onClick={() => setResult(null)}>
                Close
              </button>
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}
