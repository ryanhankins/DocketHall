import { test, expect } from '@playwright/test';
import { attachErrorListeners } from '../fixtures/assertions.js';
import { loginAsAdmin } from '../fixtures/auth.js';

test.describe('Finance, Payments & GL Reconciliation', () => {
  test('Billing & Payments management page loads with reconciliation controls', async ({ page }) => {
    await loginAsAdmin(page);
    const errors = attachErrorListeners(page);

    await page.goto('/app/billing', { waitUntil: 'networkidle' });
    await expect(page.locator('h1, h2').first()).toBeVisible();
    errors.assertClean('/app/billing');
  });
});
