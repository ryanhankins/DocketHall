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

const PermitApplyPage = React.lazy(() => import('./PermitApplyPage.jsx'));
const MyPermitsPage = React.lazy(() => import('./MyPermitsPage.jsx'));
const PermitsReviewPage = React.lazy(() => import('./PermitsReviewPage.jsx'));
const PermitCatalogAdminPage = React.lazy(() => import('./PermitCatalogAdminPage.jsx'));

const permitsModule = {
  id: 'permits',
  prefNavItems: [],
  routes: [
    {
      match: (hash) => {
        const [path, qs] = hash.split('?');
        if (path !== 'permits-apply') return null;
        const p = new URLSearchParams(qs || '');
        return {
          initialTypeId: p.get('type') ? Number(p.get('type')) : null,
          initialUseId: p.get('use') ? Number(p.get('use')) : null,
        };
      },
      permission: 'permits.submit',
      component: PermitApplyPage,
    },
    {
      match: (hash) => (hash === 'my-permits' ? {} : null),
      permission: 'permits.submit',
      component: MyPermitsPage,
    },
    {
      match: (hash) => (hash === 'permits-review' ? {} : null),
      permission: 'permits.manage',
      component: PermitsReviewPage,
    },
    {
      match: (hash) => (hash === 'permits-catalog-admin' ? {} : null),
      permission: 'permits.manage',
      component: PermitCatalogAdminPage,
    },
  ],
};

export default permitsModule;
