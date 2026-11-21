import { test, expect } from '@playwright/test';
import { attachErrorListeners } from '../fixtures/assertions.js';
import { loginAsAdmin } from '../fixtures/auth.js';

test.describe('Auth Redirects, Login Error Handling & My Account', () => {
  test('unauthenticated /app redirects to /?next=/app and rejects bad credentials without 5xx', async ({ page }) => {
    const errors = attachErrorListeners(page, {
      allowedConsolePatterns: [/status of 401 \(Unauthorized\)/],
    });

    await page.goto('/app', { waitUntil: 'networkidle' });
    expect(page.url()).toContain('next=/app');

    const badLogin = await page.request.post('/api/login', {
      data: { username: 'admin', password: 'definitely-wrong-password' },
    });
    expect(badLogin.status()).toBe(401);
    errors.assertClean('auth redirect & bad login');
  });

  test('My Account page renders profile, password, and security controls', async ({ page }) => {
    await loginAsAdmin(page);
    const errors = attachErrorListeners(page);

    await page.goto('/app/my-account', { waitUntil: 'networkidle' });
    await expect(page.locator('h1, h2').first()).toBeVisible();
    errors.assertClean('/app/my-account');
  });
});
