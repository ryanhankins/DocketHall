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

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, todayIso } from '../../core/api.js';
import { useToast } from '../../core/toast.jsx';

const DRAFTS_KEY = 'dockethall_inspector_drafts_v1';
const CACHE_KEY = 'dockethall_inspector_queue_cache_v1';
const PARCELS_KEY = 'dockethall_inspector_parcels_v1';

function readJsonStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJsonStorage(key, val) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch {
    // Ignore storage quota errors
  }
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Failed to read photo'));
    reader.readAsDataURL(file);
  });
}

function dataUrlToBlob(dataUrl) {
  const [meta, b64] = dataUrl.split(',');
  const mime = (meta.match(/data:([^;]+);/) || [])[1] || 'image/jpeg';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

function SignaturePad({ value, onChange }) {
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (value) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      img.src = value;
    }
  }, [value]);

  function getPoint(e) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function handleDown(e) {
    e.preventDefault();
    const canvas = canvasRef.current;
    canvas.setPointerCapture?.(e.pointerId);
    const ctx = canvas.getContext('2d');
    const pt = getPoint(e);
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(pt.x, pt.y);
    drawingRef.current = true;
  }

  function handleMove(e) {
    if (!drawingRef.current) return;
    e.preventDefault();
    const ctx = canvasRef.current.getContext('2d');
    const pt = getPoint(e);
    ctx.lineTo(pt.x, pt.y);
    ctx.stroke();
  }

  function handleUp() {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    onChange(canvasRef.current.toDataURL('image/png'));
  }

  function clearPad() {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    onChange('');
  }

  return (
    <div>
      <div className="between" style={{ marginBottom: '.35rem' }}>
        <span className="muted" style={{ fontSize: '.82rem' }}>Inspector / Site Signature (draw with finger or mouse)</span>
        <button type="button" className="btn sm" onClick={clearPad}>Clear</button>
      </div>
      <canvas
        ref={canvasRef}
        width={480}
        height={130}
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
        onPointerCancel={handleUp}
        style={{
          width: '100%',
          maxWidth: 480,
          height: 130,
          border: '1px solid #cbd5e1',
          borderRadius: 6,
          background: '#fff',
          touchAction: 'none',
          display: 'block',
        }}
      />
    </div>
  );
}

