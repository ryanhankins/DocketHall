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

import React from 'react';

const AgendasListPage = React.lazy(() => import('./AgendasListPage.jsx'));
const AgendaDetailPage = React.lazy(() => import('./AgendaDetailPage.jsx'));
const BacklogPage = React.lazy(() => import('./BacklogPage.jsx'));
const AgendaPrefsPage = React.lazy(() => import('./AgendaPrefsPage.jsx'));
const CouncilPage = React.lazy(() => import('./CouncilPage.jsx'));
const FinalizedAgendasPage = React.lazy(() => import('./FinalizedAgendasPage.jsx'));

const agendasModule = {
  id: 'agendas',
  prefNavItems: [
    { section: 'preferences-agenda', label: 'Agenda Preferences', permission: 'agendas.manage' },
  ],
  routes: [
    {
      match: (hash) => {
        const m = hash.match(/^agendas\/(\d+)(?:\/(contents|minutes))?$/);
        return m ? { agendaId: Number(m[1]), tab: m[2] || 'edit' } : null;
      },
      permission: 'agendas.manage',
      component: AgendaDetailPage,
    },
    {
      match: (hash) => (hash === 'agendas' ? {} : null),
      permission: 'agendas.manage',
      component: AgendasListPage,
    },
    {
      match: (hash) => (hash === 'backlog' ? {} : null),
      permission: 'agendas.manage',
      component: BacklogPage,
    },
    {
      match: (hash) => (hash === 'preferences-agenda' || hash === 'preferences' ? {} : null),
      permission: 'agendas.manage',
      component: AgendaPrefsPage,
    },
    {
      match: (hash) => (hash === 'finalized-agendas' ? {} : null),
      permission: 'agendas.submit',
      component: FinalizedAgendasPage,
    },
    {
      match: (hash) => (hash === 'council' ? {} : null),
      permission: 'agendas.submit',
      component: CouncilPage,
    },
  ],
};

export default agendasModule;
