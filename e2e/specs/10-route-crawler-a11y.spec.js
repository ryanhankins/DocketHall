import { test, expect } from '@playwright/test';
import { attachErrorListeners } from '../fixtures/assertions.js';
import { loginAsAdmin, getActiveModules } from '../fixtures/auth.js';

const PUBLIC_ROUTES = [
  '/',
  '/portal',
  '/code',
  '/blog',
  '/calendar',
  '/directory',
];

const CORE_ADMIN_ROUTES = [
  '/app/users',
  '/app/modules',
  '/app/integrations',
  '/app/audit',
  '/app/preferences-general',
  '/app/sla-rules',
  '/app/preferences-backup',
  '/app/help',
  '/app/my-account',
  '/app/billing',
];

const MODULE_ROUTE_MAP = {
  agendas: ['/app/agendas', '/app/backlog', '/app/council', '/app/finalized', '/app/preferences-agenda'],
  codification: ['/app/codification-admin'],
  permits: [
    '/app/permits-review',
    '/app/permits-apply',
    '/app/my-permits',
    '/app/properties',
    '/app/field-inspector',
    '/app/permits-reports',
    '/app/preferences-permits',
    '/app/permits-catalog-admin',
  ],
  complaints: ['/app/complaints-manage', '/app/complaints-file', '/app/my-complaints', '/app/complaints-log', '/app/preferences-complaints'],
  records: ['/app/records-repo'],
  calendar: ['/app/calendar-manage', '/app/preferences-calendar'],
  communications: ['/app/blog-manage', '/app/notices-manage', '/app/directory-manage'],
  notices: ['/app/notices-manage'],
  directory: ['/app/directory-manage'],
  pages: ['/app/pages-manage'],
  forms: ['/app/forms-manage'],
  licensing: ['/app/contractors', '/app/compliance-programs', '/app/renewals'],
  citations: ['/app/citations-manage'],
  utilities: ['/app/utilities-manage'],
};

test.describe('Public & Authenticated Route Crawler + A11y Sanity', () => {
  test('all public routes render with zero console/page/5xx errors', async ({ page }) => {
    const errors = attachErrorListeners(page, {
      allowedConsolePatterns: [/status of 401 \(Unauthorized\)/],
    });

    for (const route of PUBLIC_ROUTES) {
      errors.reset();
      const res = await page.goto(route, { waitUntil: 'networkidle' });
      expect(res?.status(), `HTTP status for ${route}`).toBeLessThan(500);
      const bodyText = await page.locator('body').innerText();
      expect(bodyText.trim().length, `Non-empty body on ${route}`).toBeGreaterThan(20);
      errors.assertClean(route);
    }
  });

  test('all active workspace routes render with zero console/page/5xx errors', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = attachErrorListeners(page);
    await loginAsAdmin(page);

    const modules = await getActiveModules(page);
    const enabledIds = new Set(modules.filter((m) => m.enabled).map((m) => m.id));

    const routesToVisit = new Set(CORE_ADMIN_ROUTES);
    for (const [modId, routes] of Object.entries(MODULE_ROUTE_MAP)) {
      if (enabledIds.has(modId)) {
        for (const r of routes) routesToVisit.add(r);
      }
    }

    for (const route of routesToVisit) {
      errors.reset();
      const res = await page.goto(route, { waitUntil: 'networkidle' });
      expect(res?.status(), `HTTP status for ${route}`).toBeLessThan(500);
      const bodyText = await page.locator('body').innerText();
      expect(bodyText.trim().length, `Non-empty workspace body on ${route}`).toBeGreaterThan(20);
      // Basic accessibility landmark / heading presence check
      const headingCount = await page.locator('h1, h2, h3').count();
      expect(headingCount, `At least one heading on ${route}`).toBeGreaterThan(0);
      errors.assertClean(route);
    }
  });
});
