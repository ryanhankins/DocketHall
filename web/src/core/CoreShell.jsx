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

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ROLE_LABELS, api, downloadBackupArchive, hasPermission, todayIso } from './api.js';
import { loadEnabledFrontendModules } from './registry.js';
import { useToast } from './toast.jsx';

const UsersPage = React.lazy(() => import('./UsersPage.jsx'));
const ModulesPage = React.lazy(() => import('./ModulesPage.jsx'));
const GeneralPrefsPage = React.lazy(() => import('./GeneralPrefsPage.jsx'));
const BackupRestorePage = React.lazy(() => import('./BackupRestorePage.jsx'));

export default function CoreShell() {
  const [me, setMe] = useState(null);
  const [modulesMeta, setModulesMeta] = useState([]);
  const [permissionsCatalog, setPermissionsCatalog] = useState([]);
  const [frontendMods, setFrontendMods] = useState({});
  const [branding, setBranding] = useState({ cityTitle: '', hasLogo: false, logoVer: Date.now() });
  const [backupStatus, setBackupStatus] = useState({ overdue: false, reminder_days: 0, days_since_backup: 0, last_backup_at: null });
  const [backlogDueCount, setBacklogDueCount] = useState(0);
  const [hash, setHash] = useState(() => location.hash.replace(/^#/, ''));
  const [openSubmenus, setOpenSubmenus] = useState({ 'agenda-management': true, preferences: false });

  // Change password modal
  const [pwOpen, setPwOpen] = useState(false);
  const [curPw, setCurPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwMsg, setPwMsg] = useState({ text: '', isError: false });
  const pwDlgRef = useRef(null);
  const showToast = useToast();

  const applyBranding = useCallback(({ cityTitle, hasLogo, logoVer }) => {
    const t = (cityTitle || '').trim();
    setBranding(prev => ({
      cityTitle: t,
      hasLogo: hasLogo ?? prev.hasLogo,
      logoVer: logoVer ?? prev.logoVer,
    }));
    document.title = t ? `${t} - CivicDesk` : 'CivicDesk';
  }, []);

  const refreshBackupBanner = useCallback(async () => {
    try {
      const st = await api('/api/backup/status');
      setBackupStatus(st);
    } catch {
      setBackupStatus(prev => ({ ...prev, overdue: false }));
    }
  }, []);

  const updateBacklogCount = useCallback((items) => {
    const today = todayIso();
    const cnt = (Array.isArray(items) ? items : []).filter(
      it => it.todo_status !== 'done' && ((it.target_date && it.target_date <= today) || it.recurrence === 'every_agenda'),
    ).length;
    setBacklogDueCount(cnt);
  }, []);

  useEffect(() => {
    const onHashChange = () => setHash(location.hash.replace(/^#/, ''));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const reloadModules = useCallback(async () => {
    const modResp = await api('/api/modules');
    const mods = Array.isArray(modResp.modules) ? modResp.modules : [];
    setModulesMeta(mods);
    setPermissionsCatalog(Array.isArray(modResp.permissions_catalog) ? modResp.permissions_catalog : []);
    const loaded = await loadEnabledFrontendModules(mods.map(m => m.id));
    setFrontendMods(loaded);
  }, []);

  useEffect(() => {
    (async () => {
      const [user, modResp, brand] = await Promise.all([
        api('/api/me'),
        api('/api/modules'),
        api('/api/branding').catch(() => ({ city_title: '', has_city_logo: false })),
      ]);
      setMe(user);
      const mods = Array.isArray(modResp.modules) ? modResp.modules : [];
      setModulesMeta(mods);
      setPermissionsCatalog(Array.isArray(modResp.permissions_catalog) ? modResp.permissions_catalog : []);
      applyBranding({
        cityTitle: brand.city_title || '',
        hasLogo: !!brand.has_city_logo,
        logoVer: Date.now(),
      });

      const loaded = await loadEnabledFrontendModules(mods.map(m => m.id));
      setFrontendMods(loaded);

      if (hasPermission(user, 'settings.manage') || hasPermission(user, 'agendas.manage')) {
        refreshBackupBanner();
      }
      if (hasPermission(user, 'agendas.manage')) {
        api('/api/agendas/backlog').then(updateBacklogCount).catch(() => {});
      }
    })().catch(() => {});
  }, [applyBranding, refreshBackupBanner, updateBacklogCount]);

  useEffect(() => {
    const dlg = pwDlgRef.current;
    if (!dlg) return;
    if (pwOpen && !dlg.open) dlg.showModal();
    if (!pwOpen && dlg.open) dlg.close();
  }, [pwOpen]);

  const navigate = useCallback((targetHash) => {
    const clean = targetHash.startsWith('#') ? targetHash : `#${targetHash}`;
    if (location.hash !== clean) history.pushState(null, '', clean);
    setHash(clean.replace(/^#/, ''));
  }, []);

  const canManageSettings = hasPermission(me, 'settings.manage') || hasPermission(me, 'agendas.manage');
  const isAdmin = me?.role === 'admin';

  // Collect all module preference submenu items
  const prefNavItems = useMemo(() => {
    const items = [];
    if (canManageSettings) {
      items.push({ section: 'preferences-general', label: 'General Preferences' });
    }
    for (const mod of Object.values(frontendMods)) {
      for (const it of (mod.prefNavItems || [])) {
        if (!it.permission || hasPermission(me, it.permission)) {
          items.push(it);
        }
      }
    }
    if (canManageSettings) {
      items.push({ section: 'preferences-backup', label: 'Backup & Restore' });
    }
    return items;
  }, [canManageSettings, frontendMods, me]);

  // Auto-open submenu when active route belongs to it
  useEffect(() => {
    if (hash.startsWith('agendas') || hash === 'backlog') {
      setOpenSubmenus(prev => (prev['agenda-management'] ? prev : { ...prev, 'agenda-management': true }));
    }
    if (hash.startsWith('preferences') || hash === 'permits-catalog-admin') {
      setOpenSubmenus(prev => (prev.preferences ? prev : { ...prev, preferences: true }));
    }
  }, [hash]);

  // Resolve active route
  const resolved = useMemo(() => {
    if (!me) return null;
    if (hash === 'users' && isAdmin) {
      return { component: UsersPage, props: { me, permissionsCatalog }, activeSection: 'users' };
    }
    if (hash === 'modules' && isAdmin) {
      return { component: ModulesPage, props: { onModulesChanged: reloadModules }, activeSection: 'modules' };
    }
    if (hash === 'preferences-general' && canManageSettings) {
      return {
        component: GeneralPrefsPage,
        props: { onBrandingChange: applyBranding },
        activeSection: 'preferences-general',
      };
    }
    if (hash === 'preferences-backup' && canManageSettings) {
      return {
        component: BackupRestorePage,
        props: {
          reminderDays: backupStatus.reminder_days,
          onRefreshBackupBanner: refreshBackupBanner,
          onRestored: async () => {
            const b = await api('/api/branding').catch(() => null);
            if (b) applyBranding({ cityTitle: b.city_title || '', hasLogo: !!b.has_city_logo, logoVer: Date.now() });
            await refreshBackupBanner();
          },
        },
        activeSection: 'preferences-backup',
      };
    }
    for (const mod of Object.values(frontendMods)) {
      for (const r of (mod.routes || [])) {
        if (r.permission && !hasPermission(me, r.permission)) continue;
        const params = r.match(hash);
        if (params) {
          const activeSection = hash.startsWith('agendas/')
            ? 'agendas'
            : (hash === 'preferences'
                ? 'preferences-agenda'
                : (hash === 'permits-catalog-admin' ? 'preferences-permits' : hash));
          return {
            component: r.component,
            props: {
              ...params,
              me,
              onNavigate: navigate,
              onBacklogCount: updateBacklogCount,
            },
            activeSection,
          };
        }
      }
    }
    return null;
  }, [me, hash, isAdmin, canManageSettings, permissionsCatalog, applyBranding, backupStatus.reminder_days, refreshBackupBanner, frontendMods, navigate, updateBacklogCount]);

  // Fallback redirect if hash doesn't match any accessible route
  useEffect(() => {
    if (!me || resolved || Object.keys(frontendMods).length === 0) return;
    let fallback = '';
    if (isAdmin) fallback = 'users';
    else {
      for (const m of modulesMeta) {
        const first = m.nav_groups?.[0]?.items?.[0]?.section;
        if (first) { fallback = first; break; }
      }
    }
    if (fallback && hash !== fallback) {
      history.replaceState(null, '', `#${fallback}`);
      setHash(fallback);
    }
  }, [me, resolved, frontendMods, isAdmin, modulesMeta, hash]);

  const ActiveComponent = resolved?.component;
  const activeSection = resolved?.activeSection || '';

  return (
    <>
      <header>
        <div className="brand" style={{ display: 'flex', alignItems: 'center', gap: '.55rem' }}>
          {branding.hasLogo && (
            <img
              id="brand-logo"
              alt="City Logo"
              src={`/api/branding/logo?t=${branding.logoVer}`}
              style={{ height: '64px', width: 'auto', borderRadius: '4px', objectFit: 'contain' }}
              onError={(e) => { e.currentTarget.hidden = true; }}
            />
          )}
          {branding.cityTitle && <span id="brand-city-title">{branding.cityTitle}</span>}
          <span>CivicDesk</span>
        </div>
        <div className="user-bar">
          <span id="whoami">
            {me ? `${me.username} (${ROLE_LABELS[me.role] || me.role})` : ''}
          </span>
          <button
            type="button"
            className="btn sm"
            onClick={() => {
              setCurPw(''); setNewPw(''); setConfirmPw(''); setPwMsg({ text: '', isError: false });
              setPwOpen(true);
            }}
          >
            Change Password
          </button>
          <button
            type="button"
            className="btn sm"
            onClick={async () => {
              await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' });
              location.replace('/');
            }}
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="shell">
        {me && (
          <nav id="menu">
            {isAdmin && (
              <div id="menu-admin">
                <h2>Admin</h2>
                <button
                  type="button"
                  className={activeSection === 'users' ? 'active' : ''}
                  onClick={() => navigate('#users')}
                >
                  Manage Users
                </button>
                <button
                  type="button"
                  className={activeSection === 'modules' ? 'active' : ''}
                  onClick={() => navigate('#modules')}
                >
                  Manage Modules
                </button>
              </div>
            )}

            {modulesMeta.map(mod => {
              if (!mod.nav_groups?.length) return null;
              return (
                <div key={mod.id}>
                  <h2>{mod.name}</h2>
                  {mod.nav_groups.map(grp => {
                    if (grp.items.length === 1) {
                      const it = grp.items[0];
                      return (
                        <button
                          key={it.section}
                          type="button"
                          className={activeSection === it.section ? 'active' : ''}
                          onClick={() => navigate(`#${it.section}`)}
                        >
                          {it.label}
                        </button>
                      );
                    }
                    const isOpen = !!openSubmenus[grp.id];
                    return (
                      <div key={grp.id} className="nav-group">
                        <button
                          type="button"
                          className="nav-parent"
                          aria-expanded={isOpen}
                          onClick={() => setOpenSubmenus(prev => ({ ...prev, [grp.id]: !prev[grp.id] }))}
                        >
                          <span>{grp.label}</span>
                          <span className="nav-arrow" aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
                        </button>
                        {isOpen && (
                          <div className="nav-submenu">
                            {grp.items.map(it => (
                              <button
                                key={it.section}
                                type="button"
                                className={activeSection === it.section ? 'active' : ''}
                                onClick={() => navigate(`#${it.section}`)}
                              >
                                {it.label}
                                {it.badge === 'backlog' && backlogDueCount > 0 && (
                                  <> <span className="badge draft">{backlogDueCount}</span></>
                                )}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}

            {prefNavItems.length > 0 && (
              <div>
                <h2>System</h2>
                <div className="nav-group">
                  <button
                    type="button"
                    className="nav-parent"
                    aria-expanded={!!openSubmenus.preferences}
                    onClick={() => setOpenSubmenus(prev => ({ ...prev, preferences: !prev.preferences }))}
                  >
                    <span>Preferences</span>
                    <span className="nav-arrow" aria-hidden="true">{openSubmenus.preferences ? '▾' : '▸'}</span>
                  </button>
                  {openSubmenus.preferences && (
                    <div className="nav-submenu">
                      {prefNavItems.map(it => (
                        <button
                          key={it.section}
                          type="button"
                          className={activeSection === it.section ? 'active' : ''}
                          onClick={() => navigate(`#${it.section}`)}
                        >
                          {it.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </nav>
        )}

        <main>
          {backupStatus.overdue && canManageSettings && (
            <div className="banner show" role="alert" style={{ background: '#fef2f2', borderColor: '#fca5a5', color: '#991b1b', marginBottom: '1rem' }}>
              <span>
                {backupStatus.last_backup_at
                  ? `Backup reminder: Last backup was ${backupStatus.days_since_backup} day(s) ago (interval: every ${backupStatus.reminder_days} days).`
                  : `Backup reminder: No backup has been downloaded yet (interval: every ${backupStatus.reminder_days} days).`}
              </span>
              <button
                type="button"
                className="btn sm primary"
                onClick={() => downloadBackupArchive(refreshBackupBanner, showToast).catch(e => showToast(e.message, 'error'))}
              >
                Download Backup Now
              </button>
            </div>
          )}

          {ActiveComponent ? (
            <Suspense fallback={<div className="muted">Loading…</div>}>
              <ActiveComponent {...resolved.props} />
            </Suspense>
          ) : me ? (
            <div className="card">
              <h1>Welcome</h1>
              <p className="muted">You are signed in as a read-only user. No management actions are available for your account.</p>
            </div>
          ) : (
            <div className="muted">Loading…</div>
          )}
        </main>
      </div>

      <dialog ref={pwDlgRef} onCancel={(e) => { e.preventDefault(); setPwOpen(false); }}>
        <h2>Change Password</h2>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setPwMsg({ text: '', isError: true });
            if (newPw !== confirmPw) {
              setPwMsg({ text: 'New passwords do not match.', isError: true });
              return;
            }
            try {
              await api('/api/change-password', {
                method: 'POST',
                body: JSON.stringify({ current_password: curPw, new_password: newPw }),
              });
              setCurPw(''); setNewPw(''); setConfirmPw('');
              setPwMsg({ text: 'Password updated.', isError: false });
            } catch (err) {
              setPwMsg({ text: err.message, isError: true });
            }
          }}
        >
          <div className="field">
            <label htmlFor="cur-pw">Current password</label>
            <input id="cur-pw" type="password" required autoComplete="current-password" value={curPw} onChange={(e) => setCurPw(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="new-pw">New password (min 8 chars)</label>
            <input id="new-pw" type="password" required minLength={8} autoComplete="new-password" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="confirm-pw">Confirm new password</label>
            <input id="confirm-pw" type="password" required minLength={8} autoComplete="new-password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} />
          </div>
          {pwMsg.text && <div className={pwMsg.isError ? 'error-msg' : 'ok-msg'} role="alert">{pwMsg.text}</div>}
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={() => setPwOpen(false)}>Close</button>
            <button type="submit" className="btn primary">Update Password</button>
          </div>
        </form>
      </dialog>
    </>
  );
}
