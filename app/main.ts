import { app, BrowserWindow, clipboard, screen } from 'electron';
import * as electron from 'electron';
import * as remoteMain from '@electron/remote/main';
remoteMain.initialize();
import * as path from 'path';
import * as fs from 'fs';
// Lazy-loaded on first use to avoid blocking startup
let _machineIdSync: typeof import('node-machine-id').machineIdSync | null = null;
function getMachineId(): string {
  if (!_machineIdSync) {
    _machineIdSync = require('node-machine-id').machineIdSync;
  }
  try {
    return _machineIdSync!();
  } catch {
    return '';
  }
}

// Lazy-loaded: electron-updater is heavy and not needed until after the window is visible
let _autoUpdater: any = null;
function getAutoUpdater() {
  if (!_autoUpdater) {
    _autoUpdater = require('electron-updater').autoUpdater;
    _autoUpdater.autoInstallOnAppQuit = false;
    _autoUpdater.autoDownload = false;
    _autoUpdater.allowDowngrade = false;
  }
  return _autoUpdater;
}
import * as url from 'url';

const log = require('electron-log');
let win: BrowserWindow | null = null;
const openWindows: BrowserWindow[] = []; // Track all open windows for multi-window support
let lastFocusedWindow: BrowserWindow | null = null; // Track the last focused window for correct file routing
let prewarmedWindow: BrowserWindow | null = null; // Hidden window kept ready for instant tab moves
let isQuitting = false;
// Windows that confirmed save dialogs and are allowed to close without interception
const windowsAllowedToClose = new Set<number>();
let isUpdateReadyToInstall = false;
let updateAutoInstallPending = false;
const args = process.argv.slice(1),
  serve = args.some((val) => val === '--serve');
const forceNewWindow = args.some((val) => val === '--new-window');
const { Menu } = require('electron');
const { ipcMain } = require('electron');
if (serve) require('electron-debug');
if (serve) require('source-map-support').install();

// --- Single-instance lock ---
// When the user double-clicks a file, redirect it to the existing instance
// as a new tab instead of spawning a second window.
// Passing --new-window in argv bypasses this and creates a fresh window.
if (!forceNewWindow) {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    // Another primary instance is already running – it will handle opening the file.
    app.quit();
  } else {
    app.on('second-instance', (_event, argv) => {
      // argv from the second instance: find the file path (last non-flag arg)
      const fileArg = argv.slice(1).find(
        (a) => !a.startsWith('-') && /\.(json|khj|khcj)$/i.test(a),
      );

      const targetWindow =
        lastFocusedWindow ?? openWindows[openWindows.length - 1] ?? win;

      if (targetWindow) {
        if (targetWindow.isMinimized()) targetWindow.restore();
        targetWindow.focus();
        if (fileArg) {
          targetWindow.webContents.send('file-open-system', fileArg);
        }
      }
    });
  }
}

process.env['ELECTRON_DISABLE_SECURITY_WARNINGS'] = 'true';

// log.transports.file.level = 'info';
// log.transports.file.file = __dirname + '/electron.log';
// const storage = require('electron-json-storage');
log.warn('App Desktop starting...');

// Try to fix ERR_HTTP2_PROTOCOL_ERROR
// https://github.com/electron-userland/electron-builder/issues/4987
// app.commandLine.appendSwitch('disable-http2');
// autoUpdater.requestHeaders = {
//   'Cache-Control':
//     'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
// };

ipcMain.handle('get-machine-id', async () => {
  return getMachineId();
});

// return input files on Mac and Linux
let fileToLoad: any;
app.on('will-finish-launching', function () {
  log.info('will-finish-launching');

  app.on('open-file', function (event, filepath) {
    fileToLoad = filepath;
    event.preventDefault();

    if (fileToLoad) {
      log.info('fileToLoad');

      if (win) {
        setTimeout(() => {
          win?.webContents?.send('file-open-system', fileToLoad);
        }, 2500);
      } else {
        // if win is not ready, wait for it
        app.once('browser-window-created', () => {
          setTimeout(() => {
            win?.webContents?.send('file-open-system', fileToLoad);
          }, 2500);
        });
      }
    }
  });
});

// Disable sandbox for all processes
// app.commandLine.appendSwitch('--no-sandbox');

