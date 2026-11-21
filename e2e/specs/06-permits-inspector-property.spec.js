import { test, expect } from '@playwright/test';
import { attachErrorListeners } from '../fixtures/assertions.js';
import { loginAsAdmin } from '../fixtures/auth.js';

test.describe('Permits, Property & Parcel Profile, and Field Inspector PWA', () => {
  test('Property & Parcel Profile renders updated branding and lookup form', async ({ page }) => {
    await loginAsAdmin(page);
    const errors = attachErrorListeners(page);

    await page.goto('/app/properties', { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'Property & Parcel Profile' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open Property Profile' })).toBeVisible();
    const parcelInput = page.locator('main input').first();
    if (await parcelInput.isVisible()) {
      await parcelInput.fill('P-100');
      await parcelInput.press('Enter');
      await page.waitForLoadState('networkidle');
    }
    errors.assertClean('/app/properties');
  });

  test('Field Inspector Mode switches cleanly between Online and Offline states', async ({ page, context }) => {
    await loginAsAdmin(page);
    const errors = attachErrorListeners(page);

    await page.goto('/app/field-inspector', { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'Field Inspector Mode' })).toBeVisible();
    await expect(page.getByText('Online')).toBeVisible();

    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await expect(page.getByText(/Offline/i).first()).toBeVisible();

    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(page.getByText('Online')).toBeVisible();
    errors.assertClean('/app/field-inspector');
  });
});
