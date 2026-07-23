/*
 * Copyright (c) 2023-2026 Orange. All rights reserved.
 * This software is distributed under the BSD 3-Clause-clear License, the text of which is available
 * at https://spdx.org/licenses/BSD-3-Clause-Clear.html or see the "LICENSE" file for more details.
 */

import { test, expect } from './fixtures/launch-electron';
import {
  clickMenuItem,
  mockOpenDialog,
  mockAppQuit,
  simulateWindowClose,
  waitForSaveDialog,
  clickSaveDialogButton,
} from './helpers/electron-menu';

// ─── Shared helpers ──────────────────────────────────────────────────────────

/**
 * Open a file via the mocked open dialog and wait for its component to appear.
 */
async function openFile(
  app: Parameters<typeof mockOpenDialog>[0],
  firstWindow: Parameters<typeof waitForSaveDialog>[0],
  mockFileName: string,
  selector: 'khiops-visualization' | 'khiops-covisualization',
  expectedCount: number,
) {
  await mockOpenDialog(app, mockFileName);
  await clickMenuItem(app, 'File', 'Open');
  await expect(firstWindow.locator(selector)).toHaveCount(expectedCount, {
    timeout: 30_000,
  });

  const activeTab = firstWindow.locator('.tab.active');
  const escapedFileName = mockFileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  await expect(activeTab).toContainText(new RegExp(escapedFileName), {
    timeout: 15_000,
  });

  await expect(activeTab.locator('.tab-spinner')).toHaveCount(0, {
    timeout: 30_000,
  });
}

async function markActiveTabDirty(
  firstWindow: Parameters<typeof waitForSaveDialog>[0],
) {
  const activeTab = firstWindow.locator('.tab.active');
  await expect(activeTab.locator('.tab-spinner')).toHaveCount(0, {
    timeout: 30_000,
  });

  const expando = firstWindow.locator('.tree-expando:visible').first();
  await expect(expando).toBeVisible({ timeout: 15_000 });
  await expando.click();

  await expect(activeTab.locator('.tab-dirty')).toBeVisible({
    timeout: 15_000,
  });
}

// ─── afterEach screenshot on failure ─────────────────────────────────────────

test.afterEach(async ({ firstWindow }, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    await firstWindow.screenshot({
      path: `test-results/${testInfo.title.replace(/[^a-z0-9]/gi, '_')}-manual.png`,
      fullPage: true,
    });
  }
});

// ─── No covisualization file open ────────────────────────────────────────────

test.describe('Quit with no covisualization tab open', () => {
  test('closing with only a visualization tab shows no save dialog and closes the tab', async ({
    app,
    firstWindow,
  }) => {
    await firstWindow.waitForLoadState('networkidle');
    await mockAppQuit(app);

    // Open a visualization file (.khj) — must not trigger any dialog
    await openFile(app, firstWindow, 'bi2.json', 'khiops-visualization', 1);

    await simulateWindowClose(app);

    // Visualization tab must be closed (no save dialog for visualization)
    await expect(firstWindow.locator('khiops-visualization')).toHaveCount(0, {
      timeout: 5000,
    });

    // Dialog must NOT appear
    await firstWindow.waitForTimeout(2000);
    await expect(
      firstWindow.getByText('Do you want to save the changes you made?'),
    ).toHaveCount(0);
  });
});

// ─── Single covisualization tab ───────────────────────────────────────────────

