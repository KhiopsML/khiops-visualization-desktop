import { app, BrowserWindow, clipboard, screen } from 'electron';
import * as electron from 'electron';
import * as remoteMain from '@electron/remote/main';
remoteMain.initialize();
import * as path from 'path';
import * as fs from 'fs';
import { machineIdSync } from 'node-machine-id';
const { autoUpdater } = require('electron-updater');
import * as url from 'url';
import { spawn, ChildProcess } from 'child_process';

const log = require('electron-log');
let win: BrowserWindow | null = null;
let splashWin: BrowserWindow | null = null; // Fallback splash for production
let splashProcess: ChildProcess | null = null; // Separate splash-process for development
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

/**
 * Launch the splash-process immediately on startup.
 * This is a separate Electron process that displays immediately,
 * without waiting for the main app's 10-second initialization.
 *
 * The splash-process runs in parallel while this main process initializes.
 */
function launchSplashProcess(): void {
  try {
    // Only launch splash in development mode (--serve flag)
    // In production, the app loads from dist/ and splash timing is different
    if (!serve) {
      log.warn('[MAIN] Production mode - skipping splash process');
      return;
    }

    // Determine path to splash-process-main.js
    // In development: app/splash-process-main.js (relative to app/ dir which is __dirname)
    let splashProcessPath = path.join(__dirname, 'splash-process-main.js');

    // Check if splash-process exists in current location
    if (!fs.existsSync(splashProcessPath)) {
      log.error(
        '[MAIN] splash-process-main.js not found at:',
        splashProcessPath,
      );
      log.error('[MAIN] Skipping splash screen');
      return; // Don't crash the main app if splash fails
    }

    log.warn('[MAIN] Launching splash-process from:', splashProcessPath);
    log.warn('[MAIN] File exists:', fs.existsSync(splashProcessPath));

    splashProcess = spawn(process.execPath, ['--app', splashProcessPath], {
      detached: false,
      stdio: ['inherit', 'inherit', 'inherit'], // Show splash process output
      env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' },
    });

    splashProcess.on('error', (err) => {
      log.error('[MAIN] Failed to launch splash-process:', err);
    });

    splashProcess.on('exit', (code, signal) => {
      log.warn(
        '[MAIN] Splash-process exited with code:',
        code,
        'signal:',
        signal,
      );
      splashProcess = null;
    });

    log.warn('[MAIN] Splash-process launched with PID:', splashProcess.pid);
  } catch (error) {
    log.error('[MAIN] Error launching splash-process:', error);
  }
}

/**
 * Close the splash-process when main app is ready to show.
 */
function closeSplashProcess(): void {
  if (splashProcess && !splashProcess.killed) {
    try {
      log.info('Closing splash-process (PID:', splashProcess.pid, ')');
      splashProcess.kill('SIGTERM');
      splashProcess = null;
    } catch (error) {
      log.error('Error closing splash-process:', error);
    }
  }
}

/**
 * Create a simple splash window for production mode.
 * This is a built-in splash, not a separate process like in dev.
 */
function createProductionSplash(): void {
  if (serve) {
    log.info('[PROD-SPLASH] Skipping prod splash (serve mode detected)');
    return;
  }

  try {
    log.warn('[PROD-SPLASH] Creating production splash...');

    splashWin = new BrowserWindow({
      width: 424,
      height: 284,
      frame: false,
      resizable: false,
      center: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      transparent: true,
      backgroundColor: '#00000000',
      type: process.platform === 'win32' ? 'toolbar' : undefined,
      show: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
      },
    });

    const splashPath = path.join(__dirname, 'splash.html');
    log.warn('[PROD-SPLASH] Loading splash from:', splashPath);

    splashWin.loadFile(splashPath).catch((err) => {
      log.error('[PROD-SPLASH] Error loading splash.html:', err);
    });

    splashWin.webContents.on('did-finish-load', () => {
      log.warn('[PROD-SPLASH] Splash HTML loaded, showing window');
    });

    splashWin.once('ready-to-show', () => {
      log.warn('[PROD-SPLASH] Window ready-to-show, displaying');
      splashWin?.show();
      splashWin?.focus();
    });

    splashWin.on('closed', () => {
      log.warn('[PROD-SPLASH] Splash window closed');
      splashWin = null;
    });

    log.warn('[PROD-SPLASH] Splash window created successfully');
  } catch (error) {
    log.error('[PROD-SPLASH] Error creating splash window:', error);
  }
}

