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

const ALERT_THEMES = {
  danger: { bg: '#fef2f2', border: '#ef4444', color: '#991b1b' },
  warning: { bg: '#fffbeb', border: '#f59e0b', color: '#92400e' },
  info: { bg: '#eff6ff', border: '#3b82f6', color: '#1e40af' },
};

export function UrgentAlertBanner({ branding }) {
  if (!branding?.alert_enabled || !branding?.alert_message?.trim()) return null;
  const theme = ALERT_THEMES[branding.alert_level] || ALERT_THEMES.danger;
  const hasLink = Boolean(branding.alert_link_url && /^https?:\/\//i.test(branding.alert_link_url));
  return (
    <div
      role="alert"
      style={{
        background: theme.bg,
        borderBottom: `2px solid ${theme.border}`,
        color: theme.color,
        padding: '.65rem 1.25rem',
        fontSize: '.92rem',
      }}
    >
      <div
        style={{
          maxWidth: 1180,
          margin: '0 auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '.75rem',
          flexWrap: 'wrap',
        }}
      >
        <div>
          {branding.alert_title?.trim() && (
            <strong>{branding.alert_title.trim()}: </strong>
          )}
          <span>{branding.alert_message.trim()}</span>
        </div>
        {hasLink && (
          <a
            href={branding.alert_link_url}
            target="_blank"
            rel="noreferrer"
            style={{ color: theme.color, fontWeight: 700, textDecoration: 'underline', whiteSpace: 'nowrap' }}
          >
            {branding.alert_link_label?.trim() || 'More Details'} &rarr;
          </a>
        )}
      </div>
    </div>
  );
}

export function PublicFooter({ branding }) {
  const footerText = (branding?.footer_text || '').trim();
  const websiteUrl = (branding?.city_website_url || '').trim();
  const hasSite = Boolean(websiteUrl && /^https?:\/\//i.test(websiteUrl));
  const websiteLabel = (branding?.city_website_label || '').trim() || 'Visit Main City Website';
  if (!footerText && !hasSite) return null;
  return (
    <footer
      style={{
        marginTop: 'auto',
        borderTop: '1px solid #e2e8f0',
        background: '#fff',
        padding: '1rem 1.25rem',
        fontSize: '.88rem',
        color: '#475569',
      }}
    >
      <div
        style={{
          maxWidth: 1180,
          margin: '0 auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '.75rem',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ whiteSpace: 'pre-wrap' }}>
          {footerText || (branding?.city_title ? `${branding.city_title} Public Portal` : 'CivicDesk Public Portal')}
        </div>
        {hasSite && (
          <a
            href={websiteUrl}
            target="_blank"
            rel="noreferrer"
            style={{ color: 'var(--cd-primary)', fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap' }}
          >
            {websiteLabel} &rarr;
          </a>
        )}
      </div>
    </footer>
  );
}

export function DirectoryHeaderLink({ branding }) {
  const url = (branding?.directory_url || '').trim();
  if (!url || !/^https?:\/\//i.test(url)) return null;
  const label = (branding?.directory_label || '').trim() || 'Contact / Directory';
  return (
    <a className="btn sm" href={url} target="_blank" rel="noreferrer">
      {label}
    </a>
  );
}

export function CivicDeskLogo({ size = 24 }) {
  return (
    <img
      src="/civicdesk-logo.svg"
      alt=""
      width={size}
      height={size}
      aria-hidden="true"
      style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}
    />
  );
}
