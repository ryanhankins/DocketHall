import { test, expect } from '@playwright/test';
import { attachErrorListeners } from '../fixtures/assertions.js';
import { loginAsAdmin } from '../fixtures/auth.js';

test.describe('Admin Launch Readiness, Backup & System Settings', () => {
  test('Backup & Restore resolves City Launch Readiness Checklist and renders backup controls', async ({ page }) => {
    await loginAsAdmin(page);
    const errors = attachErrorListeners(page);

    await page.goto('/app/preferences-backup', { waitUntil: 'networkidle' });

    await expect(page.getByRole('heading', { name: 'Backup & Restore' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download Full Archive (.zip)' })).toBeVisible();

    // Switch to Launch & Demo Setup tab and verify Launch Readiness Checklist resolves
    await page.getByRole('button', { name: 'Launch & Demo Setup' }).click();
    await expect(page.getByRole('heading', { name: 'City Launch Readiness Checklist' })).toBeVisible();
    await expect(page.getByText('Loading readiness checks…')).toBeHidden({ timeout: 10_000 });
    await expect(page.getByText(/ready/i).first()).toBeVisible();

    // Switch to Scheduled Offsite (S3) tab and verify backup schedule controls
    await page.getByRole('button', { name: 'Scheduled Offsite (S3)' }).click();
    await expect(page.getByRole('heading', { name: /Automated Scheduled Backups/i })).toBeVisible();
    errors.assertClean('/app/preferences-backup');
  });

  test('Users, Modules, Integrations, SLA, and Audit Log pages load cleanly', async ({ page }) => {
    const errors = attachErrorListeners(page);
    await loginAsAdmin(page);

    for (const route of [
      '/app/users',
      '/app/modules',
      '/app/integrations',
      '/app/sla-rules',
      '/app/audit',
      '/app/preferences-general',
    ]) {
      errors.reset();
      await page.goto(route, { waitUntil: 'networkidle' });
      await expect(page.locator('h1, h2').first()).toBeVisible();
      errors.assertClean(route);
    }
  });
});
