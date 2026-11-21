import { test, expect } from '@playwright/test';
import { attachErrorListeners } from '../fixtures/assertions.js';
import { loginAsAdmin } from '../fixtures/auth.js';

test.describe('Codification Admin & Public Code Library', () => {
  test('codification admin page renders cleanly', async ({ page }) => {
    await loginAsAdmin(page);
    const errors = attachErrorListeners(page);

    await page.goto('/app/codification-admin', { waitUntil: 'networkidle' });
    await expect(page.locator('h1, h2').first()).toBeVisible();
    errors.assertClean('/app/codification-admin');
  });
});
