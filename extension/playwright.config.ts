import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  retries: 1,
  use: {
    headless: true,
  },
  reporter: [['list']],
  // No webServer — tests use custom serve.ts with per-file ports
});
