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
import ModuleNotificationsCard from '../../core/ModuleNotificationsCard.jsx';

const COMPLAINT_NOTIFICATION_EVENTS = [
  {
    key: 'complaints_submitted',
    label: 'New Complaint Filed',
    description: 'Sent when a resident or staff member submits a new complaint.',
  },
  {
    key: 'complaints_escalated',
    label: 'Notice of Violation Issued',
    description: 'Sent when staff issues a Section 618.040 Notice of Violation for a complaint.',
  },
];

export default function ComplaintPrefsPage() {
  return (
    <section id="section-preferences-complaints">
      <h1>Complaint Preferences</h1>
      <ModuleNotificationsCard
        moduleId="complaints"
        title="Complaint Email Notifications"
        events={COMPLAINT_NOTIFICATION_EVENTS}
      />
    </section>
  );
}
