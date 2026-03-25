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

  /* Start Angular dev server before tests - Electron is launched directly in tests */
  webServer: {
    command: 'yarn ng:serve:dev',
    url: 'http://localhost:4200',
    timeout: 300 * 1000, // 5 minutes
    reuseExistingServer: true, // reuse if already running
  },
});
