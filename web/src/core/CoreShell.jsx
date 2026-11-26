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
import ServiceIcon from './ServiceIcon.jsx';
import { DemoBanner, DocketHallLogo } from './PublicChrome.jsx';
import AiAssistantBar from './AiAssistantBar.jsx';
import { applyTheme } from './theme.js';
import { useToast } from './toast.jsx';

const UsersPage = React.lazy(() => import('./UsersPage.jsx'));
const ModulesPage = React.lazy(() => import('./ModulesPage.jsx'));
const IntegrationsPage = React.lazy(() => import('./IntegrationsPage.jsx'));
const AuditLogPage = React.lazy(() => import('./AuditLogPage.jsx'));
const GeneralPrefsPage = React.lazy(() => import('./GeneralPrefsPage.jsx'));
const BackupRestorePage = React.lazy(() => import('./BackupRestorePage.jsx'));
const HelpDocsPage = React.lazy(() => import('./HelpDocsPage.jsx'));
const MyAccountPage = React.lazy(() => import('./MyAccountPage.jsx'));
const BillingManagePage = React.lazy(() => import('./BillingManagePage.jsx'));
const SlaEscalationPage = React.lazy(() => import('./SlaEscalationPage.jsx'));
const BlogManagePage = React.lazy(() => import('../modules/blog/BlogManagePage.jsx'));

