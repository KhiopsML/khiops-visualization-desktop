/*
 * Copyright (c) 2023-2025 Orange. All rights reserved.
 * This software is distributed under the BSD 3-Clause-clear License, the text of which is available
 * at https://spdx.org/licenses/BSD-3-Clause-Clear.html or see the "LICENSE" file for more details.
 */
// @ts-nocheck

import { test, expect } from './fixtures/launch-electron';
import { clickMenuItem, mockOpenDialog } from './helpers/electron-menu';

test.describe('Check OS window title updates with active tab', () => {
  test('Window title reflects the active tab file', async ({
    app,
    firstWindow,
  }) => {
    await firstWindow.waitForLoadState('networkidle');
    await firstWindow.waitForTimeout(2000);

    // Open first file
    await mockOpenDialog(app, 'bi2.json');
    await clickMenuItem(app, 'File', 'Open');
    await firstWindow.waitForSelector('khiops-visualization');
    await firstWindow.waitForTimeout(2000);

    // Window title should contain bi2.json
    const titleAfterFirstFile = await app.evaluate(({ BrowserWindow }) => {
      return BrowserWindow.getAllWindows()[0]?.getTitle();
    });
    expect(titleAfterFirstFile).toContain('bi2.json');

    // Open second file
    await mockOpenDialog(app, 'iris2d.json');
    await clickMenuItem(app, 'File', 'Open');
    await expect(firstWindow.locator('khiops-visualization')).toHaveCount(2);
    await firstWindow.waitForTimeout(2000);

    // Window title should now contain iris2d.json (active tab)
    const titleAfterSecondFile = await app.evaluate(({ BrowserWindow }) => {
      return BrowserWindow.getAllWindows()[0]?.getTitle();
    });
    expect(titleAfterSecondFile).toContain('iris2d.json');

    // Click on the first tab (bi2.json)
    const firstTab = firstWindow.locator('.tab').first();
    await expect(firstTab).toHaveText(/bi2\.json/);
    await firstTab.click();
    await firstWindow.waitForTimeout(1000);

    // Window title should revert to bi2.json
    const titleAfterTabSwitch = await app.evaluate(({ BrowserWindow }) => {
      return BrowserWindow.getAllWindows()[0]?.getTitle();
    });
    expect(titleAfterTabSwitch).toContain('bi2.json');
    expect(titleAfterTabSwitch).not.toContain('iris2d.json');
  });
});
