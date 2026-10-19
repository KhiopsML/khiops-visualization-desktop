/*
 * Copyright (c) 2023-2026 Orange. All rights reserved.
 * This software is distributed under the BSD 3-Clause-clear License, the text of which is available
 * at https://spdx.org/licenses/BSD-3-Clause-Clear.html or see the "LICENSE" file for more details.
 */
// @ts-nocheck

import { test, expect } from './fixtures/launch-electron';
import { clickMenuItem, mockOpenDialog } from './helpers/electron-menu';

test.afterEach(async ({ firstWindow }, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    try {
      await firstWindow.screenshot({
        path: `test-results/${testInfo.title}-manual.png`,
        fullPage: true,
      });
    } catch {
      // Ignore screenshot capture when page is already closed.
    }
  }
});

async function normalizeMainWindow(app: any) {
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) {
      return;
    }
    win.setSize(1440, 900);
    win.center();
  });
}

async function installCopyImageCapture(app: any) {
  await app.evaluate(({ ipcMain }) => {
    globalThis.__copyImagePayloads = [];
    ipcMain.removeHandler('clipboard-write-image');
    ipcMain.handle('clipboard-write-image', (_event: any, dataUrl: string) => {
      globalThis.__copyImagePayloads.push(dataUrl);
      return Promise.resolve();
    });
  });
}

async function readCopyImageCapture(app: any) {
  return await app.evaluate(() => {
    const payloads = globalThis.__copyImagePayloads || [];
    const firstPayload = payloads[0] || '';
    return {
      count: payloads.length,
      firstPrefix: firstPayload.slice(0, 22),
      firstLength: firstPayload.length,
    };
  });
}

async function selectAnyVisibleSelectableArea(firstWindow: any) {
  const selectable = firstWindow.locator('.kl-selectable').first();
  await expect(selectable).toBeVisible({ timeout: 15000 });
  await selectable.click();
}

test.describe('Check copy image flow', () => {
  test.beforeEach(async ({ app, firstWindow }) => {
    await normalizeMainWindow(app);
    await firstWindow.waitForLoadState('networkidle');

    await mockOpenDialog(app, 'bi2.json');
    await clickMenuItem(app, 'File', 'Open');

    await firstWindow.waitForSelector('khiops-visualization', {
      timeout: 20000,
    });
    await expect(firstWindow.locator('.tab.active')).toHaveText(/bi2\.json/);
    await selectAnyVisibleSelectableArea(firstWindow);
  });

  test('Copy image button sends PNG payload to clipboard handler', async ({
    app,
    firstWindow,
  }) => {
    await installCopyImageCapture(app);

    const copyImageButton = firstWindow
      .locator('#header-tools-copy-image-button')
      .first();
    await expect(copyImageButton).toBeVisible({ timeout: 10000 });
    await copyImageButton.click();

    await expect
      .poll(
        async () => {
          const payload = await readCopyImageCapture(app);
          return payload.count;
        },
        { timeout: 15000 },
      )
      .toBe(1);

    await expect(
      firstWindow.getByText('Screenshot copied to clipboard'),
    ).toBeVisible({ timeout: 15000 });

    const payload = await readCopyImageCapture(app);
    expect(payload.firstPrefix).toBe('data:image/png;base64,');
    expect(payload.firstLength).toBeGreaterThan(2000);
  });

  test('Copy image keyboard shortcut sends PNG payload', async ({
    app,
    firstWindow,
  }) => {
    await installCopyImageCapture(app);

    await firstWindow.locator('body').click();
    await firstWindow.keyboard.press('Control+Shift+C');

    await expect
      .poll(
        async () => {
          const payload = await readCopyImageCapture(app);
          return payload.count;
        },
        { timeout: 15000 },
      )
      .toBe(1);

    await expect(
      firstWindow.getByText('Screenshot copied to clipboard'),
    ).toBeVisible({ timeout: 15000 });

    const payload = await readCopyImageCapture(app);
    expect(payload.firstPrefix).toBe('data:image/png;base64,');
    expect(payload.firstLength).toBeGreaterThan(2000);
  });
});
