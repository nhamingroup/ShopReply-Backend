/**
 * Record a ~60s demo video of ShopReply extension.
 *
 * Flow:
 *   1. Popup — show stats, toggles, recent replies
 *   2. Q&A Database — browse, search
 *   3. Auto-Reply Log — review entries
 *   4. Settings — adjust thresholds
 *   5. Import & Train — show import options
 *   6. Facebook mock — show suggestion panel in action
 *
 * Run:  npx playwright test tests/record-demo.spec.ts
 * Output: ../screenshots/demo-video.webm
 */

import { test } from '@playwright/test';
import { createServer } from './serve';
import { CHROME_MOCK_SCRIPT } from './chrome-mock';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 9879;
const OUT_DIR = path.resolve(__dirname, '..', '..', 'screenshots');
const VP = { width: 1280, height: 800 };

let server: any;

test.beforeAll(async () => {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  server = await createServer(PORT);
});
test.afterAll(() => server?.close());

test('Record ShopReply demo video', async ({ browser }) => {
  test.setTimeout(120000);

  const ctx = await browser.newContext({
    viewport: VP,
    recordVideo: {
      dir: OUT_DIR,
      size: VP,
    },
  });

  const page = await ctx.newPage();

  // Helper: smooth scroll to element
  async function scrollTo(selector: string) {
    await page.evaluate((sel) => {
      document.querySelector(sel)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, selector);
    await page.waitForTimeout(600);
  }

  // Helper: highlight element briefly
  async function highlight(selector: string) {
    await page.evaluate((sel) => {
      const el = document.querySelector(sel) as HTMLElement;
      if (!el) return;
      const orig = el.style.boxShadow;
      el.style.boxShadow = '0 0 0 3px #2563eb, 0 0 12px rgba(37,99,235,0.3)';
      el.style.transition = 'box-shadow 0.3s';
      setTimeout(() => { el.style.boxShadow = orig; }, 1500);
    }, selector);
    await page.waitForTimeout(400);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SCENE 1: Popup (5s)
  // ═══════════════════════════════════════════════════════════════════════════
  await page.addInitScript({ content: CHROME_MOCK_SCRIPT });
  await page.addInitScript(() => { localStorage.setItem('shopreply_lang', 'vi'); });
  await page.goto(`http://localhost:${PORT}/popup.html`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000); // Let user see the popup

  // Highlight stats
  await page.waitForTimeout(1500);

  // Click toggle
  const toggles = page.locator('button[role="switch"], input[type="checkbox"]');
  if (await toggles.count() > 0) {
    await toggles.first().click();
    await page.waitForTimeout(800);
    await toggles.first().click();
    await page.waitForTimeout(800);
  }

  await page.waitForTimeout(1000);

  // ═══════════════════════════════════════════════════════════════════════════
  // SCENE 2: Q&A Database (8s)
  // ═══════════════════════════════════════════════════════════════════════════
  await page.goto(`http://localhost:${PORT}/options.html#qa`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  // Click search box and type
  const searchInput = page.locator('input[placeholder*="Tim"], input[placeholder*="Search"], input[type="search"]').first();
  if (await searchInput.isVisible()) {
    await searchInput.click();
    await page.waitForTimeout(500);
    await searchInput.fill('hoodie');
    await page.waitForTimeout(1500);
    await searchInput.clear();
    await page.waitForTimeout(500);
  }

  // Hover over rows
  const rows = page.locator('table tbody tr, [class*="row"]');
  const rowCount = await rows.count();
  for (let i = 0; i < Math.min(rowCount, 3); i++) {
    await rows.nth(i).hover();
    await page.waitForTimeout(600);
  }

  await page.waitForTimeout(1000);

  // ═══════════════════════════════════════════════════════════════════════════
  // SCENE 3: Auto-Reply Log (8s)
  // ═══════════════════════════════════════════════════════════════════════════
  // Click Log tab
  const logTab = page.locator('button, a, [role="tab"]').filter({ hasText: /Nhật ký|Log/i }).first();
  if (await logTab.isVisible()) {
    await logTab.click();
  } else {
    await page.goto(`http://localhost:${PORT}/options.html#log`);
  }
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  // Hover stat cards
  const statCards = page.locator('[class*="stat"], [class*="card"], [class*="summary"]');
  const cardCount = await statCards.count();
  for (let i = 0; i < Math.min(cardCount, 5); i++) {
    await statCards.nth(i).hover();
    await page.waitForTimeout(500);
  }

  // Click "Đúng" button on first log entry
  const okBtn = page.locator('button').filter({ hasText: /Đúng|OK/i }).first();
  if (await okBtn.isVisible()) {
    await okBtn.click();
    await page.waitForTimeout(1000);
  }

  await page.waitForTimeout(1000);

  // ═══════════════════════════════════════════════════════════════════════════
  // SCENE 4: Settings (8s)
  // ═══════════════════════════════════════════════════════════════════════════
  const settingsTab = page.locator('button, a, [role="tab"]').filter({ hasText: /Cài đặt|Settings/i }).first();
  if (await settingsTab.isVisible()) {
    await settingsTab.click();
  } else {
    await page.goto(`http://localhost:${PORT}/options.html#settings`);
  }
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  // Interact with sliders if visible
  const sliders = page.locator('input[type="range"]');
  const sliderCount = await sliders.count();
  if (sliderCount > 0) {
    const slider = sliders.first();
    await slider.hover();
    await page.waitForTimeout(500);
    // Drag slider
    const box = await slider.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2, { steps: 10 });
      await page.mouse.up();
      await page.waitForTimeout(800);
    }
  }

  // Scroll down to see more settings
  await page.evaluate(() => window.scrollBy({ top: 300, behavior: 'smooth' }));
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.scrollBy({ top: 300, behavior: 'smooth' }));
  await page.waitForTimeout(1500);

  // ═══════════════════════════════════════════════════════════════════════════
  // SCENE 5: Import & Train (6s)
  // ═══════════════════════════════════════════════════════════════════════════
  const importTab = page.locator('button, a, [role="tab"]').filter({ hasText: /Import|Huấn luyện/i }).first();
  if (await importTab.isVisible()) {
    await importTab.click();
  } else {
    await page.goto(`http://localhost:${PORT}/options.html#import`);
  }
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  // Scroll through import options
  await page.evaluate(() => window.scrollBy({ top: 200, behavior: 'smooth' }));
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.scrollBy({ top: 200, behavior: 'smooth' }));
  await page.waitForTimeout(1500);

  // ═══════════════════════════════════════════════════════════════════════════
  // SCENE 6: Facebook Mock with Suggestion Panel (10s)
  // ═══════════════════════════════════════════════════════════════════════════
  const mockPath = path.resolve(__dirname, 'mock-facebook.html');
  await page.goto(`file:///${mockPath.replace(/\\/g, '/')}`);
  await page.waitForLoadState('load');
  await page.waitForTimeout(2000);

  // Hover over chat items in sidebar
  const chatItems = page.locator('.chat-item');
  const chatCount = await chatItems.count();
  for (let i = 0; i < Math.min(chatCount, 3); i++) {
    await chatItems.nth(i).hover();
    await page.waitForTimeout(600);
  }

  // Focus on suggestion panel
  await page.locator('.sr-panel').hover();
  await page.waitForTimeout(1000);

  // Hover Send button
  await page.locator('.sr-send-db').hover();
  await page.waitForTimeout(800);

  // Click Send
  await page.locator('.sr-send-db').click();
  await page.waitForTimeout(1500);

  // Hover AI send
  await page.locator('.sr-send-ai').hover();
  await page.waitForTimeout(1000);

  // Final pause
  await page.waitForTimeout(2000);

  // ═══════════════════════════════════════════════════════════════════════════
  // DONE — close context to save video
  // ═══════════════════════════════════════════════════════════════════════════
  await ctx.close();

  // Rename the video file
  const videoFiles = fs.readdirSync(OUT_DIR).filter(f => f.endsWith('.webm') && !f.startsWith('demo'));
  if (videoFiles.length > 0) {
    // Get the most recent .webm file
    const sorted = videoFiles
      .map(f => ({ name: f, time: fs.statSync(path.join(OUT_DIR, f)).mtimeMs }))
      .sort((a, b) => b.time - a.time);

    const src = path.join(OUT_DIR, sorted[0].name);
    const dest = path.join(OUT_DIR, 'demo-video.webm');
    if (fs.existsSync(dest)) fs.unlinkSync(dest);
    fs.renameSync(src, dest);
    console.log(`\n✅ Demo video saved: ${dest}`);
  }
});