function createWindow(): BrowserWindow {
  const size = screen.getPrimaryDisplay().workAreaSize;

  // Create the browser window.
  const newWindow = new electron.BrowserWindow({
    x: 0,
    y: 0,
    width: size.width,
    height: size.height,
    minWidth: 600,
    minHeight: 300,
    show: false, // Show the window after it is ready to prevent visual glitches
    webPreferences: {
      nodeIntegration: true,
      allowRunningInsecureContent: serve,
      contextIsolation: false, // false if you want to run e2e test with Spectron
    },
    titleBarStyle: 'default',
    darkTheme: false,
    backgroundColor: '#ffffff',
  });

  newWindow.once('ready-to-show', () => {
    newWindow?.show();
  });

  // Track focus so that second-instance events and menus target the correct window
  newWindow.on('focus', () => {
    lastFocusedWindow = newWindow;
    newWindow.webContents.send('window-focused');
  });

  // Enable remote for main process
  require('@electron/remote/main').enable(newWindow);
  // Enable remote for renderer process
  require('@electron/remote/main').enable(newWindow.webContents);

  // Intercept keyboard shortcuts before Electron's default handlers consume them.
  // document:keydown in the renderer never fires for Ctrl+W because Electron
  // processes it first at the native level.
  newWindow.webContents.on('before-input-event', (event, input) => {
    if (!input.control && !input.meta) return;
    if (input.type !== 'keyDown') return;

    if (input.shift && input.key === 'W') {
      // Ctrl+Shift+W → close all tabs
      event.preventDefault();
      newWindow.webContents.send('shortcut-close-all-tabs');
    } else if (input.shift && input.key === 'N') {
      // Ctrl+Shift+N → move active tab to new window
      event.preventDefault();
      newWindow.webContents.send('shortcut-move-tab-new-window');
    } else if (!input.shift && input.key === 'w') {
      // Ctrl+W → close active tab (prevent Electron from closing the window)
      event.preventDefault();
      newWindow.webContents.send('shortcut-close-tab');
    } else if (!input.shift && input.key === 'o') {
      // Ctrl+O → open file dialog for THIS window (bypasses the menu handler
      // which may be bound to a different renderer via @electron/remote)
      event.preventDefault();
      openFileDialogForWindow(newWindow);
    }
  });

  // Custom context menu
  newWindow.webContents.on('context-menu', (_event, params) => {
    // Check if there is selected text or if clipboard has content to enable/disable menu items
    const hasSelection =
      params.selectionText && params.selectionText.trim().length > 0;
    const hasClipboard = clipboard.readText().trim().length > 0;

    // process right-click event and send to renderer process
    newWindow?.webContents?.send('right-click', params);
    Menu.buildFromTemplate([
      { label: 'Copy', role: 'copy', enabled: hasSelection },
      { label: 'Paste', role: 'paste', enabled: hasClipboard },
      { type: 'separator' },
      {
        label: 'Copy image',
        click: () => {
          newWindow?.webContents?.send('copy-image', params);
        },
        accelerator: 'CommandOrControl+Shift+c',
      },
      {
        label: 'Copy datas',
        click: () => {
          newWindow?.webContents?.send('copy-datas', params);
        },
        accelerator: 'CommandOrControl+Shift+d',
      },
      { type: 'separator' },
      {
        label: 'Toggle dev tools',
        role: 'toggleDevTools',
        accelerator: 'CommandOrControl+Shift+I',
      },
    ]).popup();
  });

  // win.webContents.openDevTools();

  if (serve) {
    require('electron-reloader')(module);
    newWindow.loadURL('http://localhost:4200');

    const electronReload = require('electron-reload');
    electronReload(
      path.join(
        __dirname,
        '../visualization-component/dist/khiops-webcomponent/',
      ),
    );
    const setupReloading = require('../electron-reload.js');
    setupReloading(newWindow);
  } else {
    // Path when running electron executable
    let pathIndex = './index.html';

    if (fs.existsSync(path.join(__dirname, '../dist/index.html'))) {
      // Path when running electron in local folder
      pathIndex = '../dist/index.html';
    }

    const urlPath = url.format({
      pathname: path.join(__dirname, pathIndex),
      protocol: 'file:',
      slashes: true,
    });

    newWindow.loadURL(urlPath);
  }

  // Emitted when the window is closed.
  newWindow.on('closed', () => {
    // Remove window from tracking array
    const index = openWindows.indexOf(newWindow);
    if (index > -1) {
      openWindows.splice(index, 1);
    }
    // Dereference the window object
    if (newWindow === win) {
      win = null;
    }
    if (lastFocusedWindow === newWindow) {
      lastFocusedWindow = null;
    }
  });

  newWindow.on('close', (event) => {
    if (!isQuitting && !windowsAllowedToClose.has(newWindow.id)) {
      event.preventDefault();
      newWindow?.show(); // Show window if hidden or minimized
      newWindow?.focus(); // Focus the window to bring it to the front
      // If multiple windows are open, close only this window; otherwise quit the app
      if (openWindows.length > 1) {
        newWindow?.webContents?.send('before-close-window');
      } else {
        newWindow?.webContents?.send('before-quit');
      }
    }
    windowsAllowedToClose.delete(newWindow.id);
  });

  // Track the primary window
  if (!win) {
    win = newWindow;
  }

  // Add to windows array for multi-window support
  openWindows.push(newWindow);

  return newWindow;
}

