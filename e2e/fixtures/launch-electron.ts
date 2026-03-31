import { test as base, expect } from '@playwright/test';
import { ElectronApplication, Page, _electron as electron } from 'playwright';
import * as PATH from 'path';

type ElectronFixtures = {
  app: ElectronApplication;
  firstWindow: Page;
};

export const test = base.extend<ElectronFixtures>({
  app: async ({}, use) => {
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

  firstWindow: async ({ app }, use) => {
    const firstWindow = await app.firstWindow();

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

    await firstWindow.waitForSelector('app-root', { timeout: 60000 });

    await firstWindow.waitForFunction(
      () => {
        const root = document.querySelector('app-root');
        return root && root.children.length > 0;
      },
      { timeout: 60000 },
    );

    await firstWindow.waitForLoadState('networkidle', { timeout: 60000 });

    await use(firstWindow);
  },
});

export { expect };
