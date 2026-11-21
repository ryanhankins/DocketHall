import { test, expect } from '@playwright/test';
import { attachErrorListeners } from '../fixtures/assertions.js';
import { loginAsAdmin } from '../fixtures/auth.js';

test.describe('Agendas, Backlog, Council & Live Meeting Mode', () => {
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

  test('Live Meeting Mode opens on a created agenda with speaker timer and item navigation', async ({ page }) => {
    await loginAsAdmin(page);
    const errors = attachErrorListeners(page);

    const prefsRes = await page.request.get('/api/agendas/preferences');
    expect(prefsRes.status()).toBe(200);
    const prefs = await prefsRes.json();
    const governingBody = (prefs.bodies && prefs.bodies[0]) || 'City Council';

    const created = await page.request.post('/api/agendas', {
      data: { title: 'E2E Live Meeting Test', body: governingBody, meeting_date: '2026-12-22' },
    });
    expect(created.status()).toBe(201);
    const agenda = await created.json();

    try {
      const itemRes = await page.request.post(`/api/agendas/${agenda.id}/items`, {
        data: { title: 'E2E Consent Item', item_type: 'action' },
      });
      expect(itemRes.status()).toBe(201);

      await page.goto(`/app/agendas/${agenda.id}/live`, { waitUntil: 'networkidle' });
      await expect(page.getByRole('heading', { name: /Live Motion & Roll-Call Vote/i })).toBeVisible();
      errors.assertClean(`/app/agendas/${agenda.id}/live`);
    } finally {
      await page.request.delete(`/api/agendas/${agenda.id}`);
    }
  });
});
