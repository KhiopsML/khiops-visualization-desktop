import { ElectronApplication } from 'playwright';
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