/**
 * Create a hidden pre-warmed window that has already loaded the Angular app.
 * When a tab is moved to a new window we promote this window instead of
 * creating one from scratch, which eliminates the ~2-3 s bootstrap wait.
 */
function createPrewarmedWindow(): BrowserWindow {
  const size = screen.getPrimaryDisplay().workAreaSize;
  // Use ~80% of the work area, centered — same feel as VS Code's secondary windows
  const width = Math.round(size.width * 0.8);
  const height = Math.round(size.height * 0.8);
  const x = Math.round((size.width - width) / 2);
  const y = Math.round((size.height - height) / 2);
  const pw = new electron.BrowserWindow({
    x,
    y,
    width,
    height,
    minWidth: 600,
    minHeight: 300,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      allowRunningInsecureContent: serve,
      contextIsolation: false,
    },
    titleBarStyle: 'default',
    darkTheme: false,
    backgroundColor: '#ffffff',
  });

  require('@electron/remote/main').enable(pw);
  require('@electron/remote/main').enable(pw.webContents);

  if (serve) {
    pw.loadURL('http://localhost:4200');
  } else {
    let pathIndex = './index.html';
    if (fs.existsSync(path.join(__dirname, '../dist/index.html'))) {
      pathIndex = '../dist/index.html';
    }
    const urlPath = url.format({
      pathname: path.join(__dirname, pathIndex),
      protocol: 'file:',
      slashes: true,
    });
    pw.loadURL(urlPath);
  }

  // If the prewarmed window is closed before being promoted, clear the reference
  pw.on('closed', () => {
    if (prewarmedWindow === pw) {
      prewarmedWindow = null;
    }
  });

  return pw;
}

/**
 * Schedule creation of a pre-warmed window after the main window has loaded.
 */
function schedulePrewarm() {
  // Wait a few seconds so the main window start-up is not slowed down
  setTimeout(() => {
    if (!prewarmedWindow || prewarmedWindow.isDestroyed()) {
      prewarmedWindow = createPrewarmedWindow();
    }
  }, 5000);
}

/**
 * Promote a pre-warmed window to a fully interactive window.
 * Wires up all the event handlers that createWindow() normally sets up,
 * then makes the window visible.
 */
function promotePrewarmedWindow(): BrowserWindow {
  const pw = prewarmedWindow!;
  prewarmedWindow = null;

  // Wire up focus tracking
  pw.on('focus', () => {
    lastFocusedWindow = pw;
    pw.webContents.send('window-focused');
  });

  // Wire up keyboard shortcuts (same as createWindow)
  pw.webContents.on('before-input-event', (event, input) => {
    if (!input.control && !input.meta) return;
    if (input.type !== 'keyDown') return;

    if (input.shift && input.key === 'W') {
      event.preventDefault();
      pw.webContents.send('shortcut-close-all-tabs');
    } else if (input.shift && input.key === 'N') {
      event.preventDefault();
      pw.webContents.send('shortcut-move-tab-new-window');
    } else if (!input.shift && input.key === 'w') {
      event.preventDefault();
      pw.webContents.send('shortcut-close-tab');
    } else if (!input.shift && input.key === 'o') {
      event.preventDefault();
      openFileDialogForWindow(pw);
    }
  });

  // Wire up context menu (same as createWindow)
  pw.webContents.on('context-menu', (_event, params) => {
    const hasSelection =
      params.selectionText && params.selectionText.trim().length > 0;
    const hasClipboard = clipboard.readText().trim().length > 0;
    pw.webContents?.send('right-click', params);
    Menu.buildFromTemplate([
      { label: 'Copy', role: 'copy', enabled: hasSelection },
      { label: 'Paste', role: 'paste', enabled: hasClipboard },
      { type: 'separator' },
      {
        label: 'Copy image',
        click: () => { pw.webContents?.send('copy-image', params); },
        accelerator: 'CommandOrControl+Shift+c',
      },
      {
        label: 'Copy datas',
        click: () => { pw.webContents?.send('copy-datas', params); },
        accelerator: 'CommandOrControl+Shift+d',
      },
      { type: 'separator' },
      {
        label: 'Toggle dev tools',
        role: 'toggleDevTools',
        accelerator: 'CommandOrControl+Shift+I',
      },
    ]).popup();
  });

  // Wire up close / closed handlers (same as createWindow)
  pw.on('closed', () => {
    const index = openWindows.indexOf(pw);
    if (index > -1) openWindows.splice(index, 1);
    if (pw === win) win = null;
    if (lastFocusedWindow === pw) lastFocusedWindow = null;
  });

  pw.on('close', (event) => {
    if (!isQuitting && !windowsAllowedToClose.has(pw.id)) {
      event.preventDefault();
      pw.show();
      pw.focus();
      if (openWindows.length > 1) {
        pw.webContents?.send('before-close-window');
      } else {
        pw.webContents?.send('before-quit');
      }
    }
    windowsAllowedToClose.delete(pw.id);
  });

  if (!win) win = pw;
  openWindows.push(pw);

  return pw;
}

