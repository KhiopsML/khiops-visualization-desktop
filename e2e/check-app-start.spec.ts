import { BrowserContext } from 'playwright';
import { test, expect } from './fixtures/launch-electron';

test.describe('Check Home Page', () => {
  let context: BrowserContext;

  test.beforeAll(async ({ app }) => {
    // Tracing setup using the shared app instance from fixture
    context = app.context();
    await context.tracing.start({ screenshots: true, snapshots: true });
  });

  test('Launch electron app', async ({ app, firstWindow }) => {
    // firstWindow is already loaded via fixture, just check window state
    const windowState = await app.evaluate(({ BrowserWindow }) => {
      const mainWindow = BrowserWindow.getAllWindows()[0];
      return {
        isVisible: mainWindow.isVisible(),
        isDevToolsOpened: mainWindow.webContents.isDevToolsOpened(),
        isCrashed: mainWindow.webContents.isCrashed(),
      };
    });

    expect(windowState.isVisible).toBeTruthy();
    expect(windowState.isDevToolsOpened).toBeFalsy();
    expect(windowState.isCrashed).toBeFalsy();
  });

  test('.start-panel-container div must display Open a file', async ({
    firstWindow,
  }) => {
    // The text is inside a button > span inside .start-panel-container, not a direct div
    const appWelcome = firstWindow.locator('app-welcome');
    await expect(appWelcome).toContainText(/open a file from the menu/i, {
      timeout: 10000,
    });
  });

  test('Recent file component should be displayed', async ({ firstWindow }) => {
    const recentFiles = firstWindow.locator('app-recently-opened-files');
    await expect(recentFiles).toBeVisible();
  });

  test('File menu contains Open', async ({ app, firstWindow }) => {
    // Wait for Angular to fully initialize and set the application menu
    await firstWindow.waitForLoadState('networkidle');
    await firstWindow.waitForTimeout(2000);

    // Use the already-running app instance (menu is set by Angular renderer)
    const menuItems = await app.evaluate(async ({ Menu }) => {
      const menu = Menu.getApplicationMenu();
      if (!menu) return [];

      return menu.items.map((item) => ({
        label: item.label,
        submenu: (item.submenu?.items ?? [])
          .map((s) => s.label)
          .filter((label) => label && label.trim() !== ''),
      }));
    });

    // check that menuItem contains Open into [{"label": "File", "submenu": ["Open", ...
    const fileMenu = menuItems.find((item) => item.label === 'File');
    expect(fileMenu).toBeDefined();
    expect(fileMenu?.submenu).toContain('Open');
  });

  test.afterAll(async () => {
    if (context) {
      try {
        await context.tracing.stop({ path: 'e2e/tracing/trace.zip' });
      } catch (error) {
        // Context may already be closed
        console.log('Tracing could not be stopped:', error);
      }
    }
  });
});
