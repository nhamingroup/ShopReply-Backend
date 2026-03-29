import { test } from '@playwright/test';
import { createServer } from './serve';

let server: any;
const PORT = 9877;

test.beforeAll(async () => {
  server = await createServer(PORT);
});
test.afterAll(() => server?.close());

const tabs = ['qa', 'log', 'settings', 'import', 'about'];

for (const tab of tabs) {
  test(`screenshot ${tab} EN`, async ({ page }) => {
    // Force EN
    await page.addInitScript(() => { localStorage.setItem('shopreply_lang', 'en'); });
    await page.goto(`http://localhost:${PORT}/options.html#${tab}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
    await page.screenshot({ path: `../assets/guide/review-en-${tab}.png`, fullPage: true });
  });

  test(`screenshot ${tab} VI`, async ({ page }) => {
    // Force VI
    await page.addInitScript(() => { localStorage.setItem('shopreply_lang', 'vi'); });
    await page.goto(`http://localhost:${PORT}/options.html#${tab}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
    await page.screenshot({ path: `../assets/guide/review-vi-${tab}.png`, fullPage: true });
  });
}

test('screenshot popup EN', async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('shopreply_lang', 'en'); });
  await page.goto(`http://localhost:${PORT}/popup.html`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
  await page.screenshot({ path: '../assets/guide/review-en-popup.png' });
});

test('screenshot popup VI', async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('shopreply_lang', 'vi'); });
  await page.goto(`http://localhost:${PORT}/popup.html`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
  await page.screenshot({ path: '../assets/guide/review-vi-popup.png' });
});
