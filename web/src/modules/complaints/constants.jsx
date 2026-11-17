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

export const COMPLAINT_STATUSES = [
  { value: 'submitted', label: 'Submitted', bg: '#e0f2fe', color: '#0369a1' },
  { value: 'investigating', label: 'Investigating (618.030)', bg: '#fef3c7', color: '#92400e' },
  { value: 'informal_resolution', label: 'Informal Resolution (618.040)', bg: '#ede9fe', color: '#5b21b6' },
  { value: 'notice_of_violation', label: 'Notice of Violation (618.040)', bg: '#fee2e2', color: '#991b1b' },
  { value: 'hearing_requested', label: 'Hearing Requested (618.040)', bg: '#ffedd5', color: '#9a3412' },
  { value: 'council_review', label: 'Council Review (618.050)', bg: '#fce7f3', color: '#9d174d' },
  { value: 'resolved', label: 'Resolved (618.070)', bg: '#dcfce7', color: '#166534' },
  { value: 'dismissed', label: 'Dismissed / No Violation', bg: '#f3f4f6', color: '#374151' },
];

export const ORDINANCE_PRESETS = [
  '606 - Public Nuisances',
  '613 - Unclaimed & Abandoned Property',
  '614 - Abandoned & Junked Motor Vehicles',
  '615 - Exterior Storage',
  '616 - Excessive Noise',
  '617 - Public Lake Tracts',
  '620 - Feeding Deer',
  '621 - Storage of Personal Property',
  '622 - Regulation of Solicitors',
  '623 - Animal Barriers',
  'Other / Unknown',
];

export const ASSISTING_AGENCIES = [
  'City Staff',
  'Law Enforcement',
  'White Bear Lake Planning & Zoning',
  'Birchwood Planning Commission',
  'City Council',
];

export function StatusBadge({ status }) {
  const meta = COMPLAINT_STATUSES.find((s) => s.value === status) || {
    label: status || 'unknown',
    bg: '#f3f4f6',
    color: '#374151',
  };
  return (
    <span
      className="badge"
      style={{ background: meta.bg, color: meta.color, whiteSpace: 'nowrap' }}
    >
      {meta.label}
    </span>
  );
}
