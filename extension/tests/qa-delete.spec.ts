import { test, expect } from '@playwright/test';
import { createServer } from './serve';
import { CHROME_MOCK_SCRIPT } from './chrome-mock';
import type http from 'node:http';

let server: http.Server;
let PORT: number;

test.beforeAll(async () => {
  PORT = 4400 + Math.floor(Math.random() * 100);
  server = await createServer(PORT);
});

test.afterAll(async () => {
  server?.close();
});

test.describe('Q&A Delete', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript({ content: CHROME_MOCK_SCRIPT });
  });

  test('delete button removes Q&A from list', async ({ page }) => {
    await page.goto(`http://localhost:${PORT}/options.html#qa`);
    await page.waitForLoadState('networkidle');

    // Verify initial Q&A items are visible
    const rows = page.locator('table tbody tr');
    const initialCount = await rows.count();
    expect(initialCount).toBe(3); // MOCK_QA_LIST has 3 items

    // Get first item text for verification
    const firstQuestion = await rows.first().locator('td').nth(1).textContent();
    expect(firstQuestion).toContain('Gia ao hoodie');

    // Click delete on first item, accept the confirmation dialog
    page.on('dialog', (dialog) => dialog.accept());
    await rows.first().locator('button', { hasText: /Delete|Xóa/i }).click();

    // Wait for re-render after delete
    await page.waitForTimeout(500);

    // Verify item was removed from the list
    const afterCount = await page.locator('table tbody tr').count();
    expect(afterCount).toBe(2); // One less item

    // Verify the deleted item is no longer visible
    await expect(page.getByText('Gia ao hoodie')).not.toBeVisible();

    // Verify MSG_DELETE_QA was sent with correct payload
    const sentMessages = await page.evaluate(() => (window as any).__sentMessages);
    const deleteMsg = sentMessages.find((m: any) => m.type === 'MSG_DELETE_QA');
    expect(deleteMsg).toBeTruthy();
    expect(deleteMsg.payload.id).toBe(1);
  });

  test('delete cancel does not remove Q&A', async ({ page }) => {
    await page.goto(`http://localhost:${PORT}/options.html#qa`);
    await page.waitForLoadState('networkidle');

    const initialCount = await page.locator('table tbody tr').count();

    // Click delete but dismiss the confirmation dialog
    page.on('dialog', (dialog) => dialog.dismiss());
    await page.locator('table tbody tr').first().locator('button', { hasText: /Delete|Xóa/i }).click();

    await page.waitForTimeout(300);

    // Count should remain the same
    const afterCount = await page.locator('table tbody tr').count();
    expect(afterCount).toBe(initialCount);

    // No delete message should have been sent
    const sentMessages = await page.evaluate(() => (window as any).__sentMessages);
    const deleteMsg = sentMessages.find((m: any) => m.type === 'MSG_DELETE_QA');
    expect(deleteMsg).toBeFalsy();
  });
});
