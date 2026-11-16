import { test as base, expect } from '@playwright/test';
import { ElectronApplication, Page, _electron as electron } from 'playwright';
import * as PATH from 'path';

type ElectronFixtures = {
  app: ElectronApplication;
  firstWindow: Page;
};

function hideNotifications(): void {
  const marker = Symbol.for('kvd.e2e.hideNotifications');
  if (Object.hasOwn(window, marker)) return;
  Object.defineProperty(window, marker, { value: true });

  const stylesheet = new CSSStyleSheet();
  stylesheet.replaceSync(`
    .mat-mdc-snack-bar-container, .toastify {
      opacity: 0 !important;
      pointer-events: none !important;
    }
    .cdk-overlay-pane:has(.mat-mdc-snack-bar-container) {
      pointer-events: none !important;
    }
  `);
  const addStyles = (root: Document | ShadowRoot) => {
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, stylesheet];
  };
  const addExistingRoots = (root: Document | ShadowRoot) => {
    addStyles(root);
    for (const element of root.querySelectorAll('*')) {
      if (element.shadowRoot) addExistingRoots(element.shadowRoot);
    }
  };
  const attachShadow = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (options: ShadowRootInit): ShadowRoot {
    const root = attachShadow.call(this, options);
    addStyles(root);
    return root;
  };
  addExistingRoots(document);
}

async function launchApp(): Promise<ElectronApplication> {
  const app = await electron.launch({
    args: [
      PATH.join(__dirname, '../../app/main.js'),
      '--serve',
      '--no-sandbox',
    ],
  });
  try {
    await app.context().addInitScript(hideNotifications);
    await app.firstWindow();
    for (const page of app.context().pages()) {
      await page.waitForLoadState('domcontentloaded');
      await page.evaluate(hideNotifications);
    }
    return app;
  } catch (error) {
    await app.close();
    throw error;
  }
}

async function waitForPage(firstWindow: Page): Promise<void> {
  await firstWindow.waitForSelector('app-root', { timeout: 60000 });

  await firstWindow.waitForFunction(
    () => {
      const root = document.querySelector('app-root');
      return root && root.children.length > 0;
    },
    { timeout: 60000 },
  );

  await firstWindow.waitForLoadState('networkidle', { timeout: 60000 });
  await firstWindow.waitForFunction(
    () => window.require('electron').ipcRenderer.listenerCount('file-open-system') > 0,
    undefined,
    { timeout: 60000 },
  );
}

async function getFirstWindow(app: ElectronApplication): Promise<Page> {
  const firstWindow = await app.firstWindow();

  if (process.env.E2E_APP_URL) {
    await firstWindow.goto(process.env.E2E_APP_URL);
  }

  firstWindow.on('console', (msg) => {
    console.log(`[browser] ${msg.type()}: ${msg.text()}`);
  });
  const browserWindow = await app.browserWindow(firstWindow);
  try {
    await browserWindow.evaluate((win) => new Promise<void>((resolve) => {
      if (win.isVisible()) {
        resolve();
      } else {
        win.once('show', () => resolve());
      }
    }));
  } finally {
    await browserWindow.dispose();
  }
  await waitForPage(firstWindow);
  return firstWindow;
}

export const test = base.extend<ElectronFixtures>({
  app: async ({}, use) => {
    const app = await launchApp();
    try {
      await use(app);
    } finally {
      await app.close();
    }
  },

  firstWindow: async ({ app }, use) => {
    const firstWindow = await getFirstWindow(app);
    await use(firstWindow);
  },
});

type ScreenshotWorker = {
  screenshotState: {
    app: ElectronApplication;
    firstWindow: Page;
    needsReset: boolean;
  };
};

export const screenshotTest = base.extend<ElectronFixtures, ScreenshotWorker>({
  screenshotState: [async ({}, use) => {
    const app = await launchApp();
    try {
      const firstWindow = await getFirstWindow(app);
      await use({ app, firstWindow, needsReset: false });
    } finally {
      await app.close();
    }
  }, { scope: 'worker', timeout: 120000 }],

  app: async ({ screenshotState }, use) => {
    await use(screenshotState.app);
  },

  firstWindow: async ({ screenshotState }, use, testInfo) => {
    const { firstWindow } = screenshotState;
    if (screenshotState.needsReset) {
      await firstWindow.reload();
      await waitForPage(firstWindow);
    }
    await use(firstWindow);
    screenshotState.needsReset = testInfo.status !== testInfo.expectedStatus ||
      !testInfo.annotations.some((annotation) => annotation.type === 'preserve-screenshot-state');
  },
});

export { expect };
