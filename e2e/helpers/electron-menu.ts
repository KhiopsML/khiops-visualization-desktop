import { ElectronApplication, Page } from 'playwright';
import * as PATH from 'path';

/**
 * Clicks a menu item in the Electron application menu
 * @param app - The Electron application instance
 * @param menuLabel - The top-level menu label (e.g. 'File')
 * @param submenuLabel - The submenu item label to click (e.g. 'Open')
 */
export async function clickMenuItem(
  app: ElectronApplication,
  menuLabel: string,
  submenuLabel: string,
): Promise<void> {
  await app.evaluate(
    ({ Menu }, { menuLabel, submenuLabel }) => {
      const menu = Menu.getApplicationMenu();
      if (!menu) return;
      const menuItem = menu.items.find((item) => item.label === menuLabel);
      if (menuItem?.submenu) {
        const submenuItem = menuItem.submenu.items.find(
          (s) => s.label === submenuLabel,
        );
        submenuItem?.click();
      }
    },
    { menuLabel, submenuLabel },
  );
}

/**
 * Mocks the Electron file open dialog to return a specific mock file
 * without showing the native dialog
 * @param app - The Electron application instance
 * @param mockFileName - The filename to load from e2e/mocks/ (e.g. 'big2.json')
 */
export async function mockOpenDialog(
  app: ElectronApplication,
  mockFileName: string,
): Promise<void> {
  const filePath = PATH.join(__dirname, '../mocks', mockFileName);

  await app.evaluate(({ dialog }, path) => {
    // Override showOpenDialog to return our test file without showing the native dialog
    dialog.showOpenDialog = () =>
      Promise.resolve({
        canceled: false,
        filePaths: [path],
      });
  }, filePath);
}

/**
 * Mocks the Electron file open dialog to return a file at an absolute path
 * @param app - The Electron application instance
 * @param absoluteFilePath - The absolute path of the file to use
 */
export async function mockOpenDialogAbsolute(
  app: ElectronApplication,
  absoluteFilePath: string,
): Promise<void> {
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = () =>
      Promise.resolve({
        canceled: false,
        filePaths: [path],
      });
  }, absoluteFilePath);
}

/**
 * Intercepts the app-quit IPC handler so Electron does not actually exit.
 * Must be called before triggering any quit flow in a test.
 * @param app - The Electron application instance
 */
export async function mockAppQuit(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('app-quit');
    ipcMain.handle('app-quit', () => Promise.resolve());
  });
}

/**
 * Simulates the user clicking the window close button (the X).
 * This triggers the Electron 'close' event which sends 'before-quit' to the renderer.
 * Targets the focused or first visible window to avoid hitting the hidden prewarmed window.
 * @param app - The Electron application instance
 */
export async function simulateWindowClose(
  app: ElectronApplication,
): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    const win =
      BrowserWindow.getFocusedWindow() ??
      BrowserWindow.getAllWindows().find((w) => w.isVisible()) ??
      BrowserWindow.getAllWindows()[0];
    win?.close();
  });
}

/**
 * Waits for the save-before-quit confirm dialog to appear in the renderer.
 * Playwright's getByText auto-pierces open Shadow DOM boundaries.
 * @param firstWindow - The renderer page
 * @param timeout - Maximum time to wait in ms (default 15 000)
 */
export async function waitForSaveDialog(
  firstWindow: Page,
  timeout = 15_000,
): Promise<void> {
  await firstWindow
    .getByText('Do you want to save the changes you made?')
    .waitFor({ timeout });
}

/**
 * Clicks a button in the save-before-quit confirm dialog.
 * Playwright's getByRole auto-pierces open Shadow DOM boundaries.
 * @param firstWindow - The renderer page
 * @param button - Which button to click: 'save' | 'no' | 'cancel'
 */
export async function clickSaveDialogButton(
  firstWindow: Page,
  button: 'save' | 'no' | 'cancel',
): Promise<void> {
  const labels: Record<string, string> = {
    save: 'Save',
    no: 'No',
    cancel: 'Cancel',
  };
  const btn = firstWindow.getByRole('button', {
    name: labels[button],
    exact: true,
  });
  await btn.waitFor({ timeout: 15_000 });
  await btn.click();
}
