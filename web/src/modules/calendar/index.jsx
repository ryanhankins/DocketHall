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

const CalendarManagePage = lazy(() => import('./CalendarManagePage.jsx'));
const CalendarPrefsPage = lazy(() => import('./CalendarPrefsPage.jsx'));

const calendarModule = {
  id: 'calendar',
  prefNavItems: [
    { section: 'preferences-calendar', label: 'Calendar & Rental Settings', permission: 'calendar.manage' },
  ],
  routes: [
    {
      match: (hash) => (hash === 'calendar-manage' ? {} : null),
      permission: 'calendar.manage',
      component: CalendarManagePage,
    },
    {
      match: (hash) => (hash === 'preferences-calendar' ? {} : null),
      permission: 'calendar.manage',
      component: CalendarPrefsPage,
    },
  ],
};

export default calendarModule;
