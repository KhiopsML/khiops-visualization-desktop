/*
 * Copyright (c) 2023-2026 Orange. All rights reserved.
 * This software is distributed under the BSD 3-Clause-clear License, the text of which is available
 * at https://spdx.org/licenses/BSD-3-Clause-Clear.html or see the "LICENSE" file for more details.
 */

import { test, expect } from './fixtures/launch-electron';
import * as PATH from 'path';
import {
  openFileInWindow,
  waitForSaveDialog,
  clickSaveDialogButton,
} from './helpers/electron-menu';

test.afterEach(async ({ app }) => {
  const closed = app.waitForEvent('close');
  // Avoid the Electron quit path hanging after the test has closed its tab.
  app.process().kill('SIGKILL');
  await closed;
});

test('preserves an excluded manual fold and folds both dimensions when checked again', async ({
  app,
  firstWindow,
}) => {
  test.setTimeout(60_000);

  await openFileInWindow(
    app,
    firstWindow,
    PATH.join(__dirname, 'mocks', 'adult2var.json'),
  );

  const covisualization = firstWindow.locator('khiops-covisualization');
  const firstTree = covisualization.locator('#tree_0');
  const secondTree = covisualization.locator('#tree_1');
  await expect(firstTree).toBeVisible({ timeout: 15_000 });
  await expect(secondTree).toBeVisible();

  const branch = firstTree
    .locator('.tree-leaf-content[data-item*=\'"name":"A3"\']')
    .locator('..');
  const expando = branch.locator(':scope > .tree-leaf-content > .tree-expando');
  const children = branch.locator(':scope > .tree-child-leaves');
  await expect(expando).toBeVisible();
  await expect(expando).toHaveClass(/expanded/);
  await expect(children.locator('.tree-leaf:visible').first()).toBeVisible();

  await expando.click();
  await expect(expando).not.toHaveClass(/expanded/);
  await expect(children).toBeHidden();
  const manuallyFoldedLabels = await firstTree
    .locator('.tree-leaf-text:visible')
    .allTextContents();
  expect(manuallyFoldedLabels.length).toBeGreaterThan(1);

  const unfoldButton = covisualization.locator('.button-unfold-hierarchy');
  const dialog = firstWindow.locator('#unfold-hierarchy-comp');
  const firstDimensionCheckbox = dialog
    .locator('.ag-row')
    .filter({ hasText: 'occupation' })
    .getByRole('checkbox');
  const slider = dialog.locator('input[type="range"]');
  const confirmButton = dialog.locator('.button-confirm-hierarchy');

  await unfoldButton.click();
  await expect(dialog).toBeVisible();
  await expect(firstDimensionCheckbox).toBeChecked();
  await firstDimensionCheckbox.uncheck();
  const previousRank = Number(await slider.inputValue());
  await dialog.locator('.button-reduce-hierarchy').click();
  await expect(slider).toHaveValue(String(previousRank - 1));
  await confirmButton.click();

  await expect(dialog).toBeHidden();
  await expect(expando).toBeVisible();
  await expect(expando).not.toHaveClass(/expanded/);
  await expect(children).toBeHidden();
  await expect(firstTree.locator('.tree-leaf-text:visible')).toHaveText(
    manuallyFoldedLabels,
  );

  await unfoldButton.click();
  await expect(dialog).toBeVisible();
  await expect(firstDimensionCheckbox).not.toBeChecked();
  await firstDimensionCheckbox.check();
  await expect(dialog.getByRole('checkbox')).toHaveCount(2);
  for (const checkbox of await dialog.getByRole('checkbox').all()) {
    await expect(checkbox).toBeChecked();
  }
  await slider.press('Home');
  await expect(slider).toHaveValue('2');
  await confirmButton.click();

  await expect(dialog).toBeHidden();
  for (const tree of [firstTree, secondTree]) {
    await expect(tree.locator('.tree-leaf:visible')).toHaveCount(1);
    const root = tree.locator(':scope > .tree-leaf');
    await expect(
      root.locator(':scope > .tree-leaf-content > .tree-expando'),
    ).not.toHaveClass(/expanded/);
    await expect(root.locator(':scope > .tree-child-leaves')).toBeHidden();
  }

  await firstWindow.locator('.tab.active .tab-close').click();
  await waitForSaveDialog(firstWindow);
  await clickSaveDialogButton(firstWindow, 'no');
  await expect(covisualization).toHaveCount(0);
});