try {
  // This method will be called when Electron has finished
  // initialization and is ready to create browser windows.
  // Some APIs can only be used after this event occurs.
  app.on('ready', () => {
    const mainWin = createWindow();
    // Pre-warm a hidden window only after the main window finishes loading
    // mainWin.webContents.once('did-finish-load', () => {
      schedulePrewarm();
    // });
  });

  // Handle before-quit event to allow window closing
  app.on('before-quit', () => {
    isQuitting = true;
    // If update is ready and pending auto-install on quit, install it silently
    if (isUpdateReadyToInstall && updateAutoInstallPending) {
      log.info('Installing update silently on app quit');
      getAutoUpdater().quitAndInstall(true, true);
    }
  });

  // Quit when all windows are closed.
  app.on('window-all-closed', () => {
    // On OS X it is common for applications and their menu bar
    // to stay active until the user quits explicitly with Cmd + Q
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('activate', () => {
    // On OS X it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (win === null) {
      createWindow();
    }
  });
} catch (e) {
  // Catch Error
  // throw e;
}

ipcMain.on('get-input-file', async (event: any) => {
  try {
    log.info('get-input-file');
    // Find the first argument that looks like a data file (.json, .khj, .khcj).
    // argv layout varies depending on how the process was started:
    //   - normal:      electron.exe main.js [file]
    //   - --new-window: electron.exe main.js --new-window [file]
    //   - serve:       electron.exe main.js --serve ...
    // Skip flags (--*) and the main script to find the actual data file.
    const fileArg = process.argv.slice(1).find(
      (a) => !a.startsWith('-') && /\.(json|khj|khcj)$/i.test(a),
    );
    event.returnValue = fileArg || null;
  } catch (error) {
    console.log('error', error);
  }
});

ipcMain.handle('launch-update-available', async () => {
  try {
    log.info('launch-update-available');
    getAutoUpdater().downloadUpdate();
    return;
  } catch (error) {
    console.log('error', error);
  }
});

ipcMain.handle(
  'launch-check-for-update',
  async (_event: any, channel: string, delay: number = 10000) => {
    try {
      log.info('launch-check-for-update', channel);
      checkForUpdates(channel, delay);
    } catch (error) {
      console.log('error', error);
    }
  },
);

function checkForUpdates(channel: string, delay: number = 10000) {
  setupAutoUpdaterEvents();
  getAutoUpdater().allowPrerelease = channel === 'beta';
  log.info('checkForUpdates');
  setTimeout(() => {
    getAutoUpdater().checkForUpdates().catch((err: Error) => {
      // Silently ignore network errors during update check
      log.warn('checkForUpdates failed (non-blocking):', err.message);
      win?.webContents?.send('update-error', err);
    });
  }, delay);
}

ipcMain.handle('set-title-bar-name', async (event: any, arg: any) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  senderWindow?.setTitle(arg?.title);
});

/**
 * Covisualization use case: read local file content
 */
ipcMain.handle('read-local-file', async (_event: any, filePath: any) => {
  try {
    const data = fs.readFileSync(filePath, 'utf8');
    // console.log('local file loaded:', data);
    return data;
  } catch (err) {
    console.error('Error when loading file:', err);
    return null;
  }
});

