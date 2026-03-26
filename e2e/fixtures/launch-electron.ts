// e2e/fixtures.ts
import { test as base, expect } from '@playwright/test';
import { ElectronApplication, Page, _electron as electron } from 'playwright';
import * as PATH from 'path';

// Worker-scoped fixtures must be in a separate type
type ElectronWorkerFixtures = {
  app: ElectronApplication;
  firstWindow: Page;
};

export const test = base.extend<{}, ElectronWorkerFixtures>({
  // Second generic = worker-scoped fixtures
  app: [
    async ({}, use) => {
      const app = await electron.launch({
        args: [
          PATH.join(__dirname, '../../app/main.js'),
          '--serve',
          '--no-sandbox',
        ],
      });
      await use(app);
      await app.close();
    },
    { scope: 'worker' },
  ],

  firstWindow: [
    async ({ app }, use) => {
      const firstWindow = await app.firstWindow();
      await firstWindow.waitForLoadState('domcontentloaded');
      await use(firstWindow);
    },
    { scope: 'worker' },
  ],
});

export { expect };
