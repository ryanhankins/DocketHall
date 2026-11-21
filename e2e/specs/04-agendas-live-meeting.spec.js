import { test, expect } from '@playwright/test';
import { attachErrorListeners } from '../fixtures/assertions.js';
import { loginAsAdmin } from '../fixtures/auth.js';

test.describe('Agendas, Backlog, Council & Finalized Workflows', () => {
  test('agendas, backlog, council, and finalized pages load cleanly', async ({ page }) => {
    await loginAsAdmin(page);
    const errors = attachErrorListeners(page);

    for (const route of ['/app/agendas', '/app/backlog', '/app/council', '/app/finalized', '/app/preferences-agenda']) {
      errors.reset();
      await page.goto(route, { waitUntil: 'networkidle' });
      await expect(page.locator('h1, h2').first()).toBeVisible();
      errors.assertClean(route);
    }
  });
});
