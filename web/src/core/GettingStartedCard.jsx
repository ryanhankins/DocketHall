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

import React, { useEffect, useState } from 'react';

const SECTION_GUIDES = {
  'permits-review': {
    title: 'Getting Started with Permits & Plan Review',
    subtitle: 'Configure permit types, review incoming applications, and issue approvals.',
    steps: [
      { bold: 'Configure Permit Types & Fees:', text: 'Define permit categories, fee schedules, and custom fields under ', link: { label: 'Permit Preferences', route: '#preferences-permits' } },
      { bold: 'Review Incoming Applications:', text: 'Click any submitted permit below to inspect plans, check contractor licenses, and send applicant messages.' },
      { bold: 'Schedule Inspections & Issue Certificates:', text: 'Assign inspections to ', link: { label: 'Field Inspector Mode', route: '#field-inspector' }, after: ' and generate Certificates of Occupancy when approved.' },
    ],
  },
  'field-inspector': {
    title: 'Getting Started with Field Inspector Mode',
    subtitle: 'Conduct on-site inspections with offline caching, photos, and signatures.',
    steps: [
      { bold: 'Pick a Scheduled Inspection:', text: 'Select an inspection from the queue or map view.' },
      { bold: 'Record Findings & Photos:', text: 'Mark Pass, Fail, or Corrections Needed, attach site photos, and capture signatures (works offline too).' },
      { bold: 'Sync Results:', text: 'Saved drafts automatically sync back to the ', link: { label: 'Permit Review Queue', route: '#permits-review' }, after: ' once online.' },
    ],
  },
  properties: {
    title: 'Getting Started with Property & Parcel Profiles',
    subtitle: 'View a 360-degree history of permits, inspections, and code cases by parcel.',
    steps: [
      { bold: 'Search or Add a Parcel:', text: 'Look up an existing address/parcel ID or register a new property record.' },
      { bold: 'Review Linked Activity:', text: 'See all permits, code complaints, and compliance programs tied to the property in one place.' },
    ],
  },
  'permits-reports': {
    title: 'Getting Started with Permits Reports & Revenue',
    subtitle: 'Track permit volume, fee collections, and inspection pass rates.',
    steps: [
      { bold: 'Filter by Date Range:', text: 'Adjust the reporting period to review issued permits and fee totals.' },
      { bold: 'Export for Finance:', text: 'Download CSV summaries to reconcile with municipal accounting.' },
    ],
  },
  'preferences-permits': {
    title: 'Getting Started with Permit Preferences',
    subtitle: 'Customize permit types, required documents, custom form fields, and fees.',
    steps: [
      { bold: 'Add Permit Types:', text: 'Create building, electrical, zoning, or sign permit templates with base fees.' },
      { bold: 'Define Custom Fields & Checklists:', text: 'Specify the questions and attachments applicants must provide before submitting.' },
    ],
  },
  contractors: {
    title: 'Getting Started with Contractors & Licenses',
    subtitle: 'Maintain verified contractor registrations and insurance expiration dates.',
    steps: [
      { bold: 'Register Contractors:', text: 'Add licensed plumbers, electricians, and general contractors with expiration dates.' },
      { bold: 'Send Renewal Reminders:', text: 'Use one-click reminder emails for expiring licenses and verify licenses during ', link: { label: 'Permit Review', route: '#permits-review' }, after: '.' },
    ],
  },
  'compliance-programs': {
    title: 'Getting Started with Rental & Fire Compliance',
    subtitle: 'Track recurring safety inspections, certificates, and property compliance.',
    steps: [
      { bold: 'Enroll Properties:', text: 'Add rental units or commercial properties requiring periodic fire or safety checks.' },
      { bold: 'Log Inspections & Certificates:', text: 'Record inspection results and generate printable compliance certificates.' },
    ],
  },
  renewals: {
    title: 'Getting Started with Recurring Renewals',
    subtitle: 'Monitor upcoming expirations across licenses and compliance programs.',
    steps: [
      { bold: 'Review Expiring Items:', text: 'Check overdue and upcoming renewals across contractors and compliance programs.' },
      { bold: 'Follow Up Early:', text: 'Jump directly to ', link: { label: 'Contractors', route: '#contractors' }, after: ' or ', link2: { label: 'Compliance Programs', route: '#compliance-programs' }, after2: ' to send reminders.' },
    ],
  },
  'complaints-manage': {
    title: 'Getting Started with Complaints & Code Enforcement',
    subtitle: 'Triage resident reports, assign work orders, and track resolution.',
    steps: [
      { bold: 'Configure Categories & Workflows:', text: 'Set complaint types and default routing under ', link: { label: 'Complaint Preferences', route: '#preferences-complaints' }, after: '.' },
      { bold: 'Triage & Assign:', text: 'Open any incoming complaint to update its status, link a city code section, or create a work order.' },
      { bold: 'Close the Loop:', text: 'Post resolution notes so residents see updates in ', link: { label: 'My Complaints', route: '#my-complaints' }, after: '.' },
    ],
  },
  'preferences-complaints': {
    title: 'Getting Started with Complaint Preferences',
    subtitle: 'Customize complaint categories, priorities, and resident intake options.',
    steps: [
      { bold: 'Define Categories:', text: 'Add or edit issue types (e.g. Code Violation, Pothole, Noise) shown on the public intake form.' },
      { bold: 'Set Routing Defaults:', text: 'Configure department assignments and SLA expectations.' },
    ],
  },
  'records-repo': {
    title: 'Getting Started with Document Repository & FOIA',
    subtitle: 'Store ordinances, contracts, and resolutions, and fulfill public records requests.',
    steps: [
      { bold: 'Upload Official Documents:', text: 'Catalog contracts, resolutions, and ordinances with retention dates and public visibility.' },
      { bold: 'Manage FOIA Requests:', text: 'Switch to the FOIA Requests tab to track deadlines, assign staff, and upload responsive files.' },
      { bold: 'Archive from Agendas:', text: 'You can also archive approved agenda items straight into this repository.' },
    ],
  },
  'codification-admin': {
    title: 'Getting Started with City Code Editor',
    subtitle: 'Organize municipal code chapters, import PDFs, and publish a searchable code book.',
    steps: [
      { bold: 'Create Chapters or Bulk Import:', text: 'Add chapters manually or upload existing code PDFs/folders for automatic parsing.' },
      { bold: 'Edit & Publish Sections:', text: 'Review parsed sections, run OCR if needed, and publish to the public Code Library.' },
    ],
  },
  'calendar-manage': {
    title: 'Getting Started with Calendar & Facility Reservations',
    subtitle: 'Publish community events and review facility rental requests.',
    steps: [
      { bold: 'Set Up Reservable Facilities:', text: 'Configure rooms, parks, pavilions, and rental fees under ', link: { label: 'Calendar & Rental Settings', route: '#preferences-calendar' }, after: '.' },
      { bold: 'Approve Reservations & Events:', text: 'Review pending rental requests and add public city events below.' },
    ],
  },
  'preferences-calendar': {
    title: 'Getting Started with Calendar & Rental Settings',
    subtitle: 'Define reservable facilities, hourly/daily rates, and booking rules.',
    steps: [
      { bold: 'Add Facilities:', text: 'List city halls, parks, or meeting rooms residents can request online.' },
      { bold: 'Set Pricing & Availability:', text: 'Configure rental fees and deposit notes before opening bookings on ', link: { label: 'Reservations & Events', route: '#calendar-manage' }, after: '.' },
    ],
  },
  'blog-manage': {
    title: 'Getting Started with Blog & Articles',
    subtitle: 'Publish city news, manage categories, moderate comments, and configure feeds.',
    steps: [
      { bold: 'Create Categories:', text: 'Set up topic categories in the Categories tab before drafting posts.' },
      { bold: 'Write & Publish Posts:', text: 'Draft articles, schedule publication, or push directly to the public homepage.' },
      { bold: 'Configure Display & RSS:', text: 'Use the Blog Settings & Feed tab to control homepage placement and RSS.' },
    ],
  },
  'notices-manage': {
    title: 'Getting Started with News, Notices, Bids & Jobs',
    subtitle: 'Post official public notices, RFPs/bids, and municipal job openings.',
    steps: [
      { bold: 'Choose Notice Type:', text: 'Create a Public Notice, Bid/RFP, or Job Posting with an optional closing date.' },
      { bold: 'Publish & Notify Subscribers:', text: 'Published notices appear on the public portal and alert email subscribers.' },
    ],
  },
  'directory-manage': {
    title: 'Getting Started with Directory & FAQs',
    subtitle: 'Keep city contacts, departments, boards, locations, and FAQs up to date.',
    steps: [
      { bold: 'Add Key Contacts & Departments:', text: 'Populate phone numbers, emails, and office hours for public lookup.' },
      { bold: 'Publish Common FAQs:', text: 'Add answers to frequent resident questions so both visitors and the AI Assistant can cite them.' },
    ],
  },
  'pages-manage': {
    title: 'Getting Started with City Pages & Quick Links',
    subtitle: 'Build custom informational pages and highlight top resident links.',
    steps: [
      { bold: 'Create Custom Pages:', text: 'Add standalone pages (e.g. Trash Schedule, About Our City) with rich formatting.' },
      { bold: 'Manage Quick Links:', text: 'Pin important internal or external links to the public portal navigation.' },
    ],
  },
  'forms-manage': {
    title: 'Getting Started with Forms & Opinion Polls',
    subtitle: 'Collect resident feedback, sign-ups, and community survey responses.',
    steps: [
      { bold: 'Build a Form or Poll:', text: 'Define custom fields or poll choices and choose whether results are public.' },
      { bold: 'Review Submissions:', text: 'Track responses and export results as CSV.' },
    ],
  },
  'utilities-manage': {
    title: 'Getting Started with Utility Accounts & Bills',
    subtitle: 'Issue water, sewer, and trash statements, import CSV batches, and record payments.',
    steps: [
      { bold: 'Create or Import Bills:', text: 'Add individual utility statements or upload a monthly billing CSV.' },
      { bold: 'Track Payments & Reconciliation:', text: 'Record offline payments, monitor online Stripe checkouts, and review GL totals.' },
    ],
  },
  'citations-manage': {
    title: 'Getting Started with Citations & Contests',
    subtitle: 'Issue parking or code citations, track payments, and review contest requests.',
    steps: [
      { bold: 'Issue a Citation:', text: 'Enter violation details, fine amount, and due date.' },
      { bold: 'Review Contests & Payments:', text: 'Approve or deny resident hearing/contest requests and record fine payments.' },
    ],
  },
  users: {
    title: 'Getting Started with User Management',
    subtitle: 'Create staff, council, inspector, and clerk accounts with granular permissions.',
    steps: [
      { bold: 'Add Staff & Council Accounts:', text: 'Create user accounts and assign roles (Admin, Staff, Inspector, Council Member).' },
      { bold: 'Fine-Tune Permissions:', text: 'Grant module-specific permissions so each person sees only the tools they need.' },
    ],
  },
  modules: {
    title: 'Getting Started with Modules',
    subtitle: 'Enable only the civic modules and sub-features your municipality uses.',
    steps: [
      { bold: 'Pick a Preset or Toggle Modules:', text: 'Turn off unused modules to keep both the public portal and staff sidebar focused.' },
      { bold: 'Configure Sub-Features:', text: 'Expand a module to toggle optional capabilities like Backlog or Council Proposals.' },
    ],
  },
  'preferences-general': {
    title: 'Getting Started with General & Branding',
    subtitle: 'Set your city title, logo, theme colors, homepage layout, and urgent alert banner.',
    steps: [
      { bold: 'Upload Logo & City Name:', text: 'Personalize the header, public portal, and generated PDF packets.' },
      { bold: 'Customize Homepage & Theme:', text: 'Pick an accessible color preset and choose which service cards appear on the home page.' },
    ],
  },
  integrations: {
    title: 'Getting Started with Email & Integrations',
    subtitle: 'Connect SMTP email delivery, Stripe payments, and Google Cloud / AI keys.',
    steps: [
      { bold: 'Configure Email (SMTP):', text: 'Set outbound email credentials and send a test message for notifications and password resets.' },
      { bold: 'Connect Payments & AI:', text: 'Add Stripe keys for online permit/utility payments and AI credentials if enabled.' },
    ],
  },
  audit: {
    title: 'Getting Started with the Audit Log',
    subtitle: 'Review a tamper-evident trail of administrative and staff actions.',
    steps: [
      { bold: 'Filter by Action or User:', text: 'Search login events, permission changes, record updates, and exports.' },
    ],
  },
  'sla-rules': {
    title: 'Getting Started with SLA & Escalations',
    subtitle: 'Set response-time targets and automatic overdue alerts for permits, complaints, and FOIA.',
    steps: [
      { bold: 'Define Target Turnaround:', text: 'Set business-day thresholds for initial review and resolution.' },
      { bold: 'Monitor Overdue Alerts:', text: 'Check the active alerts list to catch items approaching or past their deadline.' },
    ],
  },
  'preferences-backup': {
    title: 'Getting Started with Backup & Restore',
    subtitle: 'Download full encrypted-ready snapshots of your city data and restore safely.',
    steps: [
      { bold: 'Download a Snapshot:', text: 'Export a complete ZIP archive of database records and uploaded files.' },
      { bold: 'Set Reminder Cadence:', text: 'Configure how often DocketHall reminds administrators to take an off-site backup.' },
    ],
  },
  'finalized-agendas': {
    title: 'Getting Started with Finalized Agendas',
    subtitle: 'Browse published meeting packets, summaries, and approved minutes.',
    steps: [
      { bold: 'Download Meeting Packets:', text: 'Open any finalized meeting to view the full packet PDF, summary, or minutes.' },
    ],
  },
  council: {
    title: 'Getting Started with Agenda Proposals',
    subtitle: 'Submit agenda items and supporting documents for clerk review.',
    steps: [
      { bold: 'Submit a Proposal:', text: 'Fill out the item title, target meeting, and optional motion or fiscal impact (or ask the AI Assistant).' },
      { bold: 'Track Clerk Review:', text: 'Watch your proposal status move from Pending to Accepted onto an upcoming agenda.' },
    ],
  },
  'permit-apply': {
    title: 'Getting Started with Permit Applications',
    subtitle: 'Apply online for building, zoning, electrical, or sign permits.',
    steps: [
      { bold: 'Choose a Permit Type:', text: 'Select the permit you need and enter the project address and description.' },
      { bold: 'Attach Plans & Submit:', text: 'Upload supporting PDFs or drawings and track review status in ', link: { label: 'My Permits', route: '#my-permits' }, after: '.' },
    ],
  },
  'my-permits': {
    title: 'Getting Started with My Permits',
    subtitle: 'Track submitted permit applications, messages from reviewers, and inspection results.',
    steps: [
      { bold: 'Check Status & Messages:', text: 'Open any permit to reply to staff questions, upload revisions, or pay fees.' },
    ],
  },
  'complaints-file': {
    title: 'Getting Started with Filing a Complaint',
    subtitle: 'Report code violations, street issues, or municipal service requests.',
    steps: [
      { bold: 'Describe the Issue:', text: 'Select a category, enter the location, and attach photos if helpful.' },
      { bold: 'Track Progress:', text: 'Follow staff updates anytime in ', link: { label: 'My Complaints', route: '#my-complaints' }, after: '.' },
    ],
  },
  'my-complaints': {
    title: 'Getting Started with My Complaints',
    subtitle: 'View the status and staff resolution notes for your submitted complaints.',
    steps: [
      { bold: 'Review Updates:', text: 'Check current status and any follow-up notes from city staff.' },
    ],
  },
  'my-account': {
    title: 'Getting Started with My Civic Account',
    subtitle: 'Manage your profile, bills, subscriptions, and recent civic activity.',
    steps: [
      { bold: 'Review Open Items:', text: 'See your permits, complaints, reservations, and utility or citation balances in one place.' },
      { bold: 'Manage Notifications:', text: 'Subscribe or unsubscribe from agenda, notice, and blog email updates.' },
    ],
  },
};

