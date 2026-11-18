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

import { lazy } from 'react';

const ComplaintsFilePage = lazy(() => import('./ComplaintsFilePage.jsx'));
const MyComplaintsPage = lazy(() => import('./MyComplaintsPage.jsx'));
const ComplaintLogPage = lazy(() => import('./ComplaintLogPage.jsx'));
const ComplaintsManagePage = lazy(() => import('./ComplaintsManagePage.jsx'));
const ComplaintPrefsPage = lazy(() => import('./ComplaintPrefsPage.jsx'));

const complaintsModule = {
  id: 'complaints',
  prefNavItems: [
    { hash: 'preferences-complaints', label: 'Complaint Preferences', permission: 'complaints.manage' },
  ],
  routes: [
    {
      match: (hash) => (hash === 'preferences-complaints' ? {} : null),
      permission: 'complaints.manage',
      component: ComplaintPrefsPage,
    },
    {
      match: (hash) => (hash === 'complaints-file' ? {} : null),
      permission: 'complaints.submit',
      component: ComplaintsFilePage,
    },
    {
      match: (hash) => (hash === 'my-complaints' ? {} : null),
      permission: 'complaints.submit',
      component: MyComplaintsPage,
    },
    {
      match: (hash) => (hash === 'complaints-log' ? {} : null),
      permission: 'complaints.log',
      component: ComplaintLogPage,
    },
    {
      match: (hash) => (hash === 'complaints-manage' ? {} : null),
      permission: 'complaints.manage',
      component: ComplaintsManagePage,
    },
  ],
};

export default complaintsModule;
