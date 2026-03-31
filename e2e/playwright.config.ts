import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  timeout: 60000,
  outputDir: './playwright-report/test-results',
  workers: 1,
  reporter: [
    [
      'html',
      {
        outputFolder: './playwright-report',
        open: 'never',
      },
    ],
    ['list'],
  ],
  use: {
    headless: false,
    viewport: { width: 1280, height: 720 },
    screenshot: { mode: 'only-on-failure', fullPage: true },
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
  },
});
