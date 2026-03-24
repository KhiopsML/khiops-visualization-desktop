"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path = require("path");
const electron_2 = require("electron");
const log = require('electron-log');
log.warn('[SPLASH-PROCESS] Starting splash process...');
let splashWin = null;
/**
 * Splash-only minimal Electron process.
 * Launched immediately by parent process while main app initializes.
 * This process launches instantly because it's created by the already-initialized
 * parent process, not blocked by Electron's 10-second initialization time.
 */
function createSplashWindow() {
    log.warn('[SPLASH-PROCESS] Creating splash window...');
    try {
        splashWin = new electron_1.BrowserWindow({
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
            splashWin === null || splashWin === void 0 ? void 0 : splashWin.show();
            splashWin === null || splashWin === void 0 ? void 0 : splashWin.focus();
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
    }
    catch (error) {
        log.error('[SPLASH-PROCESS] Error creating splash window:', error);
    }
}
log.warn('[SPLASH-PROCESS] Waiting for app.on("ready")...');
electron_1.app.on('ready', () => {
    log.warn('[SPLASH-PROCESS] >>> app.on("ready") fired <<< ');
    createSplashWindow();
    log.warn('[SPLASH-PROCESS] Process ready');
});
// Prevent app from quitting immediately on window close
electron_1.app.on('window-all-closed', () => {
    log.warn('[SPLASH-PROCESS] window-all-closed');
    if (process.platform !== 'darwin') {
        log.warn('[SPLASH-PROCESS] Quitting app');
        electron_1.app.quit();
    }
});
// Handle app activate (macOS)
electron_1.app.on('activate', () => {
    log.warn('[SPLASH-PROCESS] activate event');
    if (!splashWin) {
        createSplashWindow();
    }
});
/**
 * Main process requests close of splash
 */
electron_2.ipcMain.handle('splash-close', () => {
    log.warn('[SPLASH-PROCESS] splash-close requested by main process');
    if (splashWin && !splashWin.isDestroyed()) {
        splashWin.close();
    }
});
/**
 * Emergency close button in splash UI
 */
electron_2.ipcMain.on('splash-user-close', () => {
    log.warn('[SPLASH-PROCESS] splash-user-close requested from UI');
    if (splashWin && !splashWin.isDestroyed()) {
        splashWin.close();
    }
    electron_1.app.quit();
});
//# sourceMappingURL=splash-process-main.js.map