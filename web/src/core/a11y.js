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

const GENERIC_LINK_LABELS = new Set([
  'click here',
  'here',
  'read more',
  'learn more',
  'more',
  'more info',
  'link',
  'this link',
  'website',
  'details',
]);

/**
 * Flag generic link labels ("Click here", "Read more", etc.) so clerks use
 * descriptive WCAG 2.4.4 link text (e.g. "Download 2026 Budget (PDF)").
 */
export function getLinkTextWarnings(text, { isStandaloneLabel = false } = {}) {
  const raw = String(text || '').trim();
  if (!raw) return [];
  const found = new Set();

  if (isStandaloneLabel) {
    const norm = raw.toLowerCase().replace(/[.!?:]+$/, '').trim();
    if (GENERIC_LINK_LABELS.has(norm)) {
      found.add(raw);
    }
  } else {
    // Match Markdown links [label](url) and HTML <a ...>label</a>
    const mdRe = /\[([^\]]+)\]\([^)]+\)/g;
    let m;
    while ((m = mdRe.exec(raw)) !== null) {
      const norm = m[1].toLowerCase().replace(/[.!?:]+$/, '').trim();
      if (GENERIC_LINK_LABELS.has(norm)) found.add(m[1].trim());
    }
    const htmlRe = /<a\b[^>]*>([^<]+)<\/a>/gi;
    while ((m = htmlRe.exec(raw)) !== null) {
      const norm = m[1].toLowerCase().replace(/[.!?:]+$/, '').trim();
      if (GENERIC_LINK_LABELS.has(norm)) found.add(m[1].trim());
    }
    // Also catch standalone phrases like "click here" in plain text
    if (/\bclick here\b/i.test(raw)) found.add('click here');
  }

  return Array.from(found).map(
    (phrase) => `Avoid generic link text ("${phrase}"). Use descriptive text like "Download the 2026 Budget (PDF)".`,
  );
}

/**
 * Run POST /api/pdf/check on a browser File before/during upload and return
 * user-friendly accessibility warnings (e.g. scanned image PDF without text layer).
 */
export async function checkPdfFileBeforeUpload(file) {
  if (!file || !/\.pdf$/i.test(file.name || '')) return null;
  try {
    const fd = new FormData();
    fd.append('file', file);
    const r = await fetch('/api/pdf/check', {
      method: 'POST',
      credentials: 'same-origin',
      body: fd,
    });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}
