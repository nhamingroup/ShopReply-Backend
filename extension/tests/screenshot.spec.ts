import { test } from '@playwright/test';
import { createServer } from './serve';
import { CHROME_MOCK_SCRIPT } from './chrome-mock';
import type http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 3098;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOT_DIR = path.resolve(__dirname, 'screenshots');

let server: http.Server;

test.beforeAll(async () => {
  // Ensure screenshots directory exists
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }
  server = await createServer(PORT);
});

test.afterAll(async () => {
  server?.close();
});

test.describe('ShopReply — Screenshots', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript({ content: CHROME_MOCK_SCRIPT });
  });

  test('popup.html — full page', async ({ page }) => {
    // Popup is typically narrow (Chrome extension popup width)
    await page.setViewportSize({ width: 400, height: 600 });
    await page.goto(`http://localhost:${PORT}/popup.html`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'popup.png'),
      fullPage: true,
    });
  });

  test('options.html#settings — Settings tab', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`http://localhost:${PORT}/options.html#settings`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'options-settings.png'),
      fullPage: true,
    });
  });

  test('options.html#about — About tab', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`http://localhost:${PORT}/options.html#about`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'options-about.png'),
      fullPage: true,
    });
  });

  test('options.html#qa — QA Database tab', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`http://localhost:${PORT}/options.html#qa`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'options-qa.png'),
      fullPage: true,
    });
  });

  test('options.html#log — Auto-Reply Log tab', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`http://localhost:${PORT}/options.html#log`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'options-log.png'),
      fullPage: true,
    });
  });

  test('options.html#import — Import tab', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`http://localhost:${PORT}/options.html#import`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'options-import.png'),
      fullPage: true,
    });
  });
});
