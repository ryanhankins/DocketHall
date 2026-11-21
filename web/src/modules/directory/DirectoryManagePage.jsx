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

const EMPTY_CONTACT = {
  name: '',
  title_role: '',
  department: '',
  email: '',
  phone: '',
  office_hours: '',
  notes: '',
  is_elected: false,
  sort_order: 0,
  is_public: true,
};

const EMPTY_FAQ = {
  question: '',
  answer: '',
  category: 'General',
  sort_order: 0,
  is_public: true,
};

const EMPTY_RESOURCE = {
  name: '',
  category: 'Local Business',
  description: '',
  address: '',
  phone: '',
  email: '',
  website_url: '',
  hours: '',
  is_featured: false,
  sort_order: 0,
  is_public: true,
};

const RESOURCE_CATEGORIES = [
  'Local Business',
  'Nonprofit & Civic',
  'Utilities & Emergency',
  'Healthcare & Senior Services',
  'Schools & Youth',
  'Parks & Recreation',
  'Dining & Hospitality',
  'Other',
];

const EMPTY_BOARD = {
  board_name: 'Planning Commission',
  seat_name: '',
  member_name: '',
  email: '',
  term_start: '',
  term_end: '',
  is_vacant: false,
  is_public: true,
  sort_order: 0,
  notes: '',
};