test.describe('Quit with a single covisualization tab', () => {
  test('Cancel keeps the app open and the tab visible', async ({
    app,
    firstWindow,
  }) => {
    await firstWindow.waitForLoadState('networkidle');
    await mockAppQuit(app);

    await openFile(
      app,
      firstWindow,
      'covisu-1.khcj',
      'khiops-covisualization',
      1,
    );

    // Make the page dirty by interacting with the UI
    await markActiveTabDirty(firstWindow);

    await simulateWindowClose(app);
    await waitForSaveDialog(firstWindow);

    await clickSaveDialogButton(firstWindow, 'cancel');

    // Dialog must disappear
    await expect(
      firstWindow.getByText('Do you want to save the changes you made?'),
    ).toHaveCount(0, { timeout: 5000 });

    // Tab is still open
    await expect(firstWindow.locator('khiops-covisualization')).toHaveCount(1);

    // Window is still visible
    const windowState = await app.evaluate(({ BrowserWindow }) => {
      const win =
        BrowserWindow.getFocusedWindow() ??
        BrowserWindow.getAllWindows().find((w) => w.isVisible());
      return { isVisible: win?.isVisible() };
    });
    expect(windowState.isVisible).toBeTruthy();
  });

  test('No closes the tab without saving and triggers quit', async ({
    app,
    firstWindow,
  }) => {
    await firstWindow.waitForLoadState('networkidle');
    await mockAppQuit(app);

    await openFile(
      app,
      firstWindow,
      'covisu-1.khcj',
      'khiops-covisualization',
      1,
    );

    // Make the page dirty by interacting with the UI
    await markActiveTabDirty(firstWindow);

    await simulateWindowClose(app);
    await waitForSaveDialog(firstWindow);

    await clickSaveDialogButton(firstWindow, 'no');

    // Tab must be closed
    await expect(firstWindow.locator('khiops-covisualization')).toHaveCount(0, {
      timeout: 5000,
    });
  });

  test('Save closes the tab and triggers quit', async ({
    app,
    firstWindow,
  }) => {
    await firstWindow.waitForLoadState('networkidle');
    await mockAppQuit(app);

    await openFile(
      app,
      firstWindow,
      'covisu-1.khcj',
      'khiops-covisualization',
      1,
    );

    // Make the page dirty by interacting with the UI
    await markActiveTabDirty(firstWindow);

    await simulateWindowClose(app);
    await waitForSaveDialog(firstWindow);

    await clickSaveDialogButton(firstWindow, 'save');

    // Tab must be closed after save
    await expect(firstWindow.locator('khiops-covisualization')).toHaveCount(0, {
      timeout: 5000,
    });
  });
});

// ─── Multiple covisualization tabs ────────────────────────────────────────────

test.describe('Quit with two covisualization tabs', () => {
  test('Cancel on the first dialog aborts quit — both tabs remain', async ({
    app,
    firstWindow,
  }) => {
    await firstWindow.waitForLoadState('networkidle');
    await mockAppQuit(app);

    // Open two different covisu files
    await openFile(
      app,
      firstWindow,
      'covisu-1.khcj',
      'khiops-covisualization',
      1,
    );

    // Make the page dirty by interacting with the UI
    await markActiveTabDirty(firstWindow);

    await openFile(
      app,
      firstWindow,
      'covisu-2.khcj',
      'khiops-covisualization',
      2,
    );

    await simulateWindowClose(app);

    // First dialog — Cancel
    await waitForSaveDialog(firstWindow);
    await clickSaveDialogButton(firstWindow, 'cancel');

    // No second dialog must appear
    await firstWindow.waitForTimeout(1000);
    await expect(
      firstWindow.getByText('Do you want to save the changes you made?'),
    ).toHaveCount(0, { timeout: 2000 });

    // Both tabs are still open
    await expect(firstWindow.locator('khiops-covisualization')).toHaveCount(2);
  });

  test('No on first tab then No on second — both tabs closed', async ({
    app,
    firstWindow,
  }) => {
    await firstWindow.waitForLoadState('networkidle');
    await mockAppQuit(app);

    await openFile(
      app,
      firstWindow,
      'covisu-1.khcj',
      'khiops-covisualization',
      1,
    );

    // Make the page dirty by interacting with the UI
    await markActiveTabDirty(firstWindow);

    await openFile(
      app,
      firstWindow,
      'covisu-2.khcj',
      'khiops-covisualization',
      2,
    );

    // Make the page dirty by interacting with the UI
    await markActiveTabDirty(firstWindow);

    await simulateWindowClose(app);

    // First dialog — No
    await waitForSaveDialog(firstWindow);
    await clickSaveDialogButton(firstWindow, 'no');

    // Second dialog — No
    await waitForSaveDialog(firstWindow);
    await clickSaveDialogButton(firstWindow, 'no');

    // Both tabs must be closed
    await expect(firstWindow.locator('khiops-covisualization')).toHaveCount(0, {
      timeout: 5000,
    });
  });

  test('Save on first then No on second — both tabs closed', async ({
    app,
    firstWindow,
  }) => {
    await firstWindow.waitForLoadState('networkidle');
    await mockAppQuit(app);

    await openFile(
      app,
      firstWindow,
      'covisu-1.khcj',
      'khiops-covisualization',
      1,
    );

    // Make the page dirty by interacting with the UI
    await markActiveTabDirty(firstWindow);

    await openFile(
      app,
      firstWindow,
      'covisu-2.khcj',
      'khiops-covisualization',
      2,
    );

    // Make the page dirty by interacting with the UI
    await markActiveTabDirty(firstWindow);

    await simulateWindowClose(app);

    // First dialog — Save
    await waitForSaveDialog(firstWindow);
    await clickSaveDialogButton(firstWindow, 'save');

    // After first tab saved and closed, second dialog must appear
    await waitForSaveDialog(firstWindow);

    // Still one tab open (the second one)
    await expect(firstWindow.locator('khiops-covisualization')).toHaveCount(1);

    // Second dialog — No
    await clickSaveDialogButton(firstWindow, 'no');

    // Both tabs now closed
    await expect(firstWindow.locator('khiops-covisualization')).toHaveCount(0, {
      timeout: 5000,
    });
  });

  test('Save on first then Cancel on second — first closed, second remains', async ({
    app,
    firstWindow,
  }) => {
    await firstWindow.waitForLoadState('networkidle');
    await mockAppQuit(app);

    await openFile(
      app,
      firstWindow,
      'covisu-1.khcj',
      'khiops-covisualization',
      1,
    );

    // Make the page dirty by interacting with the UI
    await markActiveTabDirty(firstWindow);

    await openFile(
      app,
      firstWindow,
      'covisu-2.khcj',
      'khiops-covisualization',
      2,
    );

    // Make the page dirty by interacting with the UI
    await markActiveTabDirty(firstWindow);

    await simulateWindowClose(app);

    // First dialog — Save
    await waitForSaveDialog(firstWindow);
    await clickSaveDialogButton(firstWindow, 'save');

    // Second dialog — Cancel
    await waitForSaveDialog(firstWindow);
    await clickSaveDialogButton(firstWindow, 'cancel');

    // Only one tab remains (the second one, quit was cancelled)
    await expect(firstWindow.locator('khiops-covisualization')).toHaveCount(1, {
      timeout: 5000,
    });

    // Window still visible
    const windowState = await app.evaluate(({ BrowserWindow }) => {
      const win =
        BrowserWindow.getFocusedWindow() ??
        BrowserWindow.getAllWindows().find((w) => w.isVisible());
      return { isVisible: win?.isVisible() };
    });
    expect(windowState.isVisible).toBeTruthy();
  });
});

