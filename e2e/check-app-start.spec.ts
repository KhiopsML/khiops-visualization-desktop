import {
  BrowserContext,
  ElectronApplication,
  Page,
  _electron as electron,
} from 'playwright';
import { test, expect } from '@playwright/test';
import * as PATH from 'path';

test.describe('Check Home Page', () => {
  let app: ElectronApplication;
  let firstWindow: Page;
  let context: BrowserContext;

  test.beforeAll(async () => {
    app = await electron.launch({
      args: [PATH.join(__dirname, '../app/main.js'), '--serve', '--no-sandbox'],
    });
    context = app.context();
    await context.tracing.start({ screenshots: true, snapshots: true });
    firstWindow = await app.firstWindow();
    await firstWindow.waitForLoadState('domcontentloaded');
  });

  test('Launch electron app', async () => {
    const windowState: {
      isVisible: boolean;
      isDevToolsOpened: boolean;
      isCrashed: boolean;
    } = await app.evaluate(async (process) => {
      const mainWindow = process.BrowserWindow.getAllWindows()[0];

      const getState = () => ({
        isVisible: mainWindow.isVisible(),
        isDevToolsOpened: mainWindow.webContents.isDevToolsOpened(),
        isCrashed: mainWindow.webContents.isCrashed(),
      });

      return new Promise((resolve) => {
        if (mainWindow.isVisible()) {
          resolve(getState());
        } else {
          mainWindow.once('ready-to-show', () =>
            setTimeout(() => resolve(getState()), 0),
          );
        }
      });
    });

    expect(windowState.isVisible).toBeTruthy();
    expect(windowState.isDevToolsOpened).toBeFalsy();
    expect(windowState.isCrashed).toBeFalsy();
  });

  test('.start-panel-container div must display Open a file', async () => {
    // The text is inside a button > span inside .start-panel-container, not a direct div
    const appWelcome = firstWindow.locator('app-welcome');
    await expect(appWelcome).toContainText(/open a file from the menu/i, {
      timeout: 10000,
    });
  });

  test('Recent file component should be displayed', async () => {
    const recentFiles = firstWindow.locator('app-recently-opened-files');
    await expect(recentFiles).toBeVisible();
  });

  test('File menu contains Open', async () => {
    // Wait for Angular to fully initialize and set the application menu
    await firstWindow.waitForLoadState('networkidle');
    await firstWindow.waitForTimeout(2000);

    // Use the already-running app instance (menu is set by Angular renderer)
    const menuItems = await app.evaluate(async ({ Menu }) => {
      const menu = Menu.getApplicationMenu();
      if (!menu) return [];

      return menu.items.map((item) => ({
        label: item.label,
        submenu: item.submenu?.items.map((s) => s.label) ?? [],
      }));
    });

    console.log('Menu structure:', JSON.stringify(menuItems, null, 2));

    const flatLabels = menuItems.flatMap((i) => [i.label, ...i.submenu]);
    expect(flatLabels).toContain('Open');
  });

  test.afterAll(async () => {
    await context.tracing.stop({ path: 'e2e/tracing/trace.zip' });
    // await app.close();
  });
});
