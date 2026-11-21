import { test, expect } from '@playwright/test';
import { attachErrorListeners } from '../fixtures/assertions.js';
import { loginAsAdmin } from '../fixtures/auth.js';

test.describe('CMS Modules: Blog, Pages, Calendar, Directory & Forms', () => {
  test('CMS management pages load cleanly with zero runtime errors', async ({ page }) => {
    await loginAsAdmin(page);
    const errors = attachErrorListeners(page);

    for (const route of [
      '/app/blog-manage',
      '/app/pages-manage',
      '/app/calendar-manage',
      '/app/directory-manage',
      '/app/forms-manage',
    ]) {
      errors.reset();
      await page.goto(route, { waitUntil: 'networkidle' });
      await expect(page.locator('h1, h2').first()).toBeVisible();
      errors.assertClean(route);
    }
  });
});