export default function DirectoryManagePage() {
  const [tab, setTab] = useState('contacts');
  const [contacts, setContacts] = useState([]);
  const [faqs, setFaqs] = useState([]);
  const [resources, setResources] = useState([]);
  const [boards, setBoards] = useState([]);

  const [contactForm, setContactForm] = useState({ ...EMPTY_CONTACT });
  const [editContactId, setEditContactId] = useState(null);

  const [faqForm, setFaqForm] = useState({ ...EMPTY_FAQ });
  const [editFaqId, setEditFaqId] = useState(null);

  const [resourceForm, setResourceForm] = useState({ ...EMPTY_RESOURCE });
  const [editResourceId, setEditResourceId] = useState(null);

  const [boardForm, setBoardForm] = useState({ ...EMPTY_BOARD });
  const [editBoardId, setEditBoardId] = useState(null);

  const [busy, setBusy] = useState(false);
  const showToast = useToast();

  const loadAll = useCallback(async () => {
    const [cRows, fRows, rRows, bRows] = await Promise.all([
      api('/api/directory/contacts'),
      api('/api/directory/faqs'),
      api('/api/directory/resources'),
      api('/api/directory/boards'),
    ]);
    setContacts(Array.isArray(cRows) ? cRows : []);
    setFaqs(Array.isArray(fRows) ? fRows : []);
    setResources(Array.isArray(rRows) ? rRows : []);
    setBoards(Array.isArray(bRows) ? bRows : []);
  }, []);

  useEffect(() => {
    loadAll().catch((e) => showToast(e.message, 'error'));
  }, [loadAll, showToast]);

  const saveContact = async (e) => {
    e.preventDefault();
    if (!contactForm.name.trim()) return;
    setBusy(true);
    try {
      const payload = {
        ...contactForm,
        name: contactForm.name.trim(),
        title_role: contactForm.title_role.trim(),
        department: contactForm.department.trim(),
        email: contactForm.email.trim(),
        phone: contactForm.phone.trim(),
        office_hours: contactForm.office_hours.trim(),
        notes: contactForm.notes.trim(),
        sort_order: Number(contactForm.sort_order) || 0,
      };
      if (editContactId) {
        await api(`/api/directory/contacts/${editContactId}`, { method: 'PATCH', body: JSON.stringify(payload) });
        showToast('Contact updated', 'ok');
      } else {
        await api('/api/directory/contacts', { method: 'POST', body: JSON.stringify(payload) });
        showToast('Contact added', 'ok');
      }
      setContactForm({ ...EMPTY_CONTACT });
      setEditContactId(null);
      await loadAll();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const saveFaq = async (e) => {
    e.preventDefault();
    if (!faqForm.question.trim()) return;
    setBusy(true);
    try {
      const payload = {
        ...faqForm,
        question: faqForm.question.trim(),
        answer: faqForm.answer.trim(),
        category: faqForm.category.trim() || 'General',
        sort_order: Number(faqForm.sort_order) || 0,
      };
      if (editFaqId) {
        await api(`/api/directory/faqs/${editFaqId}`, { method: 'PATCH', body: JSON.stringify(payload) });
        showToast('FAQ updated', 'ok');
      } else {
        await api('/api/directory/faqs', { method: 'POST', body: JSON.stringify(payload) });
        showToast('FAQ added', 'ok');
      }
      setFaqForm({ ...EMPTY_FAQ });
      setEditFaqId(null);
      await loadAll();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const saveResource = async (e) => {
    e.preventDefault();
    if (!resourceForm.name.trim()) return;
    setBusy(true);
    try {
      const payload = {
        ...resourceForm,
        name: resourceForm.name.trim(),
        category: resourceForm.category.trim() || 'Local Business',
        description: resourceForm.description.trim(),
        address: resourceForm.address.trim(),
        phone: resourceForm.phone.trim(),
        email: resourceForm.email.trim(),
        website_url: resourceForm.website_url.trim(),
        hours: resourceForm.hours.trim(),
        sort_order: Number(resourceForm.sort_order) || 0,
      };
      if (editResourceId) {
        await api(`/api/directory/resources/${editResourceId}`, { method: 'PATCH', body: JSON.stringify(payload) });
        showToast('Resource updated', 'ok');
      } else {
        await api('/api/directory/resources', { method: 'POST', body: JSON.stringify(payload) });
        showToast('Resource added', 'ok');
      }
      setResourceForm({ ...EMPTY_RESOURCE });
      setEditResourceId(null);
      await loadAll();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section id="section-directory-manage">
      <div className="between" style={{ marginBottom: '1rem' }}>
        <h1 style={{ margin: 0 }}>Directory, Local Resources &amp; FAQs</h1>
        <a href="/directory" target="_blank" rel="noreferrer" className="btn sm">View Public Directory</a>
      </div>

      <div className="tabs">
        <button type="button" className={`btn sm${tab === 'contacts' ? ' active' : ''}`} onClick={() => setTab('contacts')}>
          Staff &amp; Council ({contacts.length})
        </button>
        <button type="button" className={`btn sm${tab === 'resources' ? ' active' : ''}`} onClick={() => setTab('resources')}>
          Local Business &amp; Resources ({resources.length})
        </button>
        <button type="button" className={`btn sm${tab === 'boards' ? ' active' : ''}`} onClick={() => setTab('boards')}>
          Boards &amp; Commissions ({boards.length})
        </button>
        <button type="button" className={`btn sm${tab === 'faqs' ? ' active' : ''}`} onClick={() => setTab('faqs')}>
          Self-Service FAQs ({faqs.length})
        </button>
      </div>

      {tab === 'contacts' && (
        <>
          <div className="card">
            <h2>{editContactId ? 'Edit Directory Entry' : 'Add Staff Member or Council Official'}</h2>
            <form onSubmit={saveContact}>
              <div className="row" style={{ marginBottom: '.75rem' }}>
                <div className="field" style={{ flex: 1, minWidth: 180 }}>
                  <label htmlFor="dir-name">Name *</label>
                  <input id="dir-name" required value={contactForm.name} onChange={(e) => setContactForm((f) => ({ ...f, name: e.target.value }))} />
                </div>
                <div className="field" style={{ flex: 1, minWidth: 180 }}>
                  <label htmlFor="dir-role">Title / Role</label>
                  <input id="dir-role" placeholder="e.g. Mayor, City Clerk, Building Official" value={contactForm.title_role} onChange={(e) => setContactForm((f) => ({ ...f, title_role: e.target.value }))} />
                </div>
                <div className="field" style={{ flex: 1, minWidth: 160 }}>
                  <label htmlFor="dir-dept">Department</label>
                  <input id="dir-dept" placeholder="e.g. City Council, Administration" value={contactForm.department} onChange={(e) => setContactForm((f) => ({ ...f, department: e.target.value }))} />
                </div>
              </div>
              <div className="row" style={{ marginBottom: '.75rem' }}>
                <div className="field" style={{ flex: 1, minWidth: 180 }}>
                  <label htmlFor="dir-email">Email</label>
                  <input id="dir-email" type="email" value={contactForm.email} onChange={(e) => setContactForm((f) => ({ ...f, email: e.target.value }))} />
                </div>
                <div className="field" style={{ flex: 1, minWidth: 150 }}>
                  <label htmlFor="dir-phone">Phone</label>
                  <input id="dir-phone" value={contactForm.phone} onChange={(e) => setContactForm((f) => ({ ...f, phone: e.target.value }))} />
                </div>
                <div className="field" style={{ flex: 1, minWidth: 160 }}>
                  <label htmlFor="dir-hours">Office Hours (optional)</label>
                  <input id="dir-hours" placeholder="e.g. Mon–Thu 8am–4pm" value={contactForm.office_hours} onChange={(e) => setContactForm((f) => ({ ...f, office_hours: e.target.value }))} />
                </div>
                <div className="field" style={{ width: 90 }}>
                  <label htmlFor="dir-sort">Order</label>
                  <input id="dir-sort" type="number" value={contactForm.sort_order} onChange={(e) => setContactForm((f) => ({ ...f, sort_order: e.target.value }))} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap', marginBottom: '.85rem' }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem', cursor: 'pointer', fontSize: '.9rem' }}>
                  <input type="checkbox" style={{ width: 'auto', flexShrink: 0 }} checked={contactForm.is_elected} onChange={(e) => setContactForm((f) => ({ ...f, is_elected: e.target.checked }))} />
                  <span>Elected Official (City Council / Mayor)</span>
                </label>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem', cursor: 'pointer', fontSize: '.9rem' }}>
                  <input type="checkbox" style={{ width: 'auto', flexShrink: 0 }} checked={contactForm.is_public} onChange={(e) => setContactForm((f) => ({ ...f, is_public: e.target.checked }))} />
                  <span>Visible on Public Portal</span>
                </label>
              </div>
              <div className="actions">
                <button type="submit" className="btn primary" disabled={busy}>
                  {busy ? 'Saving…' : (editContactId ? 'Save Contact' : 'Add Contact')}
                </button>
                {editContactId && (
                  <button type="button" className="btn" onClick={() => { setEditContactId(null); setContactForm({ ...EMPTY_CONTACT }); }}>
                    Cancel
                  </button>
                )}
              </div>
            </form>
          </div>

          <div className="card">
            <h2>Directory Entries ({contacts.length})</h2>
            {contacts.length === 0 ? (
              <p className="muted">No directory entries yet.</p>
            ) : (
              <table>
                <thead>
                  <tr><th>Name &amp; Role</th><th>Department</th><th>Contact</th><th>Visibility</th><th style={{ width: 150 }}>Actions</th></tr>
                </thead>
                <tbody>
                  {contacts.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <strong>{c.name}</strong>
                        {c.is_elected && <span className="badge draft" style={{ marginLeft: '.4rem' }}>Council / Elected</span>}
                        {c.title_role && <div className="muted" style={{ fontSize: '.82rem' }}>{c.title_role}</div>}
                      </td>
                      <td>{c.department || '—'}</td>
                      <td style={{ fontSize: '.84rem' }}>
                        {c.email && <div>{c.email}</div>}
                        {c.phone && <div>{c.phone}</div>}
                      </td>
                      <td><span className={`badge ${c.is_public ? 'active' : 'disabled'}`}>{c.is_public ? 'Public' : 'Hidden'}</span></td>
                      <td>
                        <div className="actions">
                          <button type="button" className="btn sm" onClick={() => { setEditContactId(c.id); setContactForm({ ...c }); }}>Edit</button>
                          <button
                            type="button"
                            className="btn sm danger"
                            onClick={async () => {
                              if (!window.confirm(`Remove "${c.name}"?`)) return;
                              await api(`/api/directory/contacts/${c.id}`, { method: 'DELETE' });
                              await loadAll();
                            }}
                          >
                            Remove
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {tab === 'resources' && (
        <>
          <div className="card">
            <h2>{editResourceId ? 'Edit Local Business / Community Resource' : 'Add Local Business or Community Resource'}</h2>
            <form onSubmit={saveResource}>
              <div className="row" style={{ marginBottom: '.75rem' }}>
                <div className="field" style={{ flex: 2, minWidth: 200 }}>
                  <label htmlFor="res-name">Business or Organization Name *</label>
                  <input id="res-name" required placeholder="e.g. Lakeview Hardware & Supply" value={resourceForm.name} onChange={(e) => setResourceForm((f) => ({ ...f, name: e.target.value }))} />
                </div>
                <div className="field" style={{ flex: 1, minWidth: 180 }}>
                  <label htmlFor="res-cat">Category</label>
                  <select id="res-cat" value={resourceForm.category} onChange={(e) => setResourceForm((f) => ({ ...f, category: e.target.value }))}>
                    {RESOURCE_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>
                <div className="field" style={{ width: 90 }}>
                  <label htmlFor="res-sort">Order</label>
                  <input id="res-sort" type="number" value={resourceForm.sort_order} onChange={(e) => setResourceForm((f) => ({ ...f, sort_order: e.target.value }))} />
                </div>
              </div>
              <div className="field" style={{ marginBottom: '.75rem' }}>
                <label htmlFor="res-desc">Description</label>
                <textarea id="res-desc" rows={2} placeholder="Services offered, who they serve, or helpful notes..." value={resourceForm.description} onChange={(e) => setResourceForm((f) => ({ ...f, description: e.target.value }))} />
              </div>
              <div className="row" style={{ marginBottom: '.75rem' }}>
                <div className="field" style={{ flex: 1, minWidth: 180 }}>
                  <label htmlFor="res-addr">Street Address</label>
                  <input id="res-addr" placeholder="e.g. 214 Main Street" value={resourceForm.address} onChange={(e) => setResourceForm((f) => ({ ...f, address: e.target.value }))} />
                </div>
                <div className="field" style={{ flex: 1, minWidth: 150 }}>
                  <label htmlFor="res-phone">Phone</label>
                  <input id="res-phone" value={resourceForm.phone} onChange={(e) => setResourceForm((f) => ({ ...f, phone: e.target.value }))} />
                </div>
                <div className="field" style={{ flex: 1, minWidth: 170 }}>
                  <label htmlFor="res-email">Email</label>
                  <input id="res-email" type="email" value={resourceForm.email} onChange={(e) => setResourceForm((f) => ({ ...f, email: e.target.value }))} />
                </div>
              </div>
              <div className="row" style={{ marginBottom: '.75rem' }}>
                <div className="field" style={{ flex: 1, minWidth: 200 }}>
                  <label htmlFor="res-url">Website URL (https://...)</label>
                  <input id="res-url" placeholder="https://example.com" value={resourceForm.website_url} onChange={(e) => setResourceForm((f) => ({ ...f, website_url: e.target.value }))} />
                </div>
                <div className="field" style={{ flex: 1, minWidth: 180 }}>
                  <label htmlFor="res-hours">Hours</label>
                  <input id="res-hours" placeholder="e.g. Mon–Sat 8am–6pm" value={resourceForm.hours} onChange={(e) => setResourceForm((f) => ({ ...f, hours: e.target.value }))} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap', marginBottom: '.85rem' }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem', cursor: 'pointer', fontSize: '.9rem' }}>
                  <input type="checkbox" style={{ width: 'auto', flexShrink: 0 }} checked={resourceForm.is_featured} onChange={(e) => setResourceForm((f) => ({ ...f, is_featured: e.target.checked }))} />
                  <span>Featured on Public Portal</span>
                </label>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem', cursor: 'pointer', fontSize: '.9rem' }}>
                  <input type="checkbox" style={{ width: 'auto', flexShrink: 0 }} checked={resourceForm.is_public} onChange={(e) => setResourceForm((f) => ({ ...f, is_public: e.target.checked }))} />
                  <span>Visible on Public Portal</span>
                </label>
              </div>
              <div className="actions">
                <button type="submit" className="btn primary" disabled={busy}>
                  {busy ? 'Saving…' : (editResourceId ? 'Save Resource' : 'Add Resource')}
                </button>
                {editResourceId && (
                  <button type="button" className="btn" onClick={() => { setEditResourceId(null); setResourceForm({ ...EMPTY_RESOURCE }); }}>
                    Cancel
                  </button>
                )}
              </div>
            </form>
          </div>

          <div className="card">
            <h2>Local Businesses &amp; Community Resources ({resources.length})</h2>
            {resources.length === 0 ? (
              <p className="muted">No local businesses or community resources added yet.</p>
            ) : (
              <table>
                <thead>
                  <tr><th>Name &amp; Details</th><th>Category</th><th>Contact</th><th>Visibility</th><th style={{ width: 150 }}>Actions</th></tr>
                </thead>
                <tbody>
                  {resources.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <strong>{r.name}</strong>
                        {r.is_featured && <span className="badge draft" style={{ marginLeft: '.4rem' }}>Featured</span>}
                        {r.description && <div className="muted" style={{ fontSize: '.82rem' }}>{r.description}</div>}
                        {r.address && <div className="muted" style={{ fontSize: '.8rem' }}>{r.address}</div>}
                      </td>
                      <td><span className="badge draft">{r.category}</span></td>
                      <td style={{ fontSize: '.84rem' }}>
                        {r.phone && <div>{r.phone}</div>}
                        {r.email && <div>{r.email}</div>}
                        {r.website_url && <div><a href={r.website_url} target="_blank" rel="noreferrer">Website</a></div>}
                      </td>
                      <td><span className={`badge ${r.is_public ? 'active' : 'disabled'}`}>{r.is_public ? 'Public' : 'Hidden'}</span></td>
                      <td>
                        <div className="actions">
                          <button type="button" className="btn sm" onClick={() => { setEditResourceId(r.id); setResourceForm({ ...r }); }}>Edit</button>
                          <button
                            type="button"
                            className="btn sm danger"
                            onClick={async () => {
                              if (!window.confirm(`Remove "${r.name}"?`)) return;
                              await api(`/api/directory/resources/${r.id}`, { method: 'DELETE' });
                              await loadAll();
                            }}
                          >
                            Remove
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {tab === 'boards' && (
        <>
          <div className="card">
            <h2>{editBoardId ? 'Edit Board / Commission Seat' : 'Add Board or Commission Member'}</h2>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!boardForm.board_name.trim()) return;
                setBusy(true);
                try {
                  const payload = { ...boardForm, sort_order: Number(boardForm.sort_order) || 0 };
                  if (editBoardId) {
                    await api(`/api/directory/boards/${editBoardId}`, { method: 'PATCH', body: JSON.stringify(payload) });
                    showToast('Board seat updated', 'ok');
                  } else {
                    await api('/api/directory/boards', { method: 'POST', body: JSON.stringify(payload) });
                    showToast('Board seat added', 'ok');
                  }
                  setBoardForm({ ...EMPTY_BOARD });
                  setEditBoardId(null);
                  await loadAll();
                } catch (err) {
                  showToast(err.message, 'error');
                } finally {
                  setBusy(false);
                }
              }}
            >
              <div className="row" style={{ marginBottom: '.75rem' }}>
                <div className="field" style={{ flex: 1, minWidth: 180 }}>
                  <label>Board / Commission *</label>
                  <input required placeholder="e.g. Planning Commission" value={boardForm.board_name} onChange={(e) => setBoardForm((f) => ({ ...f, board_name: e.target.value }))} />
                </div>
                <div className="field" style={{ flex: 1, minWidth: 160 }}>
                  <label>Seat / Role</label>
                  <input placeholder="e.g. Chair — Seat 1" value={boardForm.seat_name} onChange={(e) => setBoardForm((f) => ({ ...f, seat_name: e.target.value }))} />
                </div>
                <div className="field" style={{ flex: 1, minWidth: 180 }}>
                  <label>Member Name</label>
                  <input placeholder="Leave blank if vacant" value={boardForm.member_name} onChange={(e) => setBoardForm((f) => ({ ...f, member_name: e.target.value }))} />
                </div>
              </div>
              <div className="row" style={{ marginBottom: '.75rem' }}>
                <div className="field" style={{ flex: 1, minWidth: 170 }}>
                  <label>Email</label>
                  <input type="email" value={boardForm.email} onChange={(e) => setBoardForm((f) => ({ ...f, email: e.target.value }))} />
                </div>
                <div className="field" style={{ width: 145 }}>
                  <label>Term Start</label>
                  <input type="date" value={boardForm.term_start} onChange={(e) => setBoardForm((f) => ({ ...f, term_start: e.target.value }))} />
                </div>
                <div className="field" style={{ width: 145 }}>
                  <label>Term End</label>
                  <input type="date" value={boardForm.term_end} onChange={(e) => setBoardForm((f) => ({ ...f, term_end: e.target.value }))} />
                </div>
                <div className="field" style={{ flex: 1, minWidth: 160 }}>
                  <label>Notes</label>
                  <input value={boardForm.notes} onChange={(e) => setBoardForm((f) => ({ ...f, notes: e.target.value }))} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: '1.25rem', marginBottom: '.85rem', flexWrap: 'wrap' }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem', cursor: 'pointer', fontSize: '.9rem' }}>
                  <input type="checkbox" style={{ width: 'auto' }} checked={boardForm.is_vacant} onChange={(e) => setBoardForm((f) => ({ ...f, is_vacant: e.target.checked }))} />
                  <span>Vacant Seat (Seeking Applicants)</span>
                </label>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem', cursor: 'pointer', fontSize: '.9rem' }}>
                  <input type="checkbox" style={{ width: 'auto' }} checked={boardForm.is_public} onChange={(e) => setBoardForm((f) => ({ ...f, is_public: e.target.checked }))} />
                  <span>Visible on Public Portal</span>
                </label>
              </div>
              <div className="actions">
                <button type="submit" className="btn primary" disabled={busy}>{editBoardId ? 'Save Seat' : 'Add Seat'}</button>
                {editBoardId && <button type="button" className="btn" onClick={() => { setEditBoardId(null); setBoardForm({ ...EMPTY_BOARD }); }}>Cancel</button>}
              </div>
            </form>
          </div>
          <div className="card">
            <h2>Boards &amp; Commissions Roster ({boards.length})</h2>
            <table>
              <thead><tr><th>Board &amp; Seat</th><th>Member</th><th>Term</th><th>Actions</th></tr></thead>
              <tbody>
                {boards.map((b) => (
                  <tr key={b.id}>
                    <td><strong>{b.board_name}</strong><div className="muted" style={{ fontSize: '.82rem' }}>{b.seat_name || 'Member'}</div></td>
                    <td>{b.is_vacant ? <span className="badge draft">Vacant Seat</span> : (b.member_name || '—')}</td>
                    <td style={{ fontSize: '.83rem' }}>{b.term_start || '—'} &rarr; {b.term_end || '—'}</td>
                    <td>
                      <div className="actions">
                        <button type="button" className="btn sm" onClick={() => { setEditBoardId(b.id); setBoardForm({ ...b }); }}>Edit</button>
                        <button type="button" className="btn sm danger" onClick={async () => { await api(`/api/directory/boards/${b.id}`, { method: 'DELETE' }); await loadAll(); }}>Remove</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'faqs' && (
        <>
          <div className="card">
            <h2>{editFaqId ? 'Edit FAQ' : 'Add Frequently Asked Question'}</h2>
            <form onSubmit={saveFaq}>
              <div className="row" style={{ marginBottom: '.75rem' }}>
                <div className="field" style={{ flex: 2, minWidth: 220 }}>
                  <label htmlFor="faq-q">Question *</label>
                  <input id="faq-q" required placeholder="e.g. When is brush pickup or garbage day?" value={faqForm.question} onChange={(e) => setFaqForm((f) => ({ ...f, question: e.target.value }))} />
                </div>
                <div className="field" style={{ flex: 1, minWidth: 160 }}>
                  <label htmlFor="faq-cat">Category</label>
                  <input id="faq-cat" placeholder="e.g. General, Permits, Utilities" value={faqForm.category} onChange={(e) => setFaqForm((f) => ({ ...f, category: e.target.value }))} />
                </div>
                <div className="field" style={{ width: 90 }}>
                  <label htmlFor="faq-sort">Order</label>
                  <input id="faq-sort" type="number" value={faqForm.sort_order} onChange={(e) => setFaqForm((f) => ({ ...f, sort_order: e.target.value }))} />
                </div>
              </div>
              <div className="field" style={{ marginBottom: '.75rem' }}>
                <label htmlFor="faq-a">Answer</label>
                <textarea id="faq-a" rows={3} placeholder="Clear answer for residents..." value={faqForm.answer} onChange={(e) => setFaqForm((f) => ({ ...f, answer: e.target.value }))} />
              </div>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem', cursor: 'pointer', fontSize: '.9rem', marginBottom: '.85rem' }}>
                <input type="checkbox" style={{ width: 'auto', flexShrink: 0 }} checked={faqForm.is_public} onChange={(e) => setFaqForm((f) => ({ ...f, is_public: e.target.checked }))} />
                <span>Visible on Public Portal</span>
              </label>
              <div className="actions">
                <button type="submit" className="btn primary" disabled={busy}>
                  {busy ? 'Saving…' : (editFaqId ? 'Save FAQ' : 'Add FAQ')}
                </button>
                {editFaqId && (
                  <button type="button" className="btn" onClick={() => { setEditFaqId(null); setFaqForm({ ...EMPTY_FAQ }); }}>
                    Cancel
                  </button>
                )}
              </div>
            </form>
          </div>

          <div className="card">
            <h2>FAQs ({faqs.length})</h2>
            {faqs.length === 0 ? (
              <p className="muted">No FAQs added yet.</p>
            ) : (
              <table>
                <thead>
                  <tr><th>Question</th><th>Category</th><th>Visibility</th><th style={{ width: 150 }}>Actions</th></tr>
                </thead>
                <tbody>
                  {faqs.map((fq) => (
                    <tr key={fq.id}>
                      <td>
                        <strong>{fq.question}</strong>
                        {fq.answer && <div className="muted" style={{ fontSize: '.82rem' }}>{fq.answer}</div>}
                      </td>
                      <td><span className="badge draft">{fq.category}</span></td>
                      <td><span className={`badge ${fq.is_public ? 'active' : 'disabled'}`}>{fq.is_public ? 'Public' : 'Hidden'}</span></td>
                      <td>
                        <div className="actions">
                          <button type="button" className="btn sm" onClick={() => { setEditFaqId(fq.id); setFaqForm({ ...fq }); }}>Edit</button>
                          <button
                            type="button"
                            className="btn sm danger"
                            onClick={async () => {
                              if (!window.confirm(`Delete FAQ "${fq.question}"?`)) return;
                              await api(`/api/directory/faqs/${fq.id}`, { method: 'DELETE' });
                              await loadAll();
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </section>
  );
}
