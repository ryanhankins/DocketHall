import { expect } from '@playwright/test';

const ADMIN_USER = process.env.CIVICDESK_ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.CIVICDESK_ADMIN_PASS || 'admin';

let cachedAdminCookies = null;

/**
 * Log in via /api/login once and reuse the session cookies across tests in the
 * worker so repeated test logins do not trip login rate limiting (429).
 */
export async function loginAsAdmin(page) {
  await page.goto('/');
  if (cachedAdminCookies) {
    await page.context().addCookies(cachedAdminCookies);
    const me = await page.request.get('/api/me');
    if (me.status() === 200) {
      await page.goto('/app');
      await page.waitForLoadState('networkidle');
      return;
    }
    cachedAdminCookies = null;
  }

  const res = await page.request.post('/api/login', {
    data: { username: ADMIN_USER, password: ADMIN_PASS },
  });
  expect(res.status(), 'Admin /api/login should succeed').toBe(200);
  cachedAdminCookies = await page.context().cookies();
  await page.goto('/app');
  await page.waitForLoadState('networkidle');
}

/**
 * Fetch enabled module IDs and all core/module navigation routes from the
 * running API so the route crawler adapts to the active deployment.
 */
export async function getActiveModules(page) {
  const res = await page.request.get('/api/modules');
  expect(res.status()).toBe(200);
  const data = await res.json();
  return data.modules || [];
}
