/*
 * Copyright (c) 2023-2025 Orange. All rights reserved.
 * This software is distributed under the BSD 3-Clause-clear License, the text of which is available
 * at https://spdx.org/licenses/BSD-3-Clause-Clear.html or see the "LICENSE" file for more details.
 */
// @ts-nocheck
 
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
    // CI runners are slower than local machines for this multi-step import
    // flow (file dialog, AG Grid rendering, menu interactions); give it room.
    test.setTimeout(60_000);

    await firstWindow.waitForLoadState('domcontentloaded');

    await mockOpenDialog(app, 'adult2var.json');
    await clickMenuItem(app, 'File', 'Open');

    await firstWindow.waitForSelector('khiops-visualization', {
      timeout: 30_000,
    });

    const uploadBtn = firstWindow.locator('button', { hasText: 'file_upload' });
    await expect(uploadBtn).toBeVisible({ timeout: 15000 });
    await uploadBtn.click();

    const filePath = PATH.join(__dirname, 'mocks', 'ExternalDataEducation.txt');

    const importBtn = firstWindow.locator('button', {
      hasText: 'Import new file',
    });
    await expect(importBtn).toBeVisible({ timeout: 15000 });

    const fileChooserPromise = firstWindow.waitForEvent('filechooser', {
      timeout: 15000,
    });

    await importBtn.click();

    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(filePath);

    // Wait for the app to finish processing the imported file rather than a
    // fixed delay, which is unreliable on slower CI runners.
    await firstWindow.waitForLoadState('networkidle', { timeout: 15000 });

    // The imported dimension ("education") is populated asynchronously and
    // can take longer to appear on slower CI runners. Retry opening the
    // dimension menu until it shows up, closing it in between attempts.
    const importDimensionBtn = firstWindow
      .locator('#import-ext-datas-content .mat-mdc-menu-trigger')
      .nth(1);
    const menuContent = firstWindow.locator('.mat-mdc-menu-content');
    const educationItem = menuContent.locator('button', {
      hasText: 'education',
    });

    await expect(importDimensionBtn).toBeVisible({ timeout: 15000 });

    await expect(async () => {
      // Force click to bypass any overlay blocking
      await importDimensionBtn.click({ force: true });
      try {
        await expect(menuContent).toBeVisible({ timeout: 2000 });
        await expect(educationItem).toBeVisible({ timeout: 2000 });
      } catch (error) {
        await firstWindow.keyboard.press('Escape').catch(() => {});
        throw error;
      }
    }).toPass({ timeout: 30_000 });

    await educationItem.click();

    const loadBtn = firstWindow.locator('button', { hasText: 'Load datas' });
    await expect(loadBtn).toBeVisible({ timeout: 15000 });
    await loadBtn.click();

    const extDatas = firstWindow
      .locator('app-external-datas', {
        hasText: 'External data of Bachelors',
      })
      .first();
    await expect(extDatas).toBeVisible({ timeout: 30_000 });

    await expect(extDatas).toContainText('External data of Bachelors');
    await expect(extDatas).toContainText('This text is standard');
  });
});
