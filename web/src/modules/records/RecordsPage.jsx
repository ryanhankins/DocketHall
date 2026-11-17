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

import { useCallback, useEffect, useState } from 'react';
import { api, formatDate, formatSize, hasPermission } from '../../core/api.js';
import { useToast } from '../../core/toast.jsx';

const CATEGORIES = [
  'Contract',
  'Resolution',
  'Ordinance',
  'Agreement',
  'Easement',
  'Policy',
  'Other',
];

const STATUSES = ['active', 'pending', 'expired', 'archived', 'superseded'];

const EMPTY_FORM = {
  doc_number: '',
  category: 'Contract',
  title: '',
  counterparty: '',
  effective_date: '',
  expiration_date: '',
  renewal_notice_days: 30,
  status: 'active',
  tags: '',
  notes: '',
  is_public: false,
};

function ExpiryBadge({ flag }) {
  if (flag === 'expired') {
    return (
      <span
        className="badge"
        style={{ background: '#fee2e2', color: '#991b1b', marginLeft: 6 }}
      >
        Expired
      </span>
    );
  }
  if (flag === 'expiring_soon') {
    return (
      <span
        className="badge"
        style={{ background: '#fef3c7', color: '#92400e', marginLeft: 6 }}
      >
        Expiring Soon
      </span>
    );
  }
  return null;
}