export default function FieldInspectorPage({ me }) {
  const [queue, setQueue] = useState(() => readJsonStorage(CACHE_KEY, []));
  const [drafts, setDrafts] = useState(() => readJsonStorage(DRAFTS_KEY, {}));
  const [online, setOnline] = useState(() => (typeof navigator !== 'undefined' ? navigator.onLine : true));
  const [tab, setTab] = useState('today');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [parcels, setParcels] = useState(() => readJsonStorage(PARCELS_KEY, []));

  // Active inspection form state
  const [checklist, setChecklist] = useState([]);
  const [result, setResult] = useState('scheduled');
  const [notes, setNotes] = useState('');
  const [signedBy, setSignedBy] = useState('');
  const [signatureData, setSignatureData] = useState('');
  const [queuedPhotos, setQueuedPhotos] = useState([]);
  const toast = useToast();

  const loadQueue = useCallback(async () => {
    setLoading(true);
    try {
      const [items, parcelRows] = await Promise.all([
        api('/api/permits/inspections/queue?result='),
        api('/api/permits/parcels/map').catch(() => null),
      ]);
      const list = Array.isArray(items) ? items : [];
      setQueue(list);
      writeJsonStorage(CACHE_KEY, list);
      if (Array.isArray(parcelRows)) {
        setParcels(parcelRows);
        writeJsonStorage(PARCELS_KEY, parcelRows);
      }
    } catch {
      const cached = readJsonStorage(CACHE_KEY, []);
      setQueue(cached);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadQueue(); }, [loadQueue]);

  useEffect(() => {
    const onAiAction = () => loadQueue().catch(() => {});
    window.addEventListener('dockethall:ai-action', onAiAction);
    return () => window.removeEventListener('dockethall:ai-action', onAiAction);
  }, [loadQueue]);

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const syncSingleDraft = useCallback(async (inspId, draft) => {
    await api(`/api/permits/${draft.permit_id}/inspections/${inspId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        checklist: draft.checklist,
        result: draft.result,
        notes: draft.notes,
        signed_by: draft.signed_by || '',
        signature_data: draft.signature_data || '',
      }),
    });
    for (const p of draft.photos || []) {
      const fd = new FormData();
      fd.append('file', dataUrlToBlob(p.dataUrl), p.name || 'field-photo.jpg');
      fd.append('doc_category', 'Inspection Photo');
      fd.append('title', p.name || 'Field Photo');
      fd.append('inspection_id', String(inspId));
      await api(`/api/permits/${draft.permit_id}/documents`, { method: 'POST', body: fd });
    }
  }, []);

  const syncAllDrafts = useCallback(async () => {
    const entries = Object.entries(drafts);
    if (!entries.length || !online) return;
    setSyncing(true);
    const remaining = { ...drafts };
    let syncedCount = 0;
    for (const [inspId, draft] of entries) {
      try {
        await syncSingleDraft(Number(inspId), draft);
        delete remaining[inspId];
        syncedCount += 1;
      } catch {
        // Keep unsynced draft for next attempt
      }
    }
    setDrafts(remaining);
    writeJsonStorage(DRAFTS_KEY, remaining);
    setSyncing(false);
    if (syncedCount > 0) {
      toast(`Synced ${syncedCount} offline inspection draft(s)`);
      loadQueue();
    }
  }, [drafts, online, syncSingleDraft, toast, loadQueue]);

  useEffect(() => {
    if (online && Object.keys(drafts).length > 0) {
      syncAllDrafts();
    }
  }, [online]); // eslint-disable-line react-hooks/exhaustive-deps

  const today = todayIso();
  const filteredQueue = useMemo(() => {
    const ql = search.trim().toLowerCase();
    const myName = (me?.username || '').toLowerCase();
    return queue.filter((ins) => {
      if (tab === 'today') {
        if (ins.result !== 'scheduled') return false;
        if (ins.scheduled_date && ins.scheduled_date > today) return false;
      } else if (tab === 'mine') {
        if (ins.result !== 'scheduled') return false;
        if (myName && !(ins.inspector || '').toLowerCase().includes(myName)) return false;
      } else if (tab === 'scheduled') {
        if (ins.result !== 'scheduled') return false;
      } else if (tab === 'completed') {
        if (ins.result === 'scheduled') return false;
      }
      if (ql && !`${ins.permit_number} ${ins.property_address} ${ins.inspection_type} ${ins.inspector}`.toLowerCase().includes(ql)) {
        return false;
      }
      return true;
    });
  }, [queue, tab, search, today, me]);

  const activeIns = useMemo(() => queue.find((i) => i.id === selectedId) || null, [queue, selectedId]);

  function openInspection(ins) {
    setSelectedId(ins.id);
    const draft = drafts[String(ins.id)];
    if (draft) {
      setChecklist(draft.checklist || []);
      setResult(draft.result || ins.result || 'scheduled');
      setNotes(draft.notes ?? ins.notes ?? '');
      setSignedBy(draft.signed_by ?? ins.signed_by ?? me?.username ?? '');
      setSignatureData(draft.signature_data ?? ins.signature_data ?? '');
      setQueuedPhotos(draft.photos || []);
    } else {
      setChecklist(Array.isArray(ins.checklist) ? ins.checklist.map((c) => ({ ...c })) : []);
      setResult(ins.result || 'scheduled');
      setNotes(ins.notes || '');
      setSignedBy(ins.signed_by || me?.username || '');
      setSignatureData(ins.signature_data || '');
      setQueuedPhotos([]);
    }
  }

  function setChecklistStatus(idx, nextStatus) {
    setChecklist((prev) => prev.map((item, i) => (i === idx ? { ...item, status: nextStatus } : item)));
  }

  async function handlePhotoCapture(e) {
    const files = Array.from(e.target.files || []);
    if (!files.length || !activeIns) return;
    if (online) {
      let uploaded = 0;
      for (const f of files) {
        try {
          const fd = new FormData();
          fd.append('file', f);
          fd.append('doc_category', 'Inspection Photo');
          fd.append('title', f.name || 'Field Photo');
          fd.append('inspection_id', String(activeIns.id));
          await api(`/api/permits/${activeIns.permit_id}/documents`, { method: 'POST', body: fd });
          uploaded += 1;
        } catch {
          const dataUrl = await fileToDataUrl(f);
          setQueuedPhotos((prev) => [...prev, { name: f.name, dataUrl }]);
        }
      }
      if (uploaded > 0) toast(`Uploaded ${uploaded} inspection photo(s)`);
    } else {
      const added = [];
      for (const f of files) {
        added.push({ name: f.name, dataUrl: await fileToDataUrl(f) });
      }
      setQueuedPhotos((prev) => [...prev, ...added]);
      toast(`Queued ${added.length} photo(s) offline for sync`);
    }
    e.target.value = '';
  }

  function saveOfflineDraft(nextResult = result) {
    if (!activeIns) return;
    const nextDrafts = {
      ...drafts,
      [String(activeIns.id)]: {
        permit_id: activeIns.permit_id,
        checklist,
        result: nextResult,
        notes,
        signed_by: signedBy,
        signature_data: signatureData,
        photos: queuedPhotos,
        saved_at: new Date().toISOString(),
      },
    };
    setDrafts(nextDrafts);
    writeJsonStorage(DRAFTS_KEY, nextDrafts);
    toast('Saved field inspection draft locally (offline-safe)');
  }

  async function submitInspection(nextResult = result) {
    if (!activeIns) return;
    if (!online) {
      saveOfflineDraft(nextResult);
      return;
    }
    try {
      await syncSingleDraft(activeIns.id, {
        permit_id: activeIns.permit_id,
        checklist,
        result: nextResult,
        notes,
        signed_by: signedBy,
        signature_data: signatureData,
        photos: queuedPhotos,
      });
      const nextDrafts = { ...drafts };
      delete nextDrafts[String(activeIns.id)];
      setDrafts(nextDrafts);
      writeJsonStorage(DRAFTS_KEY, nextDrafts);
      setQueuedPhotos([]);
      toast(`Inspection marked ${nextResult}`);
      await loadQueue();
      setSelectedId(null);
    } catch {
      saveOfflineDraft(nextResult);
    }
  }

  const pendingDraftCount = Object.keys(drafts).length;

  return (
    <section id="section-field-inspector" style={{ maxWidth: 920, margin: '0 auto' }}>
      <div className="between" style={{ marginBottom: '.85rem', flexWrap: 'wrap', gap: '.5rem' }}>
        <div>
          <h1 style={{ margin: 0 }}>Field Inspector Mode</h1>
          <p className="muted" style={{ margin: '.2rem 0 0' }}>
            Mobile-friendly queue with one-tap checklists, camera photos, signature capture, and offline draft sync.
          </p>
        </div>
        <div className="actions" style={{ flexWrap: 'wrap' }}>
          <span className={`badge ${online ? 'final' : 'disabled'}`}>
            {online ? 'Online' : 'Offline Mode'}
          </span>
          {pendingDraftCount > 0 && (
            <button type="button" className="btn sm primary" onClick={syncAllDrafts} disabled={!online || syncing}>
              {syncing ? 'Syncing…' : `Sync ${pendingDraftCount} Draft(s)`}
            </button>
          )}
          <button type="button" className="btn sm" onClick={loadQueue} disabled={loading}>Refresh</button>
        </div>
      </div>

      {!activeIns ? (
        <div className="card">
          <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', marginBottom: '.75rem', alignItems: 'center' }}>
            {[
              ['today', "Today's Queue"],
              ['mine', 'Assigned to Me'],
              ['scheduled', 'All Scheduled'],
              ['map', 'Route Map'],
              ['completed', 'Completed'],
            ].map(([k, lbl]) => (
              <button
                key={k}
                type="button"
                className={`btn sm ${tab === k ? 'primary' : ''}`}
                onClick={() => setTab(k)}
              >
                {lbl}
              </button>
            ))}
            <input
              style={{ marginLeft: 'auto', maxWidth: 240 }}
              placeholder="Search permit or address…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {tab === 'map' ? (() => {
            const parcelByAddr = new Map();
            for (const p of parcels) {
              if (p.latitude != null && p.longitude != null && p.address) {
                parcelByAddr.set(p.address.trim().toLowerCase(), p);
              }
            }
            const scheduledStops = queue.filter((ins) => ins.result === 'scheduled');
            const mapped = scheduledStops
              .map((ins) => {
                const match = parcelByAddr.get((ins.property_address || '').trim().toLowerCase());
                return match ? { ins, lat: Number(match.latitude), lng: Number(match.longitude) } : null;
              })
              .filter(Boolean);
            const lats = mapped.map((m) => m.lat);
            const lngs = mapped.map((m) => m.lng);
            const minLat = lats.length ? Math.min(...lats) : 0;
            const maxLat = lats.length ? Math.max(...lats) : 1;
            const minLng = lngs.length ? Math.min(...lngs) : 0;
            const maxLng = lngs.length ? Math.max(...lngs) : 1;
            const spanLat = Math.max(0.002, maxLat - minLat);
            const spanLng = Math.max(0.002, maxLng - minLng);
            const pts = mapped.map((m, i) => ({
              ...m,
              idx: i + 1,
              x: 40 + ((m.lng - minLng) / spanLng) * 520,
              y: 260 - ((m.lat - minLat) / spanLat) * 220,
            }));
            return (
              <div style={{ display: 'grid', gap: '.85rem' }}>
                {pts.length === 0 ? (
                  <p className="muted" style={{ margin: 0 }}>
                    No scheduled inspections currently match parcels with latitude/longitude coordinates. Add coordinates in Property Profiles to plot inspection routes.
                  </p>
                ) : (
                  <svg viewBox="0 0 600 300" style={{ width: '100%', maxHeight: 320, background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: 8 }}>
                    <line x1="20" y1="150" x2="580" y2="150" stroke="#e2e8f0" strokeDasharray="4 4" />
                    <line x1="300" y1="20" x2="300" y2="280" stroke="#e2e8f0" strokeDasharray="4 4" />
                    {pts.length > 1 && (
                      <polyline
                        fill="none"
                        stroke="#2563eb"
                        strokeWidth="2"
                        strokeDasharray="5 4"
                        points={pts.map((pt) => `${pt.x},${pt.y}`).join(' ')}
                      />
                    )}
                    {pts.map((pt) => (
                      <g key={pt.ins.id} style={{ cursor: 'pointer' }} onClick={() => openInspection(pt.ins)}>
                        <circle cx={pt.x} cy={pt.y} r="13" fill="#1d4ed8" stroke="#ffffff" strokeWidth="2" />
                        <text x={pt.x} y={pt.y + 4} textAnchor="middle" fill="#ffffff" fontSize="11" fontWeight="700">
                          {pt.idx}
                        </text>
                      </g>
                    ))}
                  </svg>
                )}
                <div style={{ display: 'grid', gap: '.45rem' }}>
                  {scheduledStops.map((ins, i) => {
                    const m = pts.find((p) => p.ins.id === ins.id);
                    return (
                      <div
                        key={ins.id}
                        className="between"
                        onClick={() => openInspection(ins)}
                        style={{ padding: '.55rem .75rem', border: '1px solid #cbd5e1', borderRadius: 6, cursor: 'pointer' }}
                      >
                        <div>
                          <strong>{m ? `#${m.idx} ` : ''}{ins.inspection_type}</strong> — {ins.property_address || ins.permit_number}
                          <div className="muted" style={{ fontSize: '.8rem' }}>
                            {ins.scheduled_date || 'Unscheduled'}{m ? ` · GPS: ${m.lat.toFixed(5)}, ${m.lng.toFixed(5)}` : ' · No parcel GPS coordinates'}
                          </div>
                        </div>
                        <button type="button" className="btn sm">Open</button>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })() : loading && !queue.length ? (
            <p className="muted">Loading inspections…</p>
          ) : !filteredQueue.length ? (
            <p className="muted" style={{ margin: 0 }}>No inspections match this queue view.</p>
          ) : (
            <div style={{ display: 'grid', gap: '.6rem' }}>
              {filteredQueue.map((ins) => {
                const hasDraft = !!drafts[String(ins.id)];
                return (
                  <div
                    key={ins.id}
                    onClick={() => openInspection(ins)}
                    style={{
                      padding: '.85rem',
                      border: '1px solid #cbd5e1',
                      borderRadius: 8,
                      cursor: 'pointer',
                      background: hasDraft ? '#fffbeb' : '#fff',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '.75rem',
                      flexWrap: 'wrap',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '1rem' }}>
                        {ins.inspection_type} — {ins.property_address || ins.permit_number}
                      </div>
                      <div className="muted" style={{ fontSize: '.85rem', marginTop: '.15rem' }}>
                        Permit {ins.permit_number} · {ins.scheduled_date || 'Unscheduled'}
                        {ins.requested_window ? ` (${ins.requested_window})` : ''}
                        {ins.inspector ? ` · Inspector: ${ins.inspector}` : ''}
                      </div>
                    </div>
                    <div className="actions">
                      {hasDraft && <span className="badge draft">Offline Draft</span>}
                      <span className={`badge ${ins.result === 'passed' ? 'final' : ins.result === 'failed' ? 'disabled' : ''}`}>
                        {ins.result}
                      </span>
                      <button type="button" className="btn sm primary">Inspect</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="card" style={{ display: 'grid', gap: '1rem' }}>
          <div className="between" style={{ flexWrap: 'wrap', gap: '.5rem' }}>
            <div>
              <button type="button" className="btn sm" onClick={() => setSelectedId(null)} style={{ marginBottom: '.4rem' }}>
                ← Back to Queue
              </button>
              <h2 style={{ margin: 0 }}>{activeIns.inspection_type}</h2>
              <div className="muted" style={{ fontSize: '.88rem' }}>
                {activeIns.property_address} · Permit {activeIns.permit_number} · {activeIns.scheduled_date || 'Unscheduled'}
              </div>
            </div>
            <span className="badge">{activeIns.result}</span>
          </div>

          <div>
            <h3 style={{ margin: '0 0 .5rem', fontSize: '1rem' }}>Checklist Items</h3>
            {!checklist.length ? (
              <p className="muted" style={{ margin: 0 }}>No checklist items configured for this inspection.</p>
            ) : (
              <div style={{ display: 'grid', gap: '.55rem' }}>
                {checklist.map((item, idx) => (
                  <div
                    key={idx}
                    style={{
                      padding: '.65rem .75rem',
                      border: '1px solid #e2e8f0',
                      borderRadius: 8,
                      background: '#f8fafc',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '.6rem',
                      flexWrap: 'wrap',
                    }}
                  >
                    <span style={{ fontWeight: 500, flex: '1 1 220px' }}>{item.label}</span>
                    <div style={{ display: 'flex', gap: '.35rem' }}>
                      {[
                        ['pass', 'Pass', '#16a34a'],
                        ['fail', 'Fail', '#dc2626'],
                        ['na', 'N/A', '#64748b'],
                      ].map(([st, lbl, color]) => {
                        const active = item.status === st;
                        return (
                          <button
                            key={st}
                            type="button"
                            className="btn sm"
                            onClick={() => setChecklistStatus(idx, st)}
                            style={{
                              minWidth: 56,
                              minHeight: 36,
                              fontWeight: 600,
                              background: active ? color : '#fff',
                              color: active ? '#fff' : '#334155',
                              borderColor: active ? color : '#cbd5e1',
                            }}
                          >
                            {lbl}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <h3 style={{ margin: '0 0 .45rem', fontSize: '1rem' }}>Field Photos (Camera Capture)</h3>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              onChange={handlePhotoCapture}
            />
            {queuedPhotos.length > 0 && (
              <div className="muted" style={{ fontSize: '.85rem', marginTop: '.35rem' }}>
                {queuedPhotos.length} photo(s) queued offline for upload upon sync.
              </div>
            )}
          </div>

          <div>
            <label htmlFor="field-notes" style={{ fontWeight: 600, display: 'block', marginBottom: '.3rem' }}>
              Field Notes &amp; Corrections
            </label>
            <textarea
              id="field-notes"
              rows={3}
              placeholder="Enter field observations, code corrections, or conditions…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <div style={{ display: 'grid', gap: '.5rem' }}>
            <div>
              <label htmlFor="field-signed-by" className="muted" style={{ fontSize: '.82rem', display: 'block' }}>
                Signed By (Inspector / Representative)
              </label>
              <input
                id="field-signed-by"
                type="text"
                value={signedBy}
                onChange={(e) => setSignedBy(e.target.value)}
                style={{ maxWidth: 320 }}
              />
            </div>
            <SignaturePad value={signatureData} onChange={setSignatureData} />
          </div>

          <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center', borderTop: '1px solid #e2e8f0', paddingTop: '.85rem' }}>
            <select
              aria-label="Inspection result"
              value={result}
              onChange={(e) => setResult(e.target.value)}
              style={{ width: 'auto', minHeight: 40 }}
            >
              <option value="scheduled">Scheduled (In Progress)</option>
              <option value="passed">Passed</option>
              <option value="partial">Partial Pass</option>
              <option value="failed">Failed</option>
            </select>
            <button type="button" className="btn" onClick={() => saveOfflineDraft(result)}>
              Save Offline Draft
            </button>
            <button type="button" className="btn primary" onClick={() => submitInspection('passed')}>
              Pass &amp; Complete
            </button>
            <button type="button" className="btn" onClick={() => submitInspection(result)}>
              Submit Result
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
