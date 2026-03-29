/**
 * Generate 5 CWS screenshots at 1280x800 PNG RGB 24-bit
 *
 * 1. Suggestion Panel on Facebook (mock)
 * 2. Q&A Database (options #qa)
 * 3. Import Q&A (options #import)
 * 4. Popup — Connection Status (centered on gradient bg)
 * 5. Auto-Reply Log (options #log)
 *
 * Run: npx playwright test tests/screenshot-cws.spec.ts
 * Output: ../screenshots/ (CWS-ready)
 */

import { test } from '@playwright/test';
import { createServer } from './serve';
import { CHROME_MOCK_SCRIPT } from './chrome-mock';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 9878;
const OUT_DIR = path.resolve(__dirname, '..', '..', 'screenshots');
const VP = { width: 1280, height: 800 };

let server: any;

test.beforeAll(async () => {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  server = await createServer(PORT);
});

test.afterAll(() => server?.close());

// ─── Screenshot 1: Suggestion Panel on Facebook ─────────────────────────────
test('CWS 1 — Facebook Suggestion Panel', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: VP });
  const page = await ctx.newPage();

  // Serve mock-facebook.html from local file
  const mockPath = path.resolve(__dirname, 'mock-facebook.html');
  await page.goto(`file:///${mockPath.replace(/\\/g, '/')}`);
  await page.waitForLoadState('load');
  await page.waitForTimeout(300);

  await page.screenshot({
    path: path.join(OUT_DIR, 'cws-1-facebook-panel.png'),
    type: 'png',
  });
  await ctx.close();
});

// ─── Screenshot 2: Q&A Database ─────────────────────────────────────────────
test('CWS 2 — Q&A Database', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: VP });
  const page = await ctx.newPage();

  await page.addInitScript({ content: CHROME_MOCK_SCRIPT });
  await page.addInitScript(() => { localStorage.setItem('shopreply_lang', 'vi'); });
  await page.goto(`http://localhost:${PORT}/options.html#qa`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);

  await page.screenshot({
    path: path.join(OUT_DIR, 'cws-2-qa-database.png'),
    type: 'png',
  });
  await ctx.close();
});

// ─── Screenshot 3: Import Q&A ───────────────────────────────────────────────
test('CWS 3 — Import Q&A', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: VP });
  const page = await ctx.newPage();

  await page.addInitScript({ content: CHROME_MOCK_SCRIPT });
  await page.addInitScript(() => { localStorage.setItem('shopreply_lang', 'vi'); });
  await page.goto(`http://localhost:${PORT}/options.html#import`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);

  await page.screenshot({
    path: path.join(OUT_DIR, 'cws-3-import-qa.png'),
    type: 'png',
  });
  await ctx.close();
});

// ─── Screenshot 4: Popup ────────────────────────────────────────────────────
test('CWS 4 — Popup', async ({ browser }) => {
  // Render popup centered on a nice gradient background at 1280x800
  const ctx = await browser.newContext({ viewport: VP });
  const page = await ctx.newPage();

  await page.addInitScript({ content: CHROME_MOCK_SCRIPT });
  await page.addInitScript(() => { localStorage.setItem('shopreply_lang', 'vi'); });

  // Create a wrapper page that embeds popup in an iframe, centered
  const wrapperHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  body {
    margin: 0; display: flex; align-items: center; justify-content: center;
    height: 100vh;
    background: linear-gradient(135deg, #1e3a5f 0%, #2563eb 50%, #7c3aed 100%);
    font-family: -apple-system, sans-serif;
  }
  .phone-frame {
    width: 400px;
    background: #fff;
    border-radius: 16px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.1);
    overflow: hidden;
  }
  iframe {
    width: 400px;
    height: 520px;
    border: none;
    display: block;
  }
  .label {
    position: absolute;
    bottom: 40px;
    color: rgba(255,255,255,0.7);
    font-size: 14px;
    letter-spacing: 1px;
  }
</style></head><body>
  <div class="phone-frame">
    <iframe src="http://localhost:${PORT}/popup.html"></iframe>
  </div>
</body></html>`;

  await page.setContent(wrapperHtml, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  await page.screenshot({
    path: path.join(OUT_DIR, 'cws-4-popup.png'),
    type: 'png',
  });
  await ctx.close();
});

// ─── Screenshot 5: Auto-Reply Log ───────────────────────────────────────────
test('CWS 5 — Auto-Reply Log', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: VP });
  const page = await ctx.newPage();

  await page.addInitScript({ content: CHROME_MOCK_SCRIPT });
  await page.addInitScript(() => { localStorage.setItem('shopreply_lang', 'vi'); });
  await page.goto(`http://localhost:${PORT}/options.html#log`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);

  await page.screenshot({
    path: path.join(OUT_DIR, 'cws-5-auto-reply-log.png'),
    type: 'png',
  });
  await ctx.close();
});