export default function RecordsPage({ me }) {
  const showToast = useToast();
  const canManage = hasPermission(me, 'records.manage');

  const [items, setItems] = useState([]);
  const [expiringCount, setExpiringCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const [q, setQ] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [expiringOnly, setExpiringOnly] = useState(false);

  const [showAdd, setShowAdd] = useState(false);
  const [newForm, setNewForm] = useState({ ...EMPTY_FORM });
  const [savingNew, setSavingNew] = useState(false);

  const [selected, setSelected] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const loadRecords = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (categoryFilter) params.set('category', categoryFilter);
      if (statusFilter) params.set('status', statusFilter);
      if (expiringOnly) params.set('expiring_only', 'true');
      const qs = params.toString();
      const data = await api(`/api/records${qs ? `?${qs}` : ''}`);
      const list = data.items || [];
      setItems(list);
      setExpiringCount(data.expiring_count || 0);
      setSelected((prev) => {
        if (!prev) return null;
        const fresh = list.find((r) => r.id === prev.id);
        return fresh || null;
      });
    } catch (err) {
      showToast(err.message || 'Failed to load records', 'error');
    } finally {
      setLoading(false);
    }
  }, [q, categoryFilter, statusFilter, expiringOnly, showToast]);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  function openDetail(rec) {
    setSelected(rec);
    setEditForm({
      doc_number: rec.doc_number || '',
      category: rec.category || 'Contract',
      title: rec.title || '',
      counterparty: rec.counterparty || '',
      effective_date: rec.effective_date || '',
      expiration_date: rec.expiration_date || '',
      renewal_notice_days: rec.renewal_notice_days ?? 30,
      status: rec.status || 'active',
      tags: rec.tags || '',
      notes: rec.notes || '',
      is_public: Boolean(rec.is_public),
    });
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (!newForm.title.trim()) {
      showToast('Title is required', 'error');
      return;
    }
    setSavingNew(true);
    try {
      const created = await api('/api/records', {
        method: 'POST',
        body: JSON.stringify({
          ...newForm,
          renewal_notice_days: newForm.renewal_notice_days === '' ? 30 : Number(newForm.renewal_notice_days),
        }),
      });
      showToast('Record created', 'ok');
      setNewForm({ ...EMPTY_FORM });
      setShowAdd(false);
      await loadRecords();
      openDetail(created);
    } catch (err) {
      showToast(err.message || 'Failed to create record', 'error');
    } finally {
      setSavingNew(false);
    }
  }

  async function handleSaveEdit(e) {
    e.preventDefault();
    if (!selected || !editForm) return;
    setSavingEdit(true);
    try {
      const updated = await api(`/api/records/${selected.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          ...editForm,
          renewal_notice_days: editForm.renewal_notice_days === '' ? 30 : Number(editForm.renewal_notice_days),
        }),
      });
      showToast('Record updated', 'ok');
      setSelected(updated);
      await loadRecords();
    } catch (err) {
      showToast(err.message || 'Failed to update record', 'error');
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleDeleteRecord(rec) {
    if (!window.confirm(`Delete "${rec.title}" and all attached files?`)) return;
    try {
      await api(`/api/records/${rec.id}`, { method: 'DELETE' });
      showToast('Record deleted', 'ok');
      if (selected?.id === rec.id) {
        setSelected(null);
        setEditForm(null);
      }
      await loadRecords();
    } catch (err) {
      showToast(err.message || 'Failed to delete record', 'error');
    }
  }

  async function uploadFiles(fileList) {
    if (!selected || !fileList || fileList.length === 0) return;
    setUploading(true);
    try {
      let latest = selected;
      for (const file of Array.from(fileList)) {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('title', file.name);
        latest = await api(`/api/records/${selected.id}/files`, {
          method: 'POST',
          body: fd,
        });
      }
      setSelected(latest);
      showToast('File(s) uploaded', 'ok');
      await loadRecords();
    } catch (err) {
      showToast(err.message || 'Failed to upload file', 'error');
    } finally {
      setUploading(false);
    }
  }

  async function handleDeleteFile(fileId) {
    if (!selected) return;
    if (!window.confirm('Remove this attached file?')) return;
    try {
      const updated = await api(`/api/records/${selected.id}/files/${fileId}`, {
        method: 'DELETE',
      });
      setSelected(updated);
      showToast('File removed', 'ok');
      await loadRecords();
    } catch (err) {
      showToast(err.message || 'Failed to remove file', 'error');
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div>
          <h2 style={{ margin: 0 }}>Contracts, Resolutions &amp; Document Repository</h2>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Central archive for city contracts, resolutions, ordinances, agreements, and renewal tracking.
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            className="btn primary"
            onClick={() => setShowAdd((v) => !v)}
          >
            {showAdd ? 'Close Form' : '+ Add Record'}
          </button>
        )}
      </div>

      {expiringCount > 0 && (
        <div
          className="card"
          style={{
            background: '#fffbeb',
            border: '1px solid #fcd34d',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <div>
            <strong>Renewal / Expiration Alert:</strong> {expiringCount} record
            {expiringCount === 1 ? ' is' : 's are'} expired or approaching expiration.
          </div>
          <button
            type="button"
            className="btn sm"
            onClick={() => setExpiringOnly((v) => !v)}
          >
            {expiringOnly ? 'Show All Records' : 'Filter Expiring / Expired'}
          </button>
        </div>
      )}

      {showAdd && canManage && (
        <form className="card" onSubmit={handleCreate} style={{ display: 'grid', gap: 12 }}>
          <h3 style={{ margin: 0 }}>New Repository Record</h3>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: 12,
            }}
          >
            <label>
              <div className="muted" style={{ fontSize: 12 }}>Document #</div>
              <input
                className="input"
                value={newForm.doc_number}
                onChange={(e) => setNewForm({ ...newForm, doc_number: e.target.value })}
                placeholder="e.g. RES-2026-014"
              />
            </label>
            <label>
              <div className="muted" style={{ fontSize: 12 }}>Category</div>
              <select
                className="input"
                value={newForm.category}
                onChange={(e) => setNewForm({ ...newForm, category: e.target.value })}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </label>
            <label>
              <div className="muted" style={{ fontSize: 12 }}>Status</div>
              <select
                className="input"
                value={newForm.status}
                onChange={(e) => setNewForm({ ...newForm, status: e.target.value })}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>
            <label>
              <div className="muted" style={{ fontSize: 12 }}>Title *</div>
              <input
                className="input"
                required
                value={newForm.title}
                onChange={(e) => setNewForm({ ...newForm, title: e.target.value })}
                placeholder="Document title"
              />
            </label>
            <label>
              <div className="muted" style={{ fontSize: 12 }}>Counterparty / Vendor</div>
              <input
                className="input"
                value={newForm.counterparty}
                onChange={(e) => setNewForm({ ...newForm, counterparty: e.target.value })}
                placeholder="Vendor or organization"
              />
            </label>
            <label>
              <div className="muted" style={{ fontSize: 12 }}>Effective Date</div>
              <input
                type="date"
                className="input"
                value={newForm.effective_date}
                onChange={(e) => setNewForm({ ...newForm, effective_date: e.target.value })}
              />
            </label>
            <label>
              <div className="muted" style={{ fontSize: 12 }}>Expiration Date</div>
              <input
                type="date"
                className="input"
                value={newForm.expiration_date}
                onChange={(e) => setNewForm({ ...newForm, expiration_date: e.target.value })}
              />
            </label>
            <label>
              <div className="muted" style={{ fontSize: 12 }}>Renewal Notice (days)</div>
              <input
                type="number"
                min="0"
                className="input"
                value={newForm.renewal_notice_days}
                onChange={(e) =>
                  setNewForm({ ...newForm, renewal_notice_days: e.target.value })
                }
              />
            </label>
            <label>
              <div className="muted" style={{ fontSize: 12 }}>Tags</div>
              <input
                className="input"
                value={newForm.tags}
                onChange={(e) => setNewForm({ ...newForm, tags: e.target.value })}
                placeholder="comma-separated tags"
              />
            </label>
          </div>
          <label>
            <div className="muted" style={{ fontSize: 12 }}>Notes</div>
            <textarea
              className="input"
              rows={2}
              value={newForm.notes}
              onChange={(e) => setNewForm({ ...newForm, notes: e.target.value })}
            />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={newForm.is_public}
              onChange={(e) => setNewForm({ ...newForm, is_public: e.target.checked })}
            />
            <span>Publish to public repository endpoint</span>
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" className="btn primary" disabled={savingNew}>
              {savingNew ? 'Saving...' : 'Save Record'}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => setShowAdd(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <div
        className="card"
        style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}
      >
        <input
          className="input"
          style={{ flex: '1 1 220px' }}
          placeholder="Search title, doc #, counterparty, tags..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className="input"
          style={{ width: 'auto' }}
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
        >
          <option value="">All Categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select
          className="input"
          style={{ width: 'auto' }}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All Statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}>
          <input
            type="checkbox"
            checked={expiringOnly}
            onChange={(e) => setExpiringOnly(e.target.checked)}
          />
          <span>Expiring / Expired only</span>
        </label>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: selected ? '1.3fr 1fr' : '1fr',
          gap: 16,
          alignItems: 'start',
        }}
      >
        <div className="card" style={{ overflowX: 'auto' }}>
          {loading ? (
            <p className="muted">Loading repository records...</p>
          ) : items.length === 0 ? (
            <p className="muted">No repository records match the current filters.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>
                  <th style={{ padding: '8px 6px' }}>Doc #</th>
                  <th style={{ padding: '8px 6px' }}>Title</th>
                  <th style={{ padding: '8px 6px' }}>Category</th>
                  <th style={{ padding: '8px 6px' }}>Counterparty</th>
                  <th style={{ padding: '8px 6px' }}>Expires</th>
                  <th style={{ padding: '8px 6px' }}>Status</th>
                  <th style={{ padding: '8px 6px' }}>Files</th>
                </tr>
              </thead>
              <tbody>
                {items.map((rec) => {
                  const isSel = selected?.id === rec.id;
                  return (
                    <tr
                      key={rec.id}
                      onClick={() => openDetail(rec)}
                      style={{
                        cursor: 'pointer',
                        borderBottom: '1px solid #f3f4f6',
                        background: isSel ? '#eff6ff' : 'transparent',
                      }}
                    >
                      <td style={{ padding: '8px 6px', whiteSpace: 'nowrap' }}>
                        {rec.doc_number || '—'}
                      </td>
                      <td style={{ padding: '8px 6px' }}>
                        <button type="button" className="link-btn" onClick={(e) => { e.stopPropagation(); openDetail(rec); }}>
                          {rec.title}
                        </button>
                        <ExpiryBadge flag={rec.expiry_flag} />
                        {rec.is_public && (
                          <span className="badge" style={{ marginLeft: 6 }}>
                            Public
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '8px 6px' }}>{rec.category}</td>
                      <td style={{ padding: '8px 6px' }}>{rec.counterparty || '—'}</td>
                      <td style={{ padding: '8px 6px', whiteSpace: 'nowrap' }}>
                        {rec.expiration_date || '—'}
                      </td>
                      <td style={{ padding: '8px 6px' }}>{rec.status}</td>
                      <td style={{ padding: '8px 6px' }}>{(rec.files || []).length}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {selected && editForm && (
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0 }}>{selected.title}</h3>
              <button
                type="button"
                className="btn sm"
                onClick={() => {
                  setSelected(null);
                  setEditForm(null);
                }}
              >
                Close
              </button>
            </div>

            <form onSubmit={handleSaveEdit} style={{ display: 'grid', gap: 10 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <label>
                  <div className="muted" style={{ fontSize: 12 }}>Doc #</div>
                  <input
                    className="input"
                    disabled={!canManage}
                    value={editForm.doc_number}
                    onChange={(e) => setEditForm({ ...editForm, doc_number: e.target.value })}
                  />
                </label>
                <label>
                  <div className="muted" style={{ fontSize: 12 }}>Category</div>
                  <select
                    className="input"
                    disabled={!canManage}
                    value={editForm.category}
                    onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <div className="muted" style={{ fontSize: 12 }}>Status</div>
                  <select
                    className="input"
                    disabled={!canManage}
                    value={editForm.status}
                    onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <div className="muted" style={{ fontSize: 12 }}>Renewal Notice (days)</div>
                  <input
                    type="number"
                    min="0"
                    className="input"
                    disabled={!canManage}
                    value={editForm.renewal_notice_days}
                    onChange={(e) =>
                      setEditForm({ ...editForm, renewal_notice_days: e.target.value })
                    }
                  />
                </label>
                <label>
                  <div className="muted" style={{ fontSize: 12 }}>Effective Date</div>
                  <input
                    type="date"
                    className="input"
                    disabled={!canManage}
                    value={editForm.effective_date}
                    onChange={(e) =>
                      setEditForm({ ...editForm, effective_date: e.target.value })
                    }
                  />
                </label>
                <label>
                  <div className="muted" style={{ fontSize: 12 }}>Expiration Date</div>
                  <input
                    type="date"
                    className="input"
                    disabled={!canManage}
                    value={editForm.expiration_date}
                    onChange={(e) =>
                      setEditForm({ ...editForm, expiration_date: e.target.value })
                    }
                  />
                </label>
              </div>
              <label>
                <div className="muted" style={{ fontSize: 12 }}>Title</div>
                <input
                  className="input"
                  disabled={!canManage}
                  value={editForm.title}
                  onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                />
              </label>
              <label>
                <div className="muted" style={{ fontSize: 12 }}>Counterparty</div>
                <input
                  className="input"
                  disabled={!canManage}
                  value={editForm.counterparty}
                  onChange={(e) => setEditForm({ ...editForm, counterparty: e.target.value })}
                />
              </label>
              <label>
                <div className="muted" style={{ fontSize: 12 }}>Tags</div>
                <input
                  className="input"
                  disabled={!canManage}
                  value={editForm.tags}
                  onChange={(e) => setEditForm({ ...editForm, tags: e.target.value })}
                />
              </label>
              <label>
                <div className="muted" style={{ fontSize: 12 }}>Notes</div>
                <textarea
                  className="input"
                  rows={2}
                  disabled={!canManage}
                  value={editForm.notes}
                  onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  disabled={!canManage}
                  checked={editForm.is_public}
                  onChange={(e) => setEditForm({ ...editForm, is_public: e.target.checked })}
                />
                <span>Publicly visible</span>
              </label>

              {canManage && (
                <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
                  <button type="submit" className="btn primary" disabled={savingEdit}>
                    {savingEdit ? 'Saving...' : 'Save Changes'}
                  </button>
                  <button
                    type="button"
                    className="btn danger"
                    onClick={() => handleDeleteRecord(selected)}
                  >
                    Delete Record
                  </button>
                </div>
              )}
            </form>

            <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 12 }}>
              <h4 style={{ margin: '0 0 8px' }}>Attached Files</h4>
              {canManage && (
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    uploadFiles(e.dataTransfer.files);
                  }}
                  style={{
                    border: `2px dashed ${dragOver ? '#2563eb' : '#cbd5e1'}`,
                    borderRadius: 8,
                    padding: 12,
                    textAlign: 'center',
                    marginBottom: 10,
                    background: dragOver ? '#eff6ff' : '#f8fafc',
                  }}
                >
                  <div style={{ fontSize: 13, marginBottom: 6 }}>
                    {uploading ? 'Uploading...' : 'Drag & drop files here or choose a file'}
                  </div>
                  <input
                    type="file"
                    multiple
                    disabled={uploading}
                    onChange={(e) => {
                      uploadFiles(e.target.files);
                      e.target.value = '';
                    }}
                  />
                </div>
              )}

              {(selected.files || []).length === 0 ? (
                <p className="muted" style={{ margin: 0 }}>No files attached.</p>
              ) : (
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 6 }}>
                  {selected.files.map((f) => (
                    <li
                      key={f.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '6px 8px',
                        border: '1px solid #e5e7eb',
                        borderRadius: 6,
                        gap: 8,
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <a
                          href={`/api/records/files/${f.id}/download`}
                          target="_blank"
                          rel="noreferrer"
                          style={{ fontWeight: 500 }}
                        >
                          {f.filename}
                        </a>
                        <div className="muted" style={{ fontSize: 12 }}>
                          {formatSize(f.size_bytes)} · {formatDate(f.created_at)}
                        </div>
                      </div>
                      {canManage && (
                        <button
                          type="button"
                          className="btn sm danger"
                          onClick={() => handleDeleteFile(f.id)}
                        >
                          Remove
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
