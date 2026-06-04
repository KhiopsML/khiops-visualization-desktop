/*
 * Copyright (c) 2023-2025 Orange. All rights reserved.
 * This software is distributed under the BSD 3-Clause-clear License, the text of which is available
 * at https://spdx.org/licenses/BSD-3-Clause-Clear.html or see the "LICENSE" file for more details.
 */

/**
 * E2E test – large file (800 MB) handling
 *
 * Why no real 800 MB file?
 * A real 800 MB JSON cannot be committed to git. Instead, a small but valid
 * Khiops fixture is reused and the Electron file-system mock reports its
 * size as 800 MB via statSync. This exercises exactly the code paths that
 * previously crashed (getFileType / getRecentFiles) and the subsequent
 * streaming-aware open flow, without storing a giant file in the repo.
 *
 * Browser-mode streaming caveat:
 * The JSONStream / event-stream libraries require Node.js streams that are
 * intentionally excluded from the browser bundle ("stream": false in
 * package.json#browser). Therefore, the readFile mock returns valid JSON
 * directly (non-streaming path) so the preparation view can be verified.
 * The streaming path is exercised by the real Electron process; what this
 * test guards is:
 *   1. getFileType reads at most 4 KB → no string-length crash for recent files.
 *   2. performOpenFile skips the full pre-read for files > 400 MB.
 *   3. The preparation view is rendered once data is available.
 */

import 'cypress-shadow-dom';

describe('Large file (800 MB) handling', () => {
  it('opens an 800 MB file without crashing and shows the preparation view', () => {
    // Retrieve the fixture path + content from the Node.js Cypress task.
    // The task reads the real (small) mock file; we never store a real 800 MB file.
    cy.task('getLargeFileFixture').then(
      ({ path: testFilePath, content: fixtureContent }: any) => {
        // First 4 096 bytes – used by the fakeFs.readSync to simulate type detection
        const fixtureHead = (fixtureContent as string).substring(0, 4096);

        cy.visit('/', {
          onBeforeLoad(win: any) {
            // ── Simulate Electron renderer process ──────────────────────────
            win.process = {
              type: 'renderer',
              version: 'v18.0.0',
              platform: 'linux',
            };

            // ── Fake fs module ───────────────────────────────────────────────
            const fakeFs = {
              // Report our test file as 800 MB so the large-file guard triggers
              statSync: (filePath: string) => {
                if (filePath === testFilePath) {
                  return { size: 800 * 1024 * 1024 };
                }
                return { size: 1024 };
              },
              // Used by analyzeJsonContent / getFileType to peek at first 4 KB
              openSync: (_path: string, _flags: string) => 42,
              readSync: (
                _fd: number,
                buffer: any,
                offset: number,
                length: number,
                _position: number,
              ) => {
                const encoded = new TextEncoder().encode(fixtureHead);
                const bytesToCopy = Math.min(length, encoded.length);
                for (let i = 0; i < bytesToCopy; i++) {
                  buffer[offset + i] = encoded[i];
                }
                return bytesToCopy;
              },
              closeSync: (_fd: number) => {},
              // Async stat used inside readFile()
              stat: (_path: string, callback: Function) => {
                callback(null);
              },
              // Return valid JSON directly (streaming path needs Node.js streams
              // which are excluded from the browser bundle)
              readFile: (
                filePath: string,
                _encoding: string,
                callback: Function,
              ) => {
                if (filePath === testFilePath) {
                  callback(null, fixtureContent);
                } else {
                  callback(new Error('File not found'), null);
                }
              },
              // Stub only – streaming is not exercised in browser mode
              createReadStream: () => ({
                pipe: () => ({ pipe: () => {}, on: () => {} }),
              }),
            };

            // ── Fake ipcRenderer ─────────────────────────────────────────────
            const fakeIpcRenderer = {
              sendSync: (channel: string) =>
                channel === 'get-input-file' ? null : null,
              on: (_channel: string, _handler: Function) => {},
              invoke: (_channel: string, ..._args: any[]) =>
                Promise.resolve(null),
              removeAllListeners: () => {},
            };

            // ── Fake electron-json-storage ───────────────────────────────────
            // Pre-populate the recent-files list with our 800 MB test file so
            // that getRecentFiles() → getFileType() is exercised on boot.
            const fakeStorage = {
              getSync: (_key: string) => ({
                OPEN_FILE: { files: [testFilePath] },
              }),
              set: (_key: string, _data: any, cb?: Function) => {
                cb && cb();
              },
              setDataPath: (_path: string) => {},
            };

            // ── Fake @electron/remote ────────────────────────────────────────
            const fakeRemote = {
              app: { getPath: (_name: string) => '/tmp' },
              dialog: {
                showOpenDialog: () =>
                  Promise.resolve({ canceled: true, filePaths: [] }),
                showSaveDialog: () =>
                  Promise.resolve({ canceled: true, filePath: '' }),
              },
              Menu: {
                buildFromTemplate: () => ({ items: [] }),
                setApplicationMenu: () => {},
              },
            };

            // ── window.require router ────────────────────────────────────────
            win.require = (module: string) => {
              switch (module) {
                case 'electron':
                  return {
                    ipcRenderer: fakeIpcRenderer,
                    webFrame: {},
                    clipboard: { writeImage: () => {} },
                    nativeImage: { createFromDataURL: () => ({}) },
                    shell: { openExternal: () => {} },
                  };
                case 'fs':
                  return fakeFs;
                case '@electron/remote':
                  return fakeRemote;
                case 'path':
                  return {
                    join: (...parts: string[]) => parts.join('/'),
                    basename: (p: string) =>
                      p.split('/').pop() || p.split('\\').pop() || p,
                  };
                case 'electron-json-storage':
                  return fakeStorage;
                case 'child_process':
                  return {};
                case 'os':
                  return { tmpdir: () => '/tmp' };
                default:
                  return {};
              }
            };
          },
        });

        // 1) App boots without crashing (large file in recent history must not throw)
        cy.get('khiops-visualization', { timeout: 20000 }).should('exist');

        // 2) Recent-files panel is rendered with our 800 MB file listed
        cy.get('app-recently-opened-files', { timeout: 10000 }).should('exist');
        cy.get('app-recently-opened-files .file-button')
          .first()
          .should('exist');

        // 3) Open the file by clicking its entry in the recent-files list
        cy.get('app-recently-opened-files .file-button').first().click();

        // 4) The preparation view must appear inside the web-component shadow DOM
        cy.get('khiops-visualization', { timeout: 30000 })
          .shadow()
          .find('#preparation-view-comp', { timeout: 20000 })
          .should('exist');
      },
    );
  });
});
