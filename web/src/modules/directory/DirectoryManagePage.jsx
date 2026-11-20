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

export default function DirectoryManagePage() {
  const [tab, setTab] = useState('contacts');
  const [contacts, setContacts] = useState([]);
  const [faqs, setFaqs] = useState([]);

  const [contactForm, setContactForm] = useState({ ...EMPTY_CONTACT });
  const [editContactId, setEditContactId] = useState(null);

  const [faqForm, setFaqForm] = useState({ ...EMPTY_FAQ });
  const [editFaqId, setEditFaqId] = useState(null);

  const [busy, setBusy] = useState(false);
  const showToast = useToast();

  const loadAll = useCallback(async () => {
    const [cRows, fRows] = await Promise.all([
      api('/api/directory/contacts'),
      api('/api/directory/faqs'),
    ]);
    setContacts(Array.isArray(cRows) ? cRows : []);
    setFaqs(Array.isArray(fRows) ? fRows : []);
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

  return (
    <section id="section-directory-manage">
      <div className="between" style={{ marginBottom: '1rem' }}>
        <h1 style={{ margin: 0 }}>Staff &amp; Council Directory + FAQs</h1>
        <a href="/#directory" target="_blank" rel="noreferrer" className="btn sm">View Public Directory &amp; FAQs</a>
      </div>

      <div className="tabs">
        <button type="button" className={`btn sm${tab === 'contacts' ? ' active' : ''}`} onClick={() => setTab('contacts')}>
          Staff &amp; Council ({contacts.length})
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