export default function GettingStartedCard({ section, onNavigate }) {
  const guide = SECTION_GUIDES[section];
  const storageKey = `dockethall.quickStartDismissed.${section}`;

  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(storageKey) === '1'; } catch { return false; }
  });

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(storageKey) === '1');
    } catch {
      setDismissed(false);
    }
  }, [storageKey]);

  if (!guide || dismissed) return null;

  return (
    <div className="card" style={{ background: '#f8fafc', borderColor: '#bfdbfe', marginBottom: '1rem' }}>
      <div className="between" style={{ marginBottom: '.5rem' }}>
        <div>
          <strong style={{ fontSize: '1rem', color: '#1e3a8a' }}>{guide.title}</strong>
          <div className="muted" style={{ fontSize: '.85rem' }}>{guide.subtitle}</div>
        </div>
        <div className="actions">
          <button
            type="button"
            className="btn sm"
            onClick={() => {
              setDismissed(true);
              try { localStorage.setItem(storageKey, '1'); } catch { /* ignore */ }
            }}
          >
            Dismiss
          </button>
        </div>
      </div>
      <ol style={{ margin: '.25rem 0 0', paddingLeft: '1.25rem', display: 'grid', gap: '.35rem', fontSize: '.9rem' }}>
        {guide.steps.map((s, idx) => (
          <li key={idx}>
            <strong>{s.bold}</strong> {s.text}
            {s.link && (
              <button type="button" className="link-btn" onClick={() => onNavigate?.(s.link.route)}>
                {s.link.label}
              </button>
            )}
            {s.after}
            {s.link2 && (
              <button type="button" className="link-btn" onClick={() => onNavigate?.(s.link2.route)}>
                {s.link2.label}
              </button>
            )}
            {s.after2}
          </li>
        ))}
      </ol>
    </div>
  );
}
