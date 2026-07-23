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
    const getMainWindowTitle = async () => {
      return app.evaluate(({ BrowserWindow }) => {
        // A hidden prewarmed window can exist in the background.
        // Read title from the focused/visible window used by the test.
        const focusedWindow = BrowserWindow.getFocusedWindow();
        if (focusedWindow && !focusedWindow.isDestroyed()) {
          return focusedWindow.getTitle();
        }

        const visibleWindow = BrowserWindow.getAllWindows().find(
          (window) => !window.isDestroyed() && window.isVisible(),
        );

        return visibleWindow?.getTitle() ?? '';
      });
    };

    await firstWindow.waitForLoadState('networkidle');

    // Open first file
    await mockOpenDialog(app, 'bi2.json');
    await clickMenuItem(app, 'File', 'Open');
    await firstWindow.waitForSelector('khiops-visualization');
    await expect(firstWindow.locator('.tab.active')).toHaveText(/bi2\.json/);

    // Window title should contain bi2.json
    await expect
      .poll(getMainWindowTitle, { timeout: 10000 })
      .toContain('bi2.json');

    // Open second file
    await mockOpenDialog(app, 'iris2d.json');
    await clickMenuItem(app, 'File', 'Open');
    await expect(firstWindow.locator('khiops-visualization')).toHaveCount(2);
    await expect(firstWindow.locator('.tab.active')).toHaveText(/iris2d\.json/);

    // Window title should now contain iris2d.json (active tab)
    await expect
      .poll(getMainWindowTitle, { timeout: 10000 })
      .toContain('iris2d.json');

    // Click on the first tab (bi2.json)
    const firstTab = firstWindow
      .locator('.tab', { hasText: /bi2\.json/ })
      .first();
    await firstTab.click();
    await expect(firstWindow.locator('.tab.active')).toHaveText(/bi2\.json/);

    // Window title should revert to bi2.json
    await expect
      .poll(getMainWindowTitle, { timeout: 10000 })
      .toContain('bi2.json');
    await expect
      .poll(getMainWindowTitle, { timeout: 10000 })
      .not.toContain('iris2d.json');
  });
});
