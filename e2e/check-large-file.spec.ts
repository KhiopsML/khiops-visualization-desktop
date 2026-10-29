/*
 * Copyright (c) 2023-2026 Orange. All rights reserved.
 * This software is distributed under the BSD 3-Clause-clear License, the text of which is available
 * at https://spdx.org/licenses/BSD-3-Clause-Clear.html or see the "LICENSE" file for more details.
 */
// @ts-nocheck

import { test, expect } from './fixtures/launch-electron';
import * as fs from 'fs';
import * as PATH from 'path';

test.afterEach(async ({ firstWindow }, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    try {
      await firstWindow.screenshot({
        path: `test-results/${testInfo.title.replace(/[^a-z0-9]/gi, '_')}-manual.png`,
        fullPage: true,
      });
    } catch {
      // The window may already be closed after a failed test.
    }
  }
});

test.describe('Large file handling', () => {
  test('opens an 800 MB file without crashing and shows the preparation view', async ({
    firstWindow,
  }) => {
    const testFilePath = PATH.resolve(__dirname, 'mocks', 'bi2.json');
    const fixtureContent = fs.readFileSync(testFilePath, 'utf-8');

    await firstWindow.addInitScript(
      ({ filePath, content }) => {
        const nativeRequire = window.require.bind(window);
        const nativeFs = nativeRequire('fs');
        const largeFileSize = 800 * 1024 * 1024;
        const fixtureHead = content.substring(0, 4096);
        const fakeFs = Object.create(nativeFs);

        fakeFs.statSync = (requestedPath) =>
          requestedPath === filePath
            ? { size: largeFileSize }
            : nativeFs.statSync(requestedPath);
        fakeFs.openSync = (requestedPath, flags) =>
          requestedPath === filePath
            ? 42
            : nativeFs.openSync(requestedPath, flags);
        fakeFs.readSync = (
          descriptor,
          buffer,
          offset,
          length,
          position,
        ) => {
          if (descriptor !== 42) {
            return nativeFs.readSync(
              descriptor,
              buffer,
              offset,
              length,
              position,
            );
          }

          const encoded = new TextEncoder().encode(fixtureHead);
          const bytesToCopy = Math.min(length, encoded.length);
          for (let index = 0; index < bytesToCopy; index++) {
            buffer[offset + index] = encoded[index];
          }
          return bytesToCopy;
        };
        fakeFs.closeSync = (descriptor) => {
          if (descriptor !== 42) {
            nativeFs.closeSync(descriptor);
          }
        };
        fakeFs.stat = (requestedPath, callback) => {
          if (requestedPath === filePath) {
            callback(null, { size: largeFileSize });
            return;
          }
          nativeFs.stat(requestedPath, callback);
        };
        fakeFs.readFile = (requestedPath, encoding, callback) => {
          if (requestedPath === filePath) {
            callback(null, content);
            return;
          }
          nativeFs.readFile(requestedPath, encoding, callback);
        };

        const storageData = {
          OPEN_FILE: { files: [filePath] },
        };
        const fakeStorage = {
          getSync: () => storageData,
          set: (_key, data, callback) => {
            Object.assign(storageData, data);
            callback?.();
          },
          setDataPath: () => {},
        };

        window.require = (moduleName) => {
          if (moduleName === 'fs') {
            return fakeFs;
          }
          if (moduleName === 'electron-json-storage') {
            return fakeStorage;
          }
          return nativeRequire(moduleName);
        };
      },
      { filePath: testFilePath, content: fixtureContent },
    );

    await firstWindow.reload();
    await firstWindow.waitForLoadState('networkidle');

    await firstWindow.waitForSelector('app-recently-opened-files');
    const recentFiles = firstWindow.locator('app-recently-opened-files');
    await expect(recentFiles).toContainText('bi2.json');
    await expect(recentFiles.locator('.file-size').first()).toHaveText('800 MB');

    await recentFiles.locator('.file-button').first().click();

    await firstWindow.waitForSelector('khiops-visualization', {
      timeout: 20_000,
    });
    const visualization = firstWindow.locator('khiops-visualization');
    await visualization.waitFor({ timeout: 20_000 });
    const preparationView = visualization.locator('#preparation-view-comp');
    await expect(preparationView).toBeVisible({ timeout: 20_000 });
  });
});
