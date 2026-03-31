import { test, expect } from './fixtures/launch-electron';
import { clickMenuItem, mockOpenDialog } from './helpers/electron-menu';
import * as PATH from 'path';

test.describe('Check loading saved external datas', () => {
  // Open file directly via IPC, bypassing the native file dialog
  test('Open file and check visualization', async ({ app, firstWindow }) => {
    // Wait for Angular to fully initialize
    await firstWindow.waitForLoadState('networkidle');
    await firstWindow.waitForTimeout(2000);

    await mockOpenDialog(app, 'check-ext-datas-e2e.json');
    await clickMenuItem(app, 'File', 'Open');

    await firstWindow.waitForTimeout(2000);

    // app-external-datas component should be visible
    const extDatas = firstWindow.locator('app-external-datas').last();
    await expect(extDatas).toBeVisible();

    // Text into app-external-datas must be valid
    await expect(extDatas).toContainText('External data of Bachelors');
    await expect(extDatas).toContainText('This text is standard');

    // app-external-datas component should be visible
    const extNoDatas = firstWindow.locator('app-external-datas').first();
    await expect(extNoDatas).toBeVisible();

    // Text into app-external-datas must be valid
    await expect(extNoDatas).toContainText('No external datas');
  });
});

test.describe('Check loading external datas', () => {
  // Open file directly via IPC, bypassing the native file dialog
  test('Open file and check visualization', async ({ app, firstWindow }) => {
    // Wait for Angular to fully initialize
    await firstWindow.waitForLoadState('networkidle');
    await firstWindow.waitForTimeout(4000);

    await mockOpenDialog(app, 'adult2var.json');
    await clickMenuItem(app, 'File', 'Open');

    // find into dom buton with text file_upload and click on it
    await firstWindow.locator('button', { hasText: 'file_upload' }).click();

    // Use Playwright's native file input method
    const filePath = PATH.join(__dirname, 'mocks', 'ExternalDataEducation.txt');

    const fileChooserPromise = firstWindow.waitForEvent('filechooser');
    await firstWindow.locator('button', { hasText: 'Import new file' }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(filePath);

    // Wait for the button to appear after file selection
    await firstWindow
      .locator('#import-ext-datas-dimension-btn')
      .waitFor({ state: 'visible', timeout: 10000 });

    // click on button with id import-ext-datas-dimension-btn
    await firstWindow.locator('#import-ext-datas-dimension-btn').click();

    // mat-mdc-menu-content should be visible
    const menuContent = firstWindow.locator('.mat-mdc-menu-content');
    await expect(menuContent).toBeVisible();

    // Click on menu item with text education
    await menuContent.locator('button', { hasText: 'education' }).click();

    // click on button with Load datas text
    await firstWindow.locator('button', { hasText: 'Load datas' }).click();

    // app-external-datas component should be visible
    const extDatas = firstWindow.locator('app-external-datas').first();
    await expect(extDatas).toBeVisible();

    // Text into app-external-datas must be valid
    await expect(extDatas).toContainText('External data of Bachelors');
    await expect(extDatas).toContainText('This text is standard');

    await firstWindow.waitForTimeout(5000);
  });

  // test.describe('Check copying external datas', () => {

  // });
});
