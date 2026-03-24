import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import { ipcMain } from 'electron';

const log = require('electron-log');

log.warn('[SPLASH-PROCESS] Starting splash process...');

let splashWin: BrowserWindow | null = null;

/**
 * Splash-only minimal Electron process.
 * Launched immediately by parent process while main app initializes.
 * This process launches instantly because it's created by the already-initialized
 * parent process, not blocked by Electron's 10-second initialization time.
 */

function createSplashWindow(): void {
  log.warn('[SPLASH-PROCESS] Creating splash window...');
  
  try {
    splashWin = new BrowserWindow({
      width: 424,
      height: 284,
      frame: false,
      resizable: false,
      center: true,
      alwaysOnTop: true,
      skipTaskbar: false, // Changed to true for better visibility
      hasShadow: false,
      transparent: true,
      show: false, // Don't show until ready
      backgroundColor: '#00000000',
      type: process.platform === 'win32' ? 'toolbar' : undefined,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
      },
    });

    const splashPath = path.join(__dirname, 'splash.html');
    log.warn('[SPLASH-PROCESS] Loading splash.html from:', splashPath);
    
    splashWin.loadFile(splashPath).catch((err) => {
      log.error('[SPLASH-PROCESS] Error loading splash.html:', err);
    });

    // Show window once it's ready
    splashWin.once('ready-to-show', () => {
      log.warn('[SPLASH-PROCESS] Window ready-to-show, displaying...');
      splashWin?.show();
      splashWin?.focus();
    });

    // Log window events
    splashWin.webContents.on('did-finish-load', () => {
      log.warn('[SPLASH-PROCESS] Splash HTML loaded successfully');
    });

    splashWin.on('unresponsive', () => {
      log.error('[SPLASH-PROCESS] Splash window unresponsive!');
    });

    splashWin.on('closed', () => {
      log.warn('[SPLASH-PROCESS] Splash window closed');
      splashWin = null;
    });

    log.warn('[SPLASH-PROCESS] Splash window created successfully');
  } catch (error) {
    log.error('[SPLASH-PROCESS] Error creating splash window:', error);
  }
}

log.warn('[SPLASH-PROCESS] Waiting for app.on("ready")...');

app.on('ready', () => {
  log.warn('[SPLASH-PROCESS] >>> app.on("ready") fired <<< ');
  createSplashWindow();
  log.warn('[SPLASH-PROCESS] Process ready');
});

// Prevent app from quitting immediately on window close
app.on('window-all-closed', () => {
  log.warn('[SPLASH-PROCESS] window-all-closed');
  if (process.platform !== 'darwin') {
    log.warn('[SPLASH-PROCESS] Quitting app');
    app.quit();
  }
});

// Handle app activate (macOS)
app.on('activate', () => {
  log.warn('[SPLASH-PROCESS] activate event');
  if (!splashWin) {
    createSplashWindow();
  }
});

/**
 * Main process requests close of splash
 */
ipcMain.handle('splash-close', () => {
  log.warn('[SPLASH-PROCESS] splash-close requested by main process');
  if (splashWin && !splashWin.isDestroyed()) {
    splashWin.close();
  }
});

/**
 * Emergency close button in splash UI
 */
ipcMain.on('splash-user-close', () => {
  log.warn('[SPLASH-PROCESS] splash-user-close requested from UI');
  if (splashWin && !splashWin.isDestroyed()) {
    splashWin.close();
  }
  app.quit();
});
