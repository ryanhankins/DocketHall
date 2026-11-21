import { expect } from '@playwright/test';

/**
 * Attach runtime error listeners to a Playwright page so every spec fails on
 * uncaught JS errors, console errors, or HTTP 5xx API/page responses.
 */
export function attachErrorListeners(page, { allowedConsolePatterns = [], allowedStatusPatterns = [] } = {}) {
  const consoleErrors = [];
  const pageErrors = [];
  const serverErrors = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (!allowedConsolePatterns.some((re) => re.test(text))) {
        consoleErrors.push(text);
      }
    }
  });

  page.on('pageerror', (err) => {
    pageErrors.push(String(err));
  });

  page.on('response', (res) => {
    const status = res.status();
    if (status >= 500) {
      const url = res.url();
      if (!allowedStatusPatterns.some((re) => re.test(url))) {
        serverErrors.push(`${status} ${res.request().method()} ${url}`);
      }
    }
  });

  return {
    consoleErrors,
    pageErrors,
    serverErrors,
    assertClean(contextLabel = 'page') {
      expect(pageErrors, `Uncaught pageerror(s) on ${contextLabel}`).toEqual([]);
      expect(consoleErrors, `Console error(s) on ${contextLabel}`).toEqual([]);
      expect(serverErrors, `HTTP 5xx response(s) on ${contextLabel}`).toEqual([]);
    },
    reset() {
      consoleErrors.length = 0;
      pageErrors.length = 0;
      serverErrors.length = 0;
    },
  };
}