function getWorkspaceRoute() {
  const p = location.pathname || '';
  if (p.startsWith('/app/')) {
    return p.slice('/app/'.length).replace(/^\/+/, '') + (location.search || '');
  }
  return (location.hash || '').replace(/^#/, '');
}

export default function CoreShell() {
  const [me, setMe] = useState(null);
  const [modulesMeta, setModulesMeta] = useState([]);
  const [permissionsCatalog, setPermissionsCatalog] = useState([]);
  const [frontendMods, setFrontendMods] = useState({});
  const [branding, setBranding] = useState({ cityTitle: '', hasLogo: false, logoVer: Date.now(), demoMode: false });
  const [backupStatus, setBackupStatus] = useState({ overdue: false, reminder_days: 0, days_since_backup: 0, last_backup_at: null });
  const [backlogDueCount, setBacklogDueCount] = useState(0);
  const [hash, setHash] = useState(() => getWorkspaceRoute());
  const [menuFilter, setMenuFilter] = useState('');
  const [navView, setNavView] = useState(() => {
    try {
      const saved = localStorage.getItem('dockethall.navView');
      if (saved === 'staff' || saved === 'member') return saved;
    } catch { /* ignore storage errors */ }
    return 'staff';
  });
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [openSubmenus, setOpenSubmenus] = useState(() => {
    try {
      const saved = localStorage.getItem('dockethall.openSubmenus');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch { /* ignore storage errors */ }
    return {};
  });

  useEffect(() => {
    try {
      localStorage.setItem('dockethall.openSubmenus', JSON.stringify(openSubmenus));
    } catch { /* ignore storage errors */ }
  }, [openSubmenus]);

  useEffect(() => {
    try {
      localStorage.setItem('dockethall.navView', navView);
    } catch { /* ignore storage errors */ }
  }, [navView]);

  const { staffModuleMenus, memberModuleMenus } = useMemo(() => {
    const buildMenus = (predicate) => modulesMeta
      .map(mod => ({
        id: mod.id,
        name: mod.name,
        items: (mod.nav_groups || []).filter(predicate).flatMap(grp => grp.items || []),
      }))
      .filter(mod => mod.items.length > 0);
    return {
      staffModuleMenus: buildMenus(grp => grp.section_title === 'Staff'),
      memberModuleMenus: buildMenus(grp => grp.section_title !== 'Staff'),
    };
  }, [modulesMeta]);

  const isAdmin = me?.role === 'admin';
  const canManageSettings = hasPermission(me, 'settings.manage') || hasPermission(me, 'agendas.manage');
  const canManageBlog = hasPermission(me, 'blog.manage');
  const hasStaffView = staffModuleMenus.length > 0 || isAdmin || canManageSettings || canManageBlog;
  const hasMemberView = memberModuleMenus.length > 0;
  const effectiveNavView = (hasStaffView && hasMemberView)
    ? navView
    : (hasStaffView ? 'staff' : 'member');
  const moduleMenus = effectiveNavView === 'staff' ? staffModuleMenus : memberModuleMenus;

  const collapsibleGroupIds = useMemo(
    () => moduleMenus.filter(m => m.items.length > 1).map(m => m.id),
    [moduleMenus],
  );

  const allGroupsOpen = collapsibleGroupIds.length > 0 && collapsibleGroupIds.every(id => !!openSubmenus[id]);

  // Change password modal
  const [pwOpen, setPwOpen] = useState(false);
  const [curPw, setCurPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwMsg, setPwMsg] = useState({ text: '', isError: false });
  const pwDlgRef = useRef(null);
  const showToast = useToast();

  const applyBranding = useCallback(({ cityTitle, hasLogo, logoVer, demoMode }) => {
    const t = (cityTitle || '').trim();
    setBranding(prev => ({
      cityTitle: t,
      hasLogo: hasLogo ?? prev.hasLogo,
      logoVer: logoVer ?? prev.logoVer,
      demoMode: demoMode ?? prev.demoMode,
    }));
    document.title = t ? `${t} - DocketHall` : 'DocketHall';
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
    if (location.pathname === '/app' && location.hash) {
      const clean = location.hash.replace(/^#/, '');
      if (clean) {
        history.replaceState(null, '', `/app/${clean}`);
        setHash(clean);
      }
    }
    const onRouteChange = () => setHash(getWorkspaceRoute());
    window.addEventListener('popstate', onRouteChange);
    window.addEventListener('hashchange', onRouteChange);
    return () => {
      window.removeEventListener('popstate', onRouteChange);
      window.removeEventListener('hashchange', onRouteChange);
    };
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
        demoMode: !!brand.demo_mode,
      });
      applyTheme(brand);

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
    const clean = String(targetHash || '').replace(/^\/app\/?/, '').replace(/^#/, '');
    const nextUrl = clean ? `/app/${clean}` : '/app';
    const curUrl = `${location.pathname}${location.search}`;
    if (curUrl !== nextUrl) history.pushState(null, '', nextUrl);
    setHash(clean);
    setMobileNavOpen(false);
  }, []);

  // Auto-open submenu when active route belongs to it
  useEffect(() => {
    const routePath = hash.split('?')[0];
    if (routePath.startsWith('agendas') || routePath === 'backlog' || routePath === 'preferences-agenda' || routePath === 'preferences') {
      setOpenSubmenus(prev => (prev['agenda-management'] ? prev : { ...prev, 'agenda-management': true }));
    }
    if (routePath.startsWith('permits-review') || routePath === 'preferences-permits' || routePath === 'permits-catalog-admin') {
      setOpenSubmenus(prev => (prev['permits-staff'] ? prev : { ...prev, 'permits-staff': true }));
    }
    if (routePath.startsWith('complaints-manage') || routePath === 'preferences-complaints') {
      setOpenSubmenus(prev => (prev['complaints-staff'] ? prev : { ...prev, 'complaints-staff': true }));
    }
    if (routePath === 'calendar-manage' || routePath === 'preferences-calendar') {
      setOpenSubmenus(prev => (prev['calendar-staff'] ? prev : { ...prev, 'calendar-staff': true }));
    }
    if (['users', 'modules', 'preferences-general', 'blog-admin', 'integrations', 'audit', 'preferences-backup', 'billing', 'sla-rules'].includes(routePath)) {
      setOpenSubmenus(prev => (prev['admin-section'] ? prev : { ...prev, 'admin-section': true }));
    }
  }, [hash]);

  // Resolve active route
  const resolved = useMemo(() => {
    if (!me) return null;
    const routePath = hash.split('?')[0];
    if (routePath === 'users' && isAdmin) {
      return { component: UsersPage, props: { me, permissionsCatalog }, activeSection: 'users' };
    }
    if (routePath === 'modules' && isAdmin) {
      return { component: ModulesPage, props: { onModulesChanged: reloadModules }, activeSection: 'modules' };
    }
    if (routePath === 'integrations' && isAdmin) {
      return { component: IntegrationsPage, props: {}, activeSection: 'integrations' };
    }
    if (routePath === 'audit' && isAdmin) {
      return { component: AuditLogPage, props: {}, activeSection: 'audit' };
    }
    if (routePath === 'preferences-general' && canManageSettings) {
      return {
        component: GeneralPrefsPage,
        props: { onBrandingChange: applyBranding },
        activeSection: 'preferences-general',
      };
    }
    if (routePath === 'blog-admin' && canManageBlog) {
      return {
        component: BlogManagePage,
        props: { initialTab: 'settings' },
        activeSection: 'blog-admin',
      };
    }
    if (routePath === 'sla-rules' && canManageSettings) {
      return {
        component: SlaEscalationPage,
        props: { onNavigate: navigate },
        activeSection: 'sla-rules',
      };
    }
    if (routePath === 'preferences-backup' && canManageSettings) {
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
    if (routePath === 'help' || routePath === 'docs') {
      return {
        component: HelpDocsPage,
        props: { me },
        activeSection: 'help',
      };
    }
    if (routePath === 'my-account') {
      return {
        component: MyAccountPage,
        props: { me, onNavigate: navigate },
        activeSection: 'my-account',
      };
    }
    if (routePath === 'billing' && canManageSettings) {
      return {
        component: BillingManagePage,
        props: {},
        activeSection: 'billing',
      };
    }
    for (const mod of Object.values(frontendMods)) {
      for (const r of (mod.routes || [])) {
        if (r.permission && !hasPermission(me, r.permission)) continue;
        const params = r.match(hash);
        if (params) {
          const activeSection = (routePath.startsWith('agendas/') || routePath === 'backlog')
            ? 'agendas'
            : (routePath.startsWith('complaints-manage/')
                ? 'complaints-manage'
                : (routePath.startsWith('permits-review/')
                    ? 'permits-review'
                    : (routePath.startsWith('my-permits/')
                        ? 'my-permits'
                        : (routePath === 'preferences'
                            ? 'preferences-agenda'
                            : (routePath === 'permits-catalog-admin' ? 'preferences-permits' : routePath)))));
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
    if (me.role === 'applicant' || me.role === 'read_only') {
      fallback = 'my-account';
    } else if (isAdmin) {
      fallback = 'users';
    } else {
      for (const m of modulesMeta) {
        const first = m.nav_groups?.[0]?.items?.[0]?.section;
        if (first) { fallback = first; break; }
      }
      if (!fallback) fallback = 'my-account';
    }
    if (fallback && hash !== fallback) {
      history.replaceState(null, '', `/app/${fallback}`);
      setHash(fallback);
    }
  }, [me, resolved, frontendMods, isAdmin, modulesMeta, hash]);

  const ActiveComponent = resolved?.component;
  const activeSection = resolved?.activeSection || '';

  return (
    <>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <DemoBanner demoMode={branding.demoMode} />
      <header>
        <a
          href="/"
          className="brand"
          style={{ display: 'flex', alignItems: 'center', gap: '.55rem', textDecoration: 'none', color: 'inherit' }}
          title="Go to main page"
        >
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
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem' }}>
            <DocketHallLogo size={24} />
            <span>DocketHall</span>
          </span>
        </a>
        <div className="user-bar">
          {me && (
            <button
              type="button"
              className="btn sm mobile-menu-toggle"
              aria-expanded={mobileNavOpen}
              aria-controls="menu"
              onClick={() => setMobileNavOpen(v => !v)}
            >
              {mobileNavOpen ? '✕ Close' : '☰ Menu'}
            </button>
          )}
          <span id="whoami">
            {me ? `${me.username} (${ROLE_LABELS[me.role] || me.role})` : ''}
          </span>
          {me && (
            <button
              type="button"
              className={`btn sm${activeSection === 'help' ? ' primary' : ''}`}
              onClick={() => navigate('help')}
              title="Open DocketHall User Guide & Documentation"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem' }}
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                <path d="M12 17h.01" />
              </svg>
              <span>Help</span>
            </button>
          )}
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
          <nav id="menu" className={mobileNavOpen ? 'mobile-open' : ''}>
            {hasStaffView && hasMemberView && (
              <div
                role="tablist"
                aria-label="Workspace view"
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '.25rem',
                  padding: '.25rem',
                  background: '#f1f5f9',
                  borderRadius: '8px',
                  marginBottom: '.55rem',
                }}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={effectiveNavView === 'staff'}
                  onClick={() => setNavView('staff')}
                  style={{
                    margin: 0,
                    padding: '.35rem .4rem',
                    fontSize: '.78rem',
                    fontWeight: effectiveNavView === 'staff' ? 700 : 500,
                    borderRadius: '6px',
                    border: 'none',
                    textAlign: 'center',
                    background: effectiveNavView === 'staff' ? '#fff' : 'transparent',
                    color: effectiveNavView === 'staff' ? '#0f172a' : '#475569',
                    boxShadow: effectiveNavView === 'staff' ? '0 1px 2px rgba(15,23,42,.08)' : 'none',
                    cursor: 'pointer',
                  }}
                >
                  Staff / Admin
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={effectiveNavView === 'member'}
                  onClick={() => setNavView('member')}
                  style={{
                    margin: 0,
                    padding: '.35rem .4rem',
                    fontSize: '.78rem',
                    fontWeight: effectiveNavView === 'member' ? 700 : 500,
                    borderRadius: '6px',
                    border: 'none',
                    textAlign: 'center',
                    background: effectiveNavView === 'member' ? '#fff' : 'transparent',
                    color: effectiveNavView === 'member' ? '#0f172a' : '#475569',
                    boxShadow: effectiveNavView === 'member' ? '0 1px 2px rgba(15,23,42,.08)' : 'none',
                    cursor: 'pointer',
                  }}
                >
                  Resident / Member
                </button>
              </div>
            )}
            {(effectiveNavView === 'member' || !hasStaffView) && (
              <div style={{ marginBottom: '.45rem', paddingBottom: '.45rem', borderBottom: '1px solid #e2e8f0' }}>
                <button
                  type="button"
                  className={activeSection === 'my-account' ? 'active' : ''}
                  onClick={() => navigate('#my-account')}
                >
                  My Civic Account
                </button>
              </div>
            )}
            {(moduleMenus.reduce((acc, m) => acc + m.items.length, 0) >= 6 || isAdmin || canManageSettings || canManageBlog) && (
              <input
                type="search"
                className="nav-filter"
                aria-label="Filter navigation menu"
                placeholder="Filter menu..."
                value={menuFilter}
                onChange={(e) => setMenuFilter(e.target.value)}
              />
            )}
            {collapsibleGroupIds.length >= 2 && !menuFilter.trim() && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '0 .4rem .25rem' }}>
                <span style={{ fontSize: '.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#64748b' }}>
                  Modules
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const nextVal = !allGroupsOpen;
                    setOpenSubmenus(prev => {
                      const next = { ...prev };
                      for (const id of collapsibleGroupIds) next[id] = nextVal;
                      return next;
                    });
                  }}
                  style={{
                    width: 'auto',
                    background: 'none',
                    border: 'none',
                    padding: '2px 4px',
                    margin: 0,
                    fontSize: '.74rem',
                    fontWeight: 500,
                    color: '#64748b',
                    cursor: 'pointer',
                  }}
                >
                  {allGroupsOpen ? 'Collapse all' : 'Expand all'}
                </button>
              </div>
            )}
            {moduleMenus.map(mod => {
              const q = menuFilter.trim().toLowerCase();
              const modMatches = !q || mod.name.toLowerCase().includes(q);
              const visibleItems = q
                ? (modMatches ? mod.items : mod.items.filter(it => it.label.toLowerCase().includes(q)))
                : mod.items;
              if (visibleItems.length === 0) return null;

              if (mod.items.length === 1) {
                const it = visibleItems[0];
                return (
                  <button
                    key={mod.id}
                    type="button"
                    className={activeSection === it.section ? 'active' : ''}
                    onClick={() => navigate(`#${it.section}`)}
                    title={it.label}
                  >
                    <ServiceIcon id={mod.id} size={15} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{mod.name}</span>
                  </button>
                );
              }

              const hasActiveChild = mod.items.some(it => it.section === activeSection);
              const isOpen = q ? true : (openSubmenus[mod.id] !== undefined ? !!openSubmenus[mod.id] : hasActiveChild);
              return (
                <div key={mod.id} className="nav-group">
                  <button
                    type="button"
                    className="nav-parent"
                    aria-expanded={isOpen}
                    onClick={() => setOpenSubmenus(prev => ({ ...prev, [mod.id]: !isOpen }))}
                    title={mod.name}
                  >
                    <span className="nav-parent-label">
                      <ServiceIcon id={mod.id} size={15} />
                      <span>{mod.name}</span>
                    </span>
                    <span className="nav-arrow" aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
                  </button>
                  {isOpen && (
                    <div className="nav-submenu">
                      {visibleItems.map(it => (
                        <button
                          key={it.section}
                          type="button"
                          className={activeSection === it.section ? 'active' : ''}
                          onClick={() => navigate(`#${it.section}`)}
                        >
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.label}</span>
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

            {effectiveNavView === 'staff' && (isAdmin || canManageSettings || canManageBlog) && (() => {
              const adminItems = [
                isAdmin && { section: 'users', label: 'Manage Users' },
                isAdmin && { section: 'modules', label: 'Manage Modules' },
                canManageSettings && { section: 'preferences-general', label: 'General & Branding' },
                canManageBlog && { section: 'blog-admin', label: 'Blog Settings & Feed' },
                isAdmin && { section: 'integrations', label: 'Email & Integrations' },
                isAdmin && { section: 'audit', label: 'Audit Log' },
                canManageSettings && { section: 'billing', label: 'Utility Bills & Citations' },
                canManageSettings && { section: 'sla-rules', label: 'SLA & Escalations' },
                canManageSettings && { section: 'preferences-backup', label: 'Backup & Restore' },
              ].filter(Boolean);
              const q = menuFilter.trim().toLowerCase();
              const visibleAdmin = q
                ? ('administration'.includes(q) ? adminItems : adminItems.filter(it => it.label.toLowerCase().includes(q)))
                : adminItems;
              if (visibleAdmin.length === 0) return null;
              const adminActive = adminItems.some(it => it.section === activeSection);
              const adminOpen = q ? true : (openSubmenus['admin-section'] !== undefined ? !!openSubmenus['admin-section'] : adminActive);
              return (
                <div id="menu-admin" style={{ borderTop: '1px solid #e2e8f0', paddingTop: '.55rem', marginTop: '.4rem' }}>
                  <button
                    type="button"
                    className="nav-parent"
                    aria-expanded={adminOpen}
                    onClick={() => setOpenSubmenus(prev => ({ ...prev, 'admin-section': !adminOpen }))}
                    style={{ fontWeight: 700, fontSize: '.76rem', textTransform: 'uppercase', letterSpacing: '.05em', color: '#475569' }}
                  >
                    <span>Administration</span>
                    <span className="nav-arrow" aria-hidden="true">{adminOpen ? '▾' : '▸'}</span>
                  </button>
                  {adminOpen && (
                    <div className="nav-submenu">
                      {visibleAdmin.map(it => (
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
              );
            })()}
          </nav>
        )}

        <main id="main-content">
          {me?.is_default_password && (
            <div
              className="banner show"
              role="alert"
              style={{ background: '#fef2f2', borderColor: '#f87171', color: '#991b1b', marginBottom: '1rem' }}
            >
              <span>
                <strong>Security Warning:</strong> You are signed in with the default administrator password (<code>admin</code>). Please change your password immediately.
              </span>
              <button
                type="button"
                className="btn sm danger"
                onClick={() => {
                  setCurPw(''); setNewPw(''); setConfirmPw(''); setPwMsg({ text: '', isError: false });
                  setPwOpen(true);
                }}
              >
                Change Password Now
              </button>
            </div>
          )}

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

          {me && me.role !== 'read_only' && modulesMeta.some(m => m.id === 'ai_assistant') && <AiAssistantBar onNavigate={navigate} currentRoute={hash} />}

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
              setMe(prev => (prev ? { ...prev, is_default_password: newPw === 'admin' } : prev));
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
