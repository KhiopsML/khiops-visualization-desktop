/*
 * Copyright (c) 2023-2025 Orange. All rights reserved.
 * This software is distributed under the BSD 3-Clause-clear License, the text of which is available
 * at https://spdx.org/licenses/BSD-3-Clause-Clear.html or see the "LICENSE" file for more details.
 */
// @ts-nocheck
 
import { test, expect } from './fixtures/launch-electron';
import { clickMenuItem, mockOpenDialog } from './helpers/electron-menu';

test.describe('Check multi tabs behaviors', () => {
  // Open file directly via IPC, bypassing the native file dialog
  test('Open file and check visualization', async ({ app, firstWindow }) => {
    // Wait for Angular to fully initialize
    await firstWindow.waitForLoadState('networkidle');
    await firstWindow.waitForTimeout(2000);

    await mockOpenDialog(app, 'bi2.json');

    // Now click the Open menu item — it will use the mocked dialog
    await clickMenuItem(app, 'File', 'Open');

    // Wait for the file to be loaded in the app
    await firstWindow.waitForSelector('khiops-visualization');
    let visualization = firstWindow.locator('khiops-visualization');
    await expect(visualization).toBeVisible();

    // .tab active must contains bi2.json
    const activeTab = firstWindow.locator('.tab.active');
    await expect(activeTab).toHaveText(/bi2\.json/);

    await firstWindow.waitForTimeout(2000);

    await mockOpenDialog(app, 'iris2d.json');
    await clickMenuItem(app, 'File', 'Open');

    // Wait for a second khiops-visualization to appear
    await expect(firstWindow.locator('khiops-visualization')).toHaveCount(2);

    // .tab active must contains iris2d.json
    const activeTab2 = firstWindow.locator('.tab.active');
    await expect(activeTab2).toHaveText(/iris2d\.json/);

    await firstWindow.waitForTimeout(5000);
  });
});
