---
name: e2e
description: >-
  Write Playwright e2e tests for the khiops-visualization-desktop Electron app.
  Use when asked to add e2e tests, write spec files, cover a new feature or bug
  fix with end-to-end tests, or reproduce a UI regression as a Playwright test.
---

You are an expert in Playwright e2e testing for Electron applications.

Generate complete, ready-to-run Playwright spec files for the khiops-visualization-desktop app.

## Project structure

```
e2e/
  fixtures/launch-electron.ts   # shared app + firstWindow fixtures
  helpers/electron-menu.ts      # clickMenuItem(), mockOpenDialog()
  mocks/                        # JSON/TXT test data files
  check-*.spec.ts               # spec files
  playwright.config.ts
```

## Core philosophy

Every test must assert on **real, observable outcomes** — visible elements, text content, counts, states.

Do NOT write tests that only check `toBeVisible()` without also checking meaningful content.

For each test, think: "after action X, the UI must show exactly Y."

Example:
```ts
await mockOpenDialog(app, 'bi2.json');
await clickMenuItem(app, 'File', 'Open');
await firstWindow.waitForSelector('khiops-visualization');
const activeTab = firstWindow.locator('.tab.active');
await expect(activeTab).toHaveText(/bi2\.json/);
```

## Rules

- Always import from `./fixtures/launch-electron` (never from `@playwright/test` directly)
- Always use the `app` and `firstWindow` fixtures provided by the shared fixture
- Open files using `mockOpenDialog(app, filename)` then `clickMenuItem(app, 'File', 'Open')` — never use native dialogs
- Wait for Angular to initialize before interacting: `await firstWindow.waitForLoadState('networkidle')`
- Add a `waitForSelector` on the expected component before asserting on it
- Use `test.describe` to group related tests
- Add `test.afterEach` screenshot on failure for debugging:
  ```ts
  test.afterEach(async ({ firstWindow }, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) {
      await firstWindow.screenshot({
        path: `test-results/${testInfo.title}-manual.png`,
        fullPage: true,
      });
    }
  });
  ```
- Do NOT use `page` — always use `firstWindow`
- Do NOT call `app.close()` inside tests — the fixture handles teardown

## Available fixtures (`./fixtures/launch-electron`)

```ts
// app: ElectronApplication — the running Electron instance
// firstWindow: Page — the renderer window, already loaded and ready
import { test, expect } from './fixtures/launch-electron';
```

## Available helpers (`./helpers/electron-menu`)

```ts
import { clickMenuItem, mockOpenDialog } from './helpers/electron-menu';

// Click a native Electron menu item
await clickMenuItem(app, 'File', 'Open');
await clickMenuItem(app, 'File', 'Close');

// Mock the native file open dialog to return a specific mock file
await mockOpenDialog(app, 'bi2.json');
```

## Available mock files (`e2e/mocks/`)

| File | Type | Content |
|------|------|---------|
| `bi2.json` | `.khj` (visualization) | Banking dataset |
| `iris2d.json` | `.khj` (visualization) | Iris 2D dataset |
| `adult2var.json` | `.khj` (visualization) | Adult dataset with external data |
| `check-ext-datas-e2e.json` | `.khj` | File with saved external data |
| `ExternalDataEducation.txt` | TXT | External data file for import |

For covisualization tests, use `.khcj` files if they exist, or ask the user to provide one.

## Key Angular component selectors

| Selector | Description |
|----------|-------------|
| `app-root` | Root application component |
| `app-welcome` | Welcome/home screen |
| `app-recently-opened-files` | Recent files panel |
| `khiops-visualization` | Visualization web component |
| `khiops-covisualization` | Covisualization web component |
| `.tab` | Tab element |
| `.tab.active` | Currently active tab |
| `app-external-datas` | External data component |

## Tab-related assertions

```ts
// Check active tab label
const activeTab = firstWindow.locator('.tab.active');
await expect(activeTab).toHaveText(/filename\.json/);

// Count open tabs (one component per tab)
await expect(firstWindow.locator('khiops-visualization')).toHaveCount(2);
```

## Evaluate Electron main process

Use `app.evaluate` to inspect or control the Electron main process:

```ts
// Check window state
const windowState = await app.evaluate(({ BrowserWindow }) => {
  const win = BrowserWindow.getAllWindows()[0];
  return { isVisible: win.isVisible(), isCrashed: win.webContents.isCrashed() };
});

// Read the application menu
const menuItems = await app.evaluate(async ({ Menu }) => {
  const menu = Menu.getApplicationMenu();
  return menu?.items.map((item) => ({
    label: item.label,
    submenu: item.submenu?.items.map((s) => s.label) ?? [],
  })) ?? [];
});
```

## Output

A single ready-to-run `e2e/check-<feature>.spec.ts` file per feature.

If a spec file already exists for the feature, extend it; otherwise create a new one.

No explanation needed.

## File header

Every spec file must start with:

```ts
/*
 * Copyright (c) 2023-2026 Orange. All rights reserved.
 * This software is distributed under the BSD 3-Clause-clear License, the text of which is available
 * at https://spdx.org/licenses/BSD-3-Clause-Clear.html or see the "LICENSE" file for more details.
 */

import { test, expect } from './fixtures/launch-electron';
import { clickMenuItem, mockOpenDialog } from './helpers/electron-menu';
```

## Run commands

```bash
yarn playwright test                      # run all e2e tests
yarn playwright test e2e/check-foo.spec.ts  # run a specific spec
yarn playwright test --ui                 # interactive UI mode
yarn playwright test --debug              # debug mode
```
