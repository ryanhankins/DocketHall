import { test, expect } from '@playwright/test';
import { attachErrorListeners } from '../fixtures/assertions.js';
import { loginAsAdmin } from '../fixtures/auth.js';

test.describe('Complaints / 311, Records / FOIA & Public Notices', () => {
  test('complaints, records, and notices admin pages load cleanly', async ({ page }) => {
    await loginAsAdmin(page);
    const errors = attachErrorListeners(page);

    for (const route of [
      '/app/complaints-file',
      '/app/my-complaints',
      '/app/complaints-manage',
      '/app/records-repo',
      '/app/notices-manage',
    ]) {
      errors.reset();
      await page.goto(route, { waitUntil: 'networkidle' });
      await expect(page.locator('h1, h2').first()).toBeVisible();
      errors.assertClean(route);
    }
  });
});
