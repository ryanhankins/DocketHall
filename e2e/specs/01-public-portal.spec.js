import { test, expect } from '@playwright/test';
import { attachErrorListeners } from '../fixtures/assertions.js';

test.describe('Public Portal, Search & Multilingual UI', () => {
  test('public portal, code library, blog, calendar, and directory render cleanly', async ({ page }) => {
    const errors = attachErrorListeners(page, {
      allowedConsolePatterns: [/status of 401 \(Unauthorized\)/],
    });

    for (const route of ['/', '/portal', '/code', '/blog', '/calendar', '/directory']) {
      errors.reset();
      const res = await page.goto(route, { waitUntil: 'networkidle' });
      expect(res?.status()).toBeLessThan(500);
      await expect(page.locator('body')).not.toBeEmpty();
      errors.assertClean(route);
    }
  });

  test('public code viewer search input filters or responds cleanly', async ({ page }) => {
    const errors = attachErrorListeners(page, {
      allowedConsolePatterns: [/status of 401 \(Unauthorized\)/],
    });

    await page.goto('/code', { waitUntil: 'networkidle' });
    const searchBox = page.getByPlaceholder(/search/i).first();
    if (await searchBox.isVisible()) {
      await searchBox.fill('water');
      await searchBox.press('Enter');
      await page.waitForTimeout(300);
    }
    errors.assertClean('/code search');
  });
});
