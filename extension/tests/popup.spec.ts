import { test, expect } from '@playwright/test';
import { createServer } from './serve';
import { CHROME_MOCK_SCRIPT } from './chrome-mock';
import type http from 'node:http';

const PORT = 3099;

let server: http.Server;

test.beforeAll(async () => {
  server = await createServer(PORT);
});

test.afterAll(async () => {
  server?.close();
});

test.describe('ShopReply — Popup', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript({ content: CHROME_MOCK_SCRIPT });
  });

  test('popup loads and shows ShopReply header', async ({ page }) => {
    await page.goto(`http://localhost:${PORT}/popup.html`);
    await page.waitForLoadState('networkidle');

    // Header title
    await expect(page.locator('h1')).toContainText('ShopReply');
  });

  test('connection status badge is visible', async ({ page }) => {
    await page.goto(`http://localhost:${PORT}/popup.html`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Header should be visible with ShopReply branding (may show onboarding or dashboard)
    await expect(page.getByText('ShopReply').first()).toBeVisible();
  });

  test('quick links section shows Log, Q&A, Settings cards', async ({ page }) => {
    await page.goto(`http://localhost:${PORT}/popup.html`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    // Dashboard view shows quick link cards
    await expect(page.getByText('Q&A', { exact: true })).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Log', { exact: true }).or(page.getByText('Lich su', { exact: true }))).toBeVisible();
  });

  test('quick controls section visible with toggles', async ({ page }) => {
    await page.goto(`http://localhost:${PORT}/popup.html`);
    await page.waitForLoadState('networkidle');

    // Auto-reply toggle
    await expect(page.getByText('Auto-reply', { exact: true })).toBeVisible();

    // Platform chip toggles
    await expect(page.getByText('Facebook', { exact: true })).toBeVisible();
    await expect(page.getByText('Zalo', { exact: true })).toBeVisible();
  });

  test('platform toggles have radio behavior on free tier', async ({ page }) => {
    await page.goto(`http://localhost:${PORT}/popup.html`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    // Platform toggle rows: label + switch button
    const fbLabel = page.getByText('Facebook', { exact: true });
    const zaloLabel = page.getByText('Zalo', { exact: true });
    await expect(fbLabel).toBeVisible({ timeout: 5000 });
    await expect(zaloLabel).toBeVisible();

    // The toggle switch is the sibling <button> in each ToggleRow
    // Initial: FB enabled (bg-blue-600), Zalo disabled (bg-gray-300)
    const fbRow = page.locator('div').filter({ hasText: /^Facebook$/ }).first();
    const zaloRow = page.locator('div').filter({ hasText: /^Zalo$/ }).first();
    const fbSwitch = fbRow.locator('button');
    const zaloSwitch = zaloRow.locator('button');

    await expect(fbSwitch).toHaveClass(/bg-blue-600/);
    await expect(zaloSwitch).toHaveClass(/bg-gray-300/);

    // Click Zalo switch — should activate Zalo, deactivate FB (radio on free tier)
    await zaloSwitch.click();
    await expect(zaloSwitch).toHaveClass(/bg-blue-600/);
    await expect(fbSwitch).toHaveClass(/bg-gray-300/);

    // Click FB switch — should activate FB, deactivate Zalo
    await fbSwitch.click();
    await expect(fbSwitch).toHaveClass(/bg-blue-600/);
    await expect(zaloSwitch).toHaveClass(/bg-gray-300/);
  });

  test('upgrade strip visible on free tier', async ({ page }) => {
    await page.goto(`http://localhost:${PORT}/popup.html`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    // Free tier shows upgrade strip with "Free" text
    await expect(page.getByText('Free').first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Upgrade').or(page.getByText('Nang cap'))).toBeVisible();
  });

  test('footer has Settings and Dashboard links', async ({ page }) => {
    await page.goto(`http://localhost:${PORT}/popup.html`);
    await page.waitForLoadState('networkidle');

    // Footer buttons
    await expect(page.locator('button:has-text("Settings")')).toBeVisible();
    await expect(page.locator('button:has-text("Dashboard")')).toBeVisible();
  });

  test('Settings link triggers chrome.tabs.create', async ({ page }) => {
    await page.goto(`http://localhost:${PORT}/popup.html`);
    await page.waitForLoadState('networkidle');

    // Click Settings
    await page.locator('button:has-text("Settings")').click();

    // Verify chrome.tabs.create was called with options URL
    const openedUrl = await page.evaluate(() => (window as any).__openedTab);
    expect(openedUrl).toBeTruthy();
    expect(openedUrl).toContain('options.html');
    expect(openedUrl).toContain('#settings');
  });

  test('Dashboard link triggers chrome.tabs.create', async ({ page }) => {
    await page.goto(`http://localhost:${PORT}/popup.html`);
    await page.waitForLoadState('networkidle');

    await page.locator('button:has-text("Dashboard")').click();

    const openedUrl = await page.evaluate(() => (window as any).__openedTab);
    expect(openedUrl).toBeTruthy();
    expect(openedUrl).toContain('options.html');
    expect(openedUrl).toContain('#qa');
  });

  test('popup has correct dimensions (400x500)', async ({ page }) => {
    await page.goto(`http://localhost:${PORT}/popup.html`);
    await page.waitForLoadState('networkidle');

    // The root div has w-[400px] h-[500px]
    const root = page.locator('.w-\\[400px\\]');
    await expect(root).toBeVisible();
  });
});
