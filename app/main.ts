import { app, BrowserWindow, clipboard, screen } from 'electron';
import * as electron from 'electron';
import * as remoteMain from '@electron/remote/main';
remoteMain.initialize();
import * as path from 'path';
import * as fs from 'fs';
import { machineIdSync } from 'node-machine-id';
const { autoUpdater } = require('electron-updater');
import * as url from 'url';

const log = require('electron-log');
let win: BrowserWindow | null = null;
const openWindows: BrowserWindow[] = []; // Track all open windows for multi-window support
let isQuitting = false;
let isUpdateReadyToInstall = false;
let updateAutoInstallPending = false;
const args = process.argv.slice(1),
  serve = args.some((val) => val === '--serve');
const { Menu } = require('electron');
const { ipcMain } = require('electron');
if (serve) require('electron-debug');
if (serve) require('source-map-support').install();

process.env['ELECTRON_DISABLE_SECURITY_WARNINGS'] = 'true';

// log.transports.file.level = 'info';
// log.transports.file.file = __dirname + '/electron.log';
// const storage = require('electron-json-storage');
log.warn('App Desktop starting...');
autoUpdater.autoInstallOnAppQuit = false;
autoUpdater.autoDownload = false;
autoUpdater.allowDowngrade = false;

// Try to fix ERR_HTTP2_PROTOCOL_ERROR
// https://github.com/electron-userland/electron-builder/issues/4987
// app.commandLine.appendSwitch('disable-http2');
// autoUpdater.requestHeaders = {
//   'Cache-Control':
//     'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
// };

ipcMain.handle('get-machine-id', async () => {
  try {
    return machineIdSync();
  } catch (error) {
    console.error('Error getting machine ID:', error);
    return '';
  }
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

  // Enable remote for main process
  require('@electron/remote/main').enable(newWindow);
  // Enable remote for renderer process
  require('@electron/remote/main').enable(newWindow.webContents);

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
  });

  newWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      newWindow?.show(); // Show window if hidden or minimized
      newWindow?.focus(); // Focus the window to bring it to the front
      newWindow?.webContents?.send('before-quit');
    }
  });

  // Track the primary window
  if (!win) {
    win = newWindow;
  }

  // Add to windows array for multi-window support
  openWindows.push(newWindow);

  return newWindow;
}

try {
  // This method will be called when Electron has finished
  // initialization and is ready to create browser windows.
  // Some APIs can only be used after this event occurs.
  // Added 400 ms to fix the black background issue while using transparent window. More detais at https://github.com/electron/electron/issues/15947
  app.on('ready', () => setTimeout(createWindow, 400));

  // Handle before-quit event to allow window closing
  app.on('before-quit', () => {
    isQuitting = true;
    // If update is ready and pending auto-install on quit, install it silently
    if (isUpdateReadyToInstall && updateAutoInstallPending) {
      log.info('Installing update silently on app quit');
      autoUpdater.quitAndInstall(true, true);
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
    // In serve mode (dev/test), argv[1] is main.js itself - not a user file
    if (serve) {
      event.returnValue = null;
      return;
    }
    // return input files on Windows
    event.returnValue = process.argv[1];
  } catch (error) {
    console.log('error', error);
  }
});

ipcMain.handle('launch-update-available', async () => {
  try {
    log.info('launch-update-available');
    autoUpdater.downloadUpdate();
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
  autoUpdater.allowPrerelease = channel === 'beta';
  log.info('checkForUpdates');
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err: Error) => {
      // Silently ignore network errors during update check
      log.warn('checkForUpdates failed (non-blocking):', err.message);
      win?.webContents?.send('update-error', err);
    });
  }, delay);
}

ipcMain.handle('set-title-bar-name', async (_event: any, arg: any) => {
  win?.setTitle(arg?.title);
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
 * Handle application quit request from renderer process
 */
ipcMain.handle('app-quit', () => {
  log.info('app-quit requested');
  isQuitting = true;
  app.quit();
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
  autoUpdater.quitAndInstall(true, true);
});

ipcMain.handle('set-update-auto-install-on-quit', () => {
  log.info('set-update-auto-install-on-quit requested');
  updateAutoInstallPending = true;
});

/**
 * Handle creating a new window with a detached tab
 * @param _event The IPC event
 * @param data Object containing the tab data to restore in the new window
 */
ipcMain.handle('create-window-with-tab', async (_event: any, data: any) => {
  try {
    log.info('create-window-with-tab requested with tab:', data?.tab?.title);
    const newWindow = createWindow();

    // Store the tab data to be passed to the new window once it's ready
    if (data && data.tab) {
      // Wait for the window to be fully loaded before sending the tab data
      newWindow.webContents.once('did-finish-load', () => {
        log.info('New window loaded, sending restore-tab event');
        newWindow.webContents?.send('restore-tab', {
          tab: data.tab,
        });
      });
    }

    return { success: true };
  } catch (error) {
    log.error('Error creating new window with tab:', error);
    return { success: false, error: error };
  }
});

autoUpdater.on('checking-for-update', () => {
  log.info('checking-for-update');
});
autoUpdater.on('update-available', (info: any) => {
  log.info('update-available', info);
  setTimeout(function () {
    win?.webContents?.send('update-available', info);
  }, 2000);
  // Auto-download after 5 seconds
  setTimeout(function () {
    log.info('Auto-starting download of available update');
    autoUpdater.downloadUpdate();
  }, 5000);
});

autoUpdater.on('update-not-available', (info: any) => {
  log.info('update-not-available', info);
  setTimeout(function () {
    win?.webContents?.send('update-not-available', info);
  }, 2000);
});

autoUpdater.on('download-progress', (progressObj: any) => {
  log.info('download-progress', progressObj);
  win?.webContents?.send('download-progress-info', progressObj);
});

autoUpdater.on(
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

autoUpdater.on('error', (message: any) => {
  log.info('error', message);

  setTimeout(function () {
    win?.webContents?.send('update-error', message);
  }, 2000);
});
