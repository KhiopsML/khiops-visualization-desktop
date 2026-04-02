import { test, expect } from './fixtures/launch-electron';
import { clickMenuItem, mockOpenDialog } from './helpers/electron-menu';
import * as PATH from 'path';

test.afterEach(async ({ firstWindow }, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    await firstWindow.screenshot({
      path: `test-results/${testInfo.title}-manual.png`,
      fullPage: true,
    });
  }
});

test.describe('Check loading saved external datas', () => {
  test('Open file and check visualization', async ({ app, firstWindow }) => {
    await firstWindow.waitForLoadState('domcontentloaded');

    await expect(firstWindow.locator('body')).toBeVisible();

    await mockOpenDialog(app, 'check-ext-datas-e2e.json');
    await clickMenuItem(app, 'File', 'Open');

    const extDatas = firstWindow.locator('app-external-datas').last();
    await expect(extDatas).toBeVisible({ timeout: 10000 });

    await expect(extDatas).toContainText('External data of Bachelors');
    await expect(extDatas).toContainText('This text is standard');

    const extNoDatas = firstWindow.locator('app-external-datas').first();
    await expect(extNoDatas).toBeVisible();

    await expect(extNoDatas).toContainText('No external datas');
  });
});

test.describe('Check loading external datas', () => {
  test('Open file and check visualization', async ({ app, firstWindow }) => {
    await firstWindow.waitForLoadState('domcontentloaded');

    await mockOpenDialog(app, 'adult2var.json');
    await clickMenuItem(app, 'File', 'Open');

    const uploadBtn = firstWindow.locator('button', { hasText: 'file_upload' });
    await expect(uploadBtn).toBeVisible({ timeout: 10000 });
    await uploadBtn.click();

    const filePath = PATH.join(__dirname, 'mocks', 'ExternalDataEducation.txt');

    const importBtn = firstWindow.locator('button', {
      hasText: 'Import new file',
    });
    await expect(importBtn).toBeVisible({ timeout: 10000 });

    const fileChooserPromise = firstWindow.waitForEvent('filechooser', {
      timeout: 10000,
    });

    await importBtn.click();

    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(filePath);

    // Wait longer for file processing and dialog to close
    await firstWindow.waitForTimeout(2000);

    const importDimensionBtn = firstWindow
      .locator('button:has(mat-icon:text("keyboard_arrow_down"))')
      .nth(1);
    await expect(importDimensionBtn).toBeVisible({ timeout: 10000 });

    // Force click to bypass any overlay blocking
    await importDimensionBtn.click({ force: true });

    const menuContent = firstWindow.locator('.mat-mdc-menu-content');
    await expect(menuContent).toBeVisible({ timeout: 10000 });

    const educationItem = menuContent.locator('button', {
      hasText: 'education',
    });
    await expect(educationItem).toBeVisible();
    await educationItem.click();

    const loadBtn = firstWindow.locator('button', { hasText: 'Load datas' });
    await expect(loadBtn).toBeVisible();
    await loadBtn.click();

    const extDatas = firstWindow.locator('app-external-datas').first();
    await expect(extDatas).toBeVisible({ timeout: 10000 });

    await expect(extDatas).toContainText('External data of Bachelors');
    await expect(extDatas).toContainText('This text is standard');
  });
});
