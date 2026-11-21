import { expect } from '@playwright/test';

const ADMIN_USER = process.env.CIVICDESK_ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.CIVICDESK_ADMIN_PASS || 'admin';

/**
 * Log in via the /api/login endpoint inside the browser context so session
 * cookies are stored cleanly, then navigate to /app.
 */
export async function loginAsAdmin(page) {
  await page.goto('/');
  const res = await page.request.post('/api/login', {
    data: { username: ADMIN_USER, password: ADMIN_PASS },
  });
  expect(res.status(), 'Admin /api/login should succeed').toBe(200);
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