/**
 * Close the production splash window.
 */
function closeProductionSplash(): void {
  if (splashWin && !splashWin.isDestroyed()) {
    splashWin.close();
  }
}

// Try to fix ERR_HTTP2_PROTOCOL_ERROR
// https://github.com/electron-userland/electron-builder/issues/4987
// app.commandLine.appendSwitch('disable-http2');
// autoUpdater.requestHeaders = {
//   'Cache-Control':
//     'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
// };

log.warn('App Desktop starting...');
autoUpdater.autoInstallOnAppQuit = false;
autoUpdater.autoDownload = false;
autoUpdater.allowDowngrade = false;

/**
 * CRITICAL: Launch splash immediately BEFORE app.on('ready') is called.
 * This executes synchronously during module load, ensuring the splash
 * displays before Electron's 10-second initialization completes.
 */
launchSplashProcess();

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
    log.info('[FILE-OPEN] File to load stored:', filepath);
    // Don't send file here - wait for app to be ready (see ready-to-show handler)
  });
});

// Disable sandbox for all processes
// app.commandLine.appendSwitch('--no-sandbox');

function createWindow(): BrowserWindow {
  const size = screen.getPrimaryDisplay().workAreaSize;

  // Create the browser window.
  win = new electron.BrowserWindow({
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

  // When the main window is fully loaded, close the splash process and reveal the app
  win.once('ready-to-show', () => {
    // Keep splash visible for at least 1.5 more seconds to give user
    // visual feedback and let them see the loading process
    setTimeout(() => {
      closeSplashProcess(); // Close the separate splash-process (dev mode)
      closeProductionSplash(); // Close the production splash window (prod mode)
      if (win) {
        win.show();
        win.focus();
        log.warn('[MAIN] Main app now displayed');

        // Send fileToLoad after app is visible (ensures renderer is ready)
        if (fileToLoad) {
          log.warn(
            '[MAIN] Sending fileToLoad after splash closes:',
            fileToLoad,
          );
          setTimeout(() => {
            win?.webContents?.send('file-open-system', fileToLoad);
          }, 500); // Give renderer time to initialize
        }
      }
    }, 500); // Keep splash visible during main app load
  });

  // Enable remote for main process
  require('@electron/remote/main').enable(win);
  // Enable remote for renderer process
  require('@electron/remote/main').enable(win.webContents);

  // Custom context menu
  win.webContents.on('context-menu', (_event, params) => {
    // Check if there is selected text or if clipboard has content to enable/disable menu items
    const hasSelection =
      params.selectionText && params.selectionText.trim().length > 0;
    const hasClipboard = clipboard.readText().trim().length > 0;

    // process right-click event and send to renderer process
    win?.webContents?.send('right-click', params);
    Menu.buildFromTemplate([
      { label: 'Copy', role: 'copy', enabled: hasSelection },
      { label: 'Paste', role: 'paste', enabled: hasClipboard },
      { type: 'separator' },
      {
        label: 'Copy image',
        click: () => {
          win?.webContents?.send('copy-image', params);
        },
        accelerator: 'CommandOrControl+Shift+c',
      },
      {
        label: 'Copy datas',
        click: () => {
          win?.webContents?.send('copy-datas', params);
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
    win.loadURL('http://localhost:4200');

    const electronReload = require('electron-reload');
    electronReload(
      path.join(
        __dirname,
        '../visualization-component/dist/khiops-webcomponent/',
      ),
    );
    const setupReloading = require('../electron-reload.js');
    setupReloading(win);
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

    win.loadURL(urlPath);
  }

  // Emitted when the window is closed.
  win.on('closed', () => {
    // Dereference the window object, usually you would store window
    // in an array if your app supports multi windows, this is the time
    // when you should delete the corresponding element.
    win = null;
  });

  win.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      win?.show(); // Show window if hidden or minimized
      win?.focus(); // Focus the window to bring it to the front
      win?.webContents?.send('before-quit');
    }
  });

  return win;
}

try {
  // This method will be called when Electron has finished
  // initialization and is ready to create browser windows.
  // Some APIs can only be used after this event occurs.
  app.on('ready', () => {
    // The splash-process was already launched during module load,
    // displaying immediately. Now just create the main application window.

    // In production mode, create a simple built-in splash window
    if (!serve) {
      createProductionSplash();
    }

    createWindow();
  });

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
  // autoUpdater.forceDevUpdateConfig = true;
  setTimeout(() => {
    autoUpdater.checkForUpdates();
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
