import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  // Limit to 1 worker in CI to avoid resource contention (SIGBUS) from
  // multiple Electron+webpack-dev-server instances running in parallel.
  workers: process.env['CI'] ? 1 : undefined,
  outputDir: 'test-results',
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['list'],
  ],
  use: {
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
  },
});
