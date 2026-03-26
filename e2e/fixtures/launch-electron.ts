// e2e/fixtures/launch-electron.ts
import { test as base, expect } from '@playwright/test';
import { ElectronApplication, Page, _electron as electron } from 'playwright';
import * as PATH from 'path';

// Worker-scoped fixtures must be in a separate type
type ElectronWorkerFixtures = {
  app: ElectronApplication;
  firstWindow: Page;
};

export const test = base.extend<{}, ElectronWorkerFixtures>({
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

      // Wait for the window to be visible
      await app.evaluate(({ BrowserWindow }) => {
        return new Promise<void>((resolve) => {
          const win = BrowserWindow.getAllWindows()[0];
          if (win?.isVisible()) {
            resolve();
          } else {
            win?.once('show', () => resolve());
          }
        });
      });

      // Wait for Angular to bootstrap (app-root must be in the DOM)
      await firstWindow.waitForSelector('app-root', { timeout: 60000 });

      // Wait for Angular to finish rendering (no pending tasks)
      await firstWindow.waitForFunction(
        () => {
          const root = document.querySelector('app-root');
          // Angular sets this attribute when stable
          return root && root.children.length > 0;
        },
        { timeout: 60000 },
      );

      await firstWindow.waitForLoadState('networkidle', { timeout: 60000 });

      await use(firstWindow);
    },
    { scope: 'worker' },
  ],
});

export { expect };