/**
 * Show the native open-file dialog for the given window and, if the user picks
 * a file, send it to that window's renderer for loading.
 */
async function openFileDialogForWindow(targetWindow: BrowserWindow) {
  const result = await electron.dialog.showOpenDialog(targetWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Khiops Files', extensions: ['json', 'khj', 'khcj'] }],
  });

  if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
    return { success: false, reason: 'canceled' };
  }

  targetWindow.webContents.send('file-open-system', result.filePaths[0]);
  return { success: true };
}

/**
 * Handle "Open file" action from the application menu.
 *
 * The menu click handler runs in whichever renderer last called
 * setApplicationMenu (via @electron/remote).  That renderer may NOT be the
 * window the user is looking at.  To work around this we accept an explicit
 * windowId (the `browserWindow.id` that Electron passes to the click callback)
 * and fall back to getFocusedWindow / lastFocusedWindow only when the id is
 * missing.
 */
ipcMain.handle('menu-action-open-file', async (_event: any, windowId?: number) => {
  log.info('menu-action-open-file requested, windowId:', windowId);

  let targetWindow: BrowserWindow | null = null;
  if (windowId != null) {
    targetWindow = BrowserWindow.fromId(windowId);
  }
  if (!targetWindow) {
    targetWindow =
      BrowserWindow.getFocusedWindow() ??
      lastFocusedWindow ??
      openWindows[openWindows.length - 1] ??
      win;
  }
  if (!targetWindow) return { success: false, reason: 'no-window' };

  return openFileDialogForWindow(targetWindow);
});

/**
 * Handle "Open recent file" action from the history list in the application menu.
 * Same routing problem as menu-action-open-file: the click closure captures the
 * renderer that last called setApplicationMenu, not necessarily the focused one.
 * We accept the windowId from the click callback to always target the right window.
 */
ipcMain.handle('menu-action-open-recent-file', async (_event: any, filePath: string, windowId?: number) => {
  log.info('menu-action-open-recent-file requested, windowId:', windowId, 'file:', filePath);

  let targetWindow: BrowserWindow | null = null;
  if (windowId != null) {
    targetWindow = BrowserWindow.fromId(windowId);
  }
  if (!targetWindow) {
    targetWindow =
      BrowserWindow.getFocusedWindow() ??
      lastFocusedWindow ??
      openWindows[openWindows.length - 1] ??
      win;
  }
  if (!targetWindow) return { success: false, reason: 'no-window' };

  targetWindow.webContents.send('file-open-system', filePath);
  return { success: true };
});

/**
 * Handle application quit request from renderer process
 */
ipcMain.handle('app-quit', () => {
  log.info('app-quit requested');
  isQuitting = true;
  app.quit();
});

/**
 * Handle close-window request from renderer process.
 * Closes only the window that sent the request, without quitting the whole app.
 */
ipcMain.handle('close-window', (event: any) => {
  log.info('close-window requested');
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (senderWindow) {
    windowsAllowedToClose.add(senderWindow.id);
    senderWindow.close();
  }
});

/**
 * Handle application relaunch request from renderer process
 */
ipcMain.handle('app-relaunch', () => {
  log.info('app-relaunch requested');
  app.relaunch();
  app.exit(0);
});

ipcMain.handle('install-update-now', () => {
  log.info('install-update-now requested');
  // Install silently and restart - isSilent:true, isForceRunAfter:true
  getAutoUpdater().quitAndInstall(true, true);
});

ipcMain.handle('set-update-auto-install-on-quit', () => {
  log.info('set-update-auto-install-on-quit requested');
  updateAutoInstallPending = true;
});

/**
 * Broadcast file history updates to all windows except the sender
 * so that every window's recent-files menu stays in sync.
 * Also includes the pre-warmed window so it stays up-to-date
 * before being promoted.
 */
ipcMain.handle('broadcast-file-history-updated', (event: any, filesHistory: any) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  openWindows.forEach((w) => {
    if (!w.isDestroyed() && w !== senderWindow) {
      w.webContents.send('file-history-updated', filesHistory);
    }
  });
  // Keep the pre-warmed window in sync too (it is not in openWindows yet)
  if (prewarmedWindow && !prewarmedWindow.isDestroyed()) {
    prewarmedWindow.webContents.send('file-history-updated', filesHistory);
  }
});

/**
 * Handle opening a file in a new window.
 * Uses a pre-warmed window (if available) for near-instant startup,
 * falling back to createWindow otherwise.
 */
