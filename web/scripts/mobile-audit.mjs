import { chromium } from 'playwright-core';

const BASE = (process.env.MOBILE_TEST_URL || 'http://localhost:8080').replace(/\/$/, '');
const USER = process.env.MOBILE_TEST_USER || 'admin';
const PASS = process.env.MOBILE_TEST_PASS || 'admin';
const CHROME_PATH = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const VIEWPORTS = [
  { name: '390x844', width: 390, height: 844 },
  { name: '375x812', width: 375, height: 812 },
];

async function auditCurrentPage(page, label) {
  return page.evaluate((pageLabel) => {
    const issues = [];
    const vw = window.innerWidth;

    // 1. Document-level horizontal overflow
    const docOverflow = document.documentElement.scrollWidth - vw;
    if (docOverflow > 2) {
      issues.push(`${pageLabel}: horizontal page overflow (+${docOverflow}px, scrollWidth=${document.documentElement.scrollWidth} > innerWidth=${vw})`);
    }

    // 2. Nav items / sub-items overflowing right edge
    for (const el of document.querySelectorAll('nav button, nav a, nav input')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right > vw + 2 || r.left < -2) {
        const txt = (el.innerText || el.placeholder || el.tagName).trim().slice(0, 40);
        issues.push(`${pageLabel}: nav element "${txt}" overflows viewport (left=${Math.round(r.left)}, right=${Math.round(r.right)}, vw=${vw})`);
      }
    }

    // 3. Squished / letter-by-letter table cells
    for (const cell of document.querySelectorAll('table th, table td')) {
      const r = cell.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const txt = (cell.innerText || '').trim();
      if (txt.length >= 4 && r.width < 36) {
        issues.push(`${pageLabel}: squished table cell "${txt.slice(0, 24)}" width=${Math.round(r.width)}px`);
      }
      if (txt.length >= 4 && txt.length <= 16 && !/\s/.test(txt)) {
        const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          const val = (node.nodeValue || '').trim();
          if (val.length >= 4 && !/\s/.test(val)) {
            const range = document.createRange();
            range.selectNodeContents(node);
            const rects = range.getClientRects();
            if (rects.length > 2) {
              issues.push(`${pageLabel}: letter-by-letter wrap in cell "${val}" (${rects.length} lines, w=${Math.round(r.width)}px)`);
            }
          }
        }
      }
    }

    return issues;
  }, label);
}

async function run() {
  const browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });
  const allIssues = [];

  try {
    for (const vp of VIEWPORTS) {
      const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      const page = await context.newPage();

      // Public pages
      for (const path of ['/', '/portal', '/code']) {
        await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 20000 });
        await page.waitForTimeout(300);
        allIssues.push(...(await auditCurrentPage(page, `[${vp.name}] ${path}`)));
      }

      // Sign in to /app
      await page.goto(`${BASE}/`, { waitUntil: 'networkidle', timeout: 20000 });
      const loginRes = await page.evaluate(async ({ u, p }) => {
        const r = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ username: u, password: p }),
        });
        return r.status;
      }, { u: USER, p: PASS });

      if (loginRes !== 200) {
        allIssues.push(`[${vp.name}] /api/login failed with status ${loginRes}`);
        await context.close();
        continue;
      }

      await page.goto(`${BASE}/app`, { waitUntil: 'networkidle', timeout: 20000 });
      await page.waitForSelector('main', { timeout: 10000 });

      // If mobile menu toggle exists, open it and expand all groups to test menu overflow
      const toggleBtn = page.locator('button.mobile-menu-toggle');
      if (await toggleBtn.count()) {
        await toggleBtn.click();
        await page.waitForTimeout(200);
      }

      // Expand any collapsed nav groups so sub-items are visible and audited
      const expandAllBtn = page.locator('nav button', { hasText: /Expand all/i });
      if (await expandAllBtn.count()) {
        await expandAllBtn.click();
        await page.waitForTimeout(200);
      }
      allIssues.push(...(await auditCurrentPage(page, `[${vp.name}] /app (menu expanded)`)));

      // Collect all nav sections & visit every route
      const sections = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('nav .nav-submenu button, nav > div button'));
        return btns.map((b) => b.innerText.trim()).filter(Boolean);
      });

      // Visit key sections by clicking nav buttons
      const visited = new Set();
      const navButtons = page.locator('nav .nav-submenu button');
      const count = await navButtons.count();
      for (let i = 0; i < count; i++) {
        // Re-open mobile menu if clicking a nav item closed it
        if (await toggleBtn.count()) {
          const isNavVisible = await page.locator('nav#menu').isVisible();
          if (!isNavVisible) {
            await toggleBtn.click();
            await page.waitForTimeout(100);
          }
        }
        const btn = navButtons.nth(i);
        const label = (await btn.innerText()).trim();
        if (!label || visited.has(label)) continue;
        visited.add(label);
        await btn.click();
        await page.waitForTimeout(450);
        allIssues.push(...(await auditCurrentPage(page, `[${vp.name}] #${label}`)));
      }

      // Also test an agenda detail page if one exists
      await page.goto(`${BASE}/app#agendas`, { waitUntil: 'networkidle', timeout: 20000 });
      await page.waitForTimeout(400);
      const firstAgendaBtn = page.locator('main table button, main .card a').first();
      if (await firstAgendaBtn.count()) {
        await firstAgendaBtn.click().catch(() => {});
        await page.waitForTimeout(400);
        allIssues.push(...(await auditCurrentPage(page, `[${vp.name}] agenda-detail`)));
      }

      await context.close();
    }
  } finally {
    await browser.close();
  }

  if (allIssues.length > 0) {
    console.error(`FOUND ${allIssues.length} MOBILE LAYOUT ISSUE(S):`);
    for (const iss of allIssues) console.error(' -', iss);
    process.exit(1);
  }
  console.log('MOBILE AUDIT PASSED: 0 layout/overflow/table-wrap issues across all viewports and routes.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
