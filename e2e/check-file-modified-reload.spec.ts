/*
 * Copyright (c) 2023-2026 Orange. All rights reserved.
 * This software is distributed under the BSD 3-Clause-clear License, the text of which is available
 * at https://spdx.org/licenses/BSD-3-Clause-Clear.html or see the "LICENSE" file for more details.
 */

import { test, expect } from './fixtures/launch-electron';
import {
  clickMenuItem,
  mockOpenDialogAbsolute,
} from './helpers/electron-menu';
import * as fs from 'fs';
import * as PATH from 'path';

const FILE_MODIFIED_MESSAGE = 'This file was modified outside the application';

async function sendWindowFocusedEvent(app: Parameters<typeof clickMenuItem>[0]) {
  await app.evaluate(({ BrowserWindow }) => {
    const win =
      BrowserWindow.getFocusedWindow() ??
      BrowserWindow.getAllWindows().find((w) => w.isVisible()) ??
      BrowserWindow.getAllWindows()[0];

    if (win) {
      win.webContents.send('window-focused');
    }
  });
}

test.afterEach(async ({ firstWindow }, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    await firstWindow.screenshot({
      path: `test-results/${testInfo.title.replace(/[^a-z0-9]/gi, '_')}-manual.png`,
      fullPage: true,
    });
  }
});

test.describe('Check file modified reload prompt', () => {
  test('shows reload dialog on app focus when active tab file changed externally', async ({
    app,
    firstWindow,
  }) => {
    await firstWindow.waitForLoadState('networkidle');

    const sourceFile = PATH.join(__dirname, 'mocks', 'bi2.json');
    const tempDir = PATH.join(__dirname, 'test-results');
    const tempFile = PATH.join(tempDir, `focus-reload-${Date.now()}.json`);

    fs.mkdirSync(tempDir, { recursive: true });
    fs.copyFileSync(sourceFile, tempFile);

    await mockOpenDialogAbsolute(app, tempFile);
    await clickMenuItem(app, 'File', 'Open');

    await firstWindow.waitForSelector('khiops-visualization');
    const activeTab = firstWindow.locator('.tab.active');
    await expect(activeTab).toContainText('focus-reload-');

    // External modification while tab stays active.
    const originalContent = fs.readFileSync(tempFile, 'utf-8');
    const modifiedContent = `${originalContent}\n`;
    fs.writeFileSync(tempFile, modifiedContent, 'utf-8');

    // No tab switch here: trigger app focus event explicitly.
    await sendWindowFocusedEvent(app);

    const dialogMessage = firstWindow.getByText(FILE_MODIFIED_MESSAGE, {
      exact: false,
    });
    await dialogMessage.waitFor({ timeout: 15_000 });
    await expect(dialogMessage).toBeVisible();

    await firstWindow.getByRole('button', { name: 'No', exact: true }).click();

    await expect(dialogMessage).toHaveCount(0, { timeout: 5_000 });

    // No new external change: next focus must not reopen dialog.
    await sendWindowFocusedEvent(app);
    await firstWindow.waitForTimeout(1000);
    await expect(dialogMessage).toHaveCount(0);
  });
});
