import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  timeout: 60000,
  outputDir: './screenshots',
  workers: 1,
  use: {
    headless: false,
    viewport: { width: 1280, height: 720 },
    trace: 'on-first-retry',
  },
});