ipcMain.handle('open-file-in-new-window', async (_event: any, filePath?: string) => {
  try {
    log.info('open-file-in-new-window requested');
    let targetPath = filePath;
    if (!targetPath) {
      const result = await electron.dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'Khiops Files', extensions: ['json', 'khj', 'khcj'] }],
      });
      if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
        return { success: false, reason: 'canceled' };
      }
      targetPath = result.filePaths[0];
    }

    // Use pre-warmed window if available (near-instant), otherwise fall back to createWindow
    let newWindow: BrowserWindow;
    let alreadyLoaded = false;

    if (prewarmedWindow && !prewarmedWindow.isDestroyed()) {
      log.info('Using pre-warmed window for instant file open in new window');
      newWindow = promotePrewarmedWindow();
      alreadyLoaded = true;
      schedulePrewarm();
    } else {
      newWindow = createWindow();
    }

    const sendFileOpen = () => {
      newWindow.webContents.send('file-open-system', targetPath);
    };

    if (alreadyLoaded) {
      sendFileOpen();
    } else {
      newWindow.webContents.once('did-finish-load', sendFileOpen);
    }

    newWindow.show();
    newWindow.focus();

    return { success: true };
  } catch (error) {
    log.error('Error opening file in new window:', error);
    return { success: false, error: error };
  }
});

/**
 * Handle creating a new window with a detached tab
 * @param _event The IPC event
 * @param data Object containing the tab data to restore in the new window
 */
ipcMain.handle('create-window-with-tab', async (_event: any, data: any) => {
  try {
    log.info('create-window-with-tab requested with tab:', data?.tab?.title);

    // Use pre-warmed window if available (near-instant), otherwise fall back to createWindow
    let newWindow: BrowserWindow;
    let alreadyLoaded = false;

    if (prewarmedWindow && !prewarmedWindow.isDestroyed()) {
      log.info('Using pre-warmed window for instant tab move');
      newWindow = promotePrewarmedWindow();
      alreadyLoaded = true;
      // Start creating the next pre-warmed window for future use
      schedulePrewarm();
    } else {
      newWindow = createWindow();
    }

    if (data && data.tab) {
      const sendTabData = () => {
        log.info('Sending restore-tab event to new window');
        newWindow.webContents?.send('restore-tab', { tab: data.tab });
      };

      if (alreadyLoaded) {
        // Pre-warmed window is already loaded — send tab data immediately
        sendTabData();
      } else {
        // Wait for the window to be fully loaded before sending the tab data
        newWindow.webContents.once('did-finish-load', sendTabData);
      }
    }

    // Show and focus the new window
    newWindow.show();
    newWindow.focus();

    return { success: true };
  } catch (error) {
    log.error('Error creating new window with tab:', error);
    return { success: false, error: error };
  }
});

/**
 * Register autoUpdater event listeners.
 * Called lazily so that electron-updater is not loaded at startup.
 */
let _autoUpdaterEventsRegistered = false;
function setupAutoUpdaterEvents() {
  if (_autoUpdaterEventsRegistered) return;
  _autoUpdaterEventsRegistered = true;

  const au = getAutoUpdater();

  au.on('checking-for-update', () => {
    log.info('checking-for-update');
  });
  au.on('update-available', (info: any) => {
    log.info('update-available', info);
    setTimeout(function () {
      win?.webContents?.send('update-available', info);
    }, 2000);
    // Auto-download after 5 seconds
    setTimeout(function () {
      log.info('Auto-starting download of available update');
      getAutoUpdater().downloadUpdate();
    }, 5000);
  });

  au.on('update-not-available', (info: any) => {
    log.info('update-not-available', info);
    setTimeout(function () {
      win?.webContents?.send('update-not-available', info);
    }, 2000);
  });

  au.on('download-progress', (progressObj: any) => {
    log.info('download-progress', progressObj);
    win?.webContents?.send('download-progress-info', progressObj);
  });

  au.on(
    'update-downloaded',
    (event: any, releaseNotes: any, releaseName: any) => {
      log.info('update-downloaded', event);
      isUpdateReadyToInstall = true;
      // Automatically flag update for silent installation on quit
      // This ensures the update will be installed even if user closes app without clicking "Install"
      updateAutoInstallPending = true;
      win?.webContents?.send('update-ready', {
        releaseNotes,
        releaseName,
      });
    },
  );

  au.on('error', (message: any) => {
    log.info('error', message);

    setTimeout(function () {
      win?.webContents?.send('update-error', message);
    }, 2000);
  });
}