// ─── Mixed tabs (visualization + covisualization) ─────────────────────────────

test.describe('Quit with mixed visualization and covisualization tabs', () => {
  test('Visualization tab is closed first, then covisualization dialog appears', async ({
    app,
    firstWindow,
  }) => {
    await firstWindow.waitForLoadState('networkidle');
    await mockAppQuit(app);

    // Open a visualization file first
    await openFile(app, firstWindow, 'bi2.json', 'khiops-visualization', 1);

    // Then open a covisualization file
    await openFile(
      app,
      firstWindow,
      'covisu-1.khcj',
      'khiops-covisualization',
      1,
    );

    // Make the page dirty by interacting with the UI
    await markActiveTabDirty(firstWindow);

    await simulateWindowClose(app);

    // The visualization tab must be closed immediately (no save dialog)
    await expect(firstWindow.locator('khiops-visualization')).toHaveCount(0, {
      timeout: 5000,
    });

    // Exactly one dialog for the covisu tab
    await waitForSaveDialog(firstWindow);
    await clickSaveDialogButton(firstWindow, 'no');

    // The covisu tab is closed
    await expect(firstWindow.locator('khiops-covisualization')).toHaveCount(0, {
      timeout: 5000,
    });

    // No second dialog
    await firstWindow.waitForTimeout(1000);
    await expect(
      firstWindow.getByText('Do you want to save the changes you made?'),
    ).toHaveCount(0);
  });

  test('With two visualization tabs and one covisualization — all visu tabs closed, covisu gets dialog', async ({
    app,
    firstWindow,
  }) => {
    await firstWindow.waitForLoadState('networkidle');
    await mockAppQuit(app);

    // Open two visualization files
    await openFile(app, firstWindow, 'bi2.json', 'khiops-visualization', 1);
    await openFile(app, firstWindow, 'bi3.json', 'khiops-visualization', 2);

    // Then open a covisualization file
    await openFile(
      app,
      firstWindow,
      'covisu-1.khcj',
      'khiops-covisualization',
      1,
    );

    // Make the page dirty by interacting with the UI
    await markActiveTabDirty(firstWindow);

    await simulateWindowClose(app);

    // Both visualization tabs must be closed immediately
    await expect(firstWindow.locator('khiops-visualization')).toHaveCount(0, {
      timeout: 5000,
    });

    // Dialog for the covisu tab
    await waitForSaveDialog(firstWindow);
    await clickSaveDialogButton(firstWindow, 'no');

    // The covisu tab is closed
    await expect(firstWindow.locator('khiops-covisualization')).toHaveCount(0, {
      timeout: 5000,
    });
  });
});
