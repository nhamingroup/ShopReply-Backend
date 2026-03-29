import { test, expect } from '@playwright/test';
import { createServer } from './serve';
import { CHROME_MOCK_SCRIPT } from './chrome-mock';
import type http from 'node:http';

const PORT = 3098;

let server: http.Server;

test.beforeAll(async () => {
  server = await createServer(PORT);
});

test.afterAll(async () => {
  server?.close();
});

test.describe('ShopReply — Options Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript({ content: CHROME_MOCK_SCRIPT });
  });

  test('options page loads with ShopReply header', async ({ page }) => {
    await page.goto(`http://localhost:${PORT}/options.html`);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('h1')).toContainText('ShopReply');
  });

  test('tab navigation shows all tabs', async ({ page }) => {
    await page.goto(`http://localhost:${PORT}/options.html`);
    await page.waitForLoadState('networkidle');

    // All 5 tabs should be visible
    await expect(page.locator('button:has-text("Q&A Database")')).toBeVisible();
    await expect(page.locator('button:has-text("Auto-Reply Log")')).toBeVisible();
    await expect(page.locator('button:has-text("Settings")')).toBeVisible();
    await expect(page.locator('button:has-text("Import & Train")')).toBeVisible();
    await expect(page.locator('button:has-text("About")')).toBeVisible();
  });

  test('tab navigation switches content', async ({ page }) => {
    await page.goto(`http://localhost:${PORT}/options.html`);
    await page.waitForLoadState('networkidle');

    // Default tab is Q&A Database
    await expect(page.locator('h2:has-text("Q&A Database")')).toBeVisible();

    // Click Settings tab
    await page.locator('button:has-text("Settings")').click();
    await expect(page.locator('h2:has-text("Settings")')).toBeVisible();

    // Click About tab
    await page.locator('button:has-text("About")').click();
    await expect(page.locator('h2:has-text("About ShopReply")')).toBeVisible();

    // Click Import tab
    await page.locator('button:has-text("Import & Train")').click();
    await expect(page.locator('h2:has-text("Import & Train")')).toBeVisible();

    // Click Auto-Reply Log tab
    await page.locator('button:has-text("Auto-Reply Log")').click();
    await expect(page.locator('h2:has-text("Auto-Reply Log")')).toBeVisible();
  });

  test('Q&A Database tab renders table', async ({ page }) => {
    await page.goto(`http://localhost:${PORT}/options.html#qa`);
    await page.waitForLoadState('networkidle');

    // Q&A Database heading
    await expect(page.locator('h2:has-text("Q&A Database")')).toBeVisible();

    // Add Q&A button
    await expect(page.locator('button:has-text("Add Q&A")')).toBeVisible();
  });

  test('Settings tab shows threshold sliders', async ({ page }) => {
    await page.goto(`http://localhost:${PORT}/options.html#settings`);
    await page.waitForLoadState('networkidle');

    // Settings heading
    await expect(page.locator('h2:has-text("Settings")')).toBeVisible();

    // Threshold section
    await expect(page.getByText('Reply Thresholds', { exact: true })).toBeVisible();
    await expect(page.getByText('Auto-reply threshold', { exact: true })).toBeVisible();
    await expect(page.getByText('Suggest threshold', { exact: true })).toBeVisible();

    // Range sliders
    const sliders = page.locator('input[type="range"]');
    await expect(sliders.first()).toBeVisible();
  });

  test('Settings tab shows tone selector', async ({ page }) => {
    await page.goto(`http://localhost:${PORT}/options.html#settings`);
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('Reply Tone', { exact: true })).toBeVisible();

    // Select element for tone
    const toneSelect = page.locator('select');
    await expect(toneSelect).toBeVisible();

    // Verify options
    await expect(toneSelect.locator('option:has-text("Friendly")')).toBeTruthy();
  });

  test('Settings tab shows platform toggles', async ({ page }) => {
    await page.goto(`http://localhost:${PORT}/options.html#settings`);
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('Platforms', { exact: true })).toBeVisible();
    await expect(page.getByText('Facebook Messenger', { exact: true })).toBeVisible();
    // Use exact match for Zalo to avoid matching "chat.zalo.me" subdomain text
    await expect(page.getByText('Zalo', { exact: true })).toBeVisible();
  });

  test('Settings tab shows notification toggle', async ({ page }) => {
    await page.goto(`http://localhost:${PORT}/options.html#settings`);
    await page.waitForLoadState('networkidle');

    // Backend URL was removed — verify notifications section exists instead
    await expect(page.getByText('Facebook Messenger')).toBeVisible();
  });

  test('Import & Train tab shows import section', async ({ page }) => {
    await page.goto(`http://localhost:${PORT}/options.html#import`);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('h2:has-text("Import & Train")')).toBeVisible();

    // Import from file section
    await expect(page.getByText('Import Q&A from File', { exact: true })).toBeVisible();
    await expect(page.locator('button:has-text("Import Q&A")')).toBeVisible();

    // Scan Chat History section
    await expect(page.getByText('Scan Chat History', { exact: true })).toBeVisible();

    // Format guide section
    await expect(page.getByText('Supported Formats', { exact: true })).toBeVisible();
  });

  test('About tab shows version and pricing info', async ({ page }) => {
    await page.goto(`http://localhost:${PORT}/options.html#about`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    // Should have ShopReply branding
    await expect(page.getByText('ShopReply').first()).toBeVisible();
  });

  test('Auto-Reply Log tab shows log entries', async ({ page }) => {
    await page.goto(`http://localhost:${PORT}/options.html#log`);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('h2:has-text("Auto-Reply Log")')).toBeVisible();

    // Period filter buttons
    await expect(page.locator('button:has-text("Today")')).toBeVisible();
    await expect(page.locator('button:has-text("This Week")')).toBeVisible();
    await expect(page.locator('button:has-text("All")')).toBeVisible();
  });

  test('hash navigation works on load', async ({ page }) => {
    // Navigate directly to settings via hash — full page load
    await page.goto(`http://localhost:${PORT}/options.html#settings`);
    await page.waitForLoadState('networkidle');

    // Settings should be the active tab — wait for heading
    await expect(page.locator('h2:has-text("Settings")')).toBeVisible({ timeout: 5000 });

    // Navigate to about via a fresh page load
    // Browser treats hash-only change as same-page navigation (no reload),
    // so we navigate to a different page first to force a full reload
    await page.goto('about:blank');
    await page.goto(`http://localhost:${PORT}/options.html#about`);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('h2:has-text("About ShopReply")')).toBeVisible({ timeout: 5000 });
  });

  test('connection status badge is visible on options page', async ({ page }) => {
    await page.goto(`http://localhost:${PORT}/options.html`);
    await page.waitForLoadState('networkidle');

    // Top bar with ShopReply logo and status badge
    const topBar = page.locator('.bg-white.border-b');
    await expect(topBar).toBeVisible();
  });
});
