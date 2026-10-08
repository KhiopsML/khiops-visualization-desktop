/*
 * Copyright (c) 2023-2026 Orange. All rights reserved.
 * This software is distributed under the BSD 3-Clause-clear License, the text of which is available
 * at https://spdx.org/licenses/BSD-3-Clause-Clear.html or see the "LICENSE" file for more details.
 */
// @ts-nocheck

import { Locator, Page } from '@playwright/test';
import * as PATH from 'path';
import { test, expect } from './fixtures/launch-electron';
import { clickMenuItem, mockOpenDialogAbsolute } from './helpers/electron-menu';

const CONTEXT_POSITIONS = [2, 3, 4, 5];

function normalizeText(value: string | null | undefined): string {
  return (value || '').replace(/\s+/g, ' ').trim();
}

async function getCurrentSelectedLeafText(contextContainer: Locator): Promise<string> {
  const selectedLeaf = contextContainer.locator('.tree-selected .tree-leaf-text').first();
  if ((await selectedLeaf.count()) === 0) {
    return '';
  }

  return normalizeText(await selectedLeaf.textContent());
}

async function clickDifferentLeaf(
  contextContainer: Locator,
  forbiddenTexts: Set<string>,
  allowExpandoFallback = false,
): Promise<string> {
  const findAndClickDifferentVisibleLeaf = async (): Promise<string> => {
    const leaves = contextContainer.locator('.tree-leaf-text');
    const count = await leaves.count();

    const maxScan = Math.min(count, 30);
    for (let i = 0; i < maxScan; i += 1) {
      const leaf = leaves.nth(i);
      if (!(await leaf.isVisible())) {
        continue;
      }

      const candidate = normalizeText(await leaf.textContent());
      if (!candidate || forbiddenTexts.has(candidate)) {
        continue;
      }

      await leaf.click({ force: true });
      return candidate;
    }

    return '';
  };

  let selectedLeaf = await findAndClickDifferentVisibleLeaf();
  if (selectedLeaf) {
    return selectedLeaf;
  }

  // If collapsed, expand one branch and retry selecting another leaf.
  const collapsedExpandos = contextContainer.locator(
    '.tree-expando:not(.hidden):not(.expanded)',
  );
  const collapsedCount = await collapsedExpandos.count();
  const maxExpand = Math.min(collapsedCount, 8);

  for (let i = 0; i < maxExpand; i += 1) {
    const expando = collapsedExpandos.nth(i);
    if (!(await expando.isVisible())) {
      continue;
    }

    await expando.click({ force: true });
    selectedLeaf = await findAndClickDifferentVisibleLeaf();
    if (selectedLeaf) {
      return selectedLeaf;
    }
  }

  if (allowExpandoFallback) {
    const visibleExpando = contextContainer
      .locator('.tree-expando:not(.hidden)')
      .first();
    if ((await visibleExpando.count()) > 0) {
      await visibleExpando.click({ force: true });
      return '__expando_toggled__';
    }
  }

  throw new Error(
    'Unable to find a different leaf to click in context tree, even after expanding nodes',
  );
}

async function getMatrixHash(page: Page): Promise<string> {
  const matrix = page.locator('#matrix');
  await expect(matrix).toBeVisible({ timeout: 15000 });

  return matrix.evaluate((node: HTMLCanvasElement) => {
    const ctx = node.getContext('2d');
    if (!ctx || node.width === 0 || node.height === 0) {
      return 'empty';
    }

    const data = ctx.getImageData(0, 0, node.width, node.height).data;
    let hash = 0;

    for (let i = 0; i < data.length; i += 64) {
      hash = (hash * 31 + data[i] + data[i + 1] * 3 + data[i + 2] * 7) >>> 0;
    }

    return `${node.width}x${node.height}:${hash}`;
  });
}

async function getTooltipAtSameMatrixPosition(page: Page): Promise<string> {
  const matrixSelected = page.locator('#matrix-selected');
  await expect(matrixSelected).toBeVisible({ timeout: 15000 });

  await matrixSelected.hover({ position: { x: 12, y: 12 } });

  const tooltip = page.locator('.matrix-tooltip-comp').first();
  await expect(tooltip).toBeVisible({ timeout: 10000 });
  return normalizeText(await tooltip.innerText());
}

async function selectExpandableNode(contextContainer: Locator): Promise<Locator> {
  const expandos = contextContainer.locator('.tree-expando:not(.hidden)');
  const count = await expandos.count();

  expect(count).toBeGreaterThan(0);

  for (let i = 0; i < count; i += 1) {
    const expando = expandos.nth(i);
    const text = expando.locator(
      'xpath=ancestor::*[contains(@class,"tree-leaf-content")][1]//*[contains(@class,"tree-leaf-text")]',
    );

    if ((await text.count()) === 0) {
      continue;
    }

    await text.first().click({ force: true });
    return expando;
  }

  throw new Error('Unable to select an expandable node in context tree');
}

test.afterEach(async ({ firstWindow }, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    await firstWindow.screenshot({
      path: `test-results/${testInfo.title}-manual.png`,
      fullPage: true,
    });
  }
});

test.describe('Context matrix redraw with Coclustering-6', () => {
  test('Matrix updates with context changes and stays stable when expected', async ({
    app,
    firstWindow,
  }) => {
    await firstWindow.waitForLoadState('networkidle');

    const coclustering6Path = PATH.resolve(
      __dirname,
      '../../visualization-component/src/assets/mocks/kc/Coclustering-6.json',
    );

    await mockOpenDialogAbsolute(app, coclustering6Path);
    await clickMenuItem(app, 'File', 'Open');

    await expect(firstWindow.locator('khiops-covisualization')).toBeVisible({
      timeout: 30000,
    });

    const contextTab = firstWindow.getByRole('tab', { name: /context/i });
    await contextTab.click();

    for (const position of CONTEXT_POSITIONS) {
      await expect(
        firstWindow.locator(`#hierarchy-details-comp-${position}`),
      ).toBeVisible({ timeout: 15000 });
    }

    const conditionalCheckbox = firstWindow.getByRole('checkbox', {
      name: /conditional on context/i,
    });
    await expect(conditionalCheckbox).toBeChecked();

    // Conditional ON: changing leaves in context trees must redraw matrix.
    for (const position of CONTEXT_POSITIONS) {
      const contextContainer = firstWindow.locator(
        `#hierarchy-details-comp-${position}`,
      );

      const selectedBefore = await getCurrentSelectedLeafText(contextContainer);
      const matrixHashBefore = await getMatrixHash(firstWindow);
      const tooltipBefore = await getTooltipAtSameMatrixPosition(firstWindow);

      const clickedLeaf = await clickDifferentLeaf(
        contextContainer,
        new Set([selectedBefore]),
      );

      await expect
        .poll(() => getMatrixHash(firstWindow), {
          timeout: 15000,
          message: `Matrix should redraw after changing context leaf in hierarchy-details-comp-${position}`,
        })
        .not.toBe(matrixHashBefore);

      await expect
        .poll(() => getTooltipAtSameMatrixPosition(firstWindow), {
          timeout: 15000,
          message: `Tooltip should change after selecting leaf ${clickedLeaf} in hierarchy-details-comp-${position}`,
        })
        .not.toBe(tooltipBefore);
    }

    // Folding selected context node must not change matrix.
    const context2 = firstWindow.locator('#hierarchy-details-comp-2');
    const expando = await selectExpandableNode(context2);
    const hashBeforeFold = await getMatrixHash(firstWindow);

    await expando.click({ force: true });

    await expect
      .poll(() => getMatrixHash(firstWindow), {
        timeout: 5000,
        message: 'Matrix should stay unchanged when folding selected context node',
      })
      .toBe(hashBeforeFold);

    // Conditional OFF: changing leaves/nodes in context trees must not redraw matrix.
    if (await conditionalCheckbox.isChecked()) {
      await conditionalCheckbox.click({ force: true });
    }
    await expect(conditionalCheckbox).not.toBeChecked();

    for (const position of CONTEXT_POSITIONS) {
      const contextContainer = firstWindow.locator(
        `#hierarchy-details-comp-${position}`,
      );

      const selectedBefore = await getCurrentSelectedLeafText(contextContainer);
      const matrixHashBefore = await getMatrixHash(firstWindow);

      await clickDifferentLeaf(contextContainer, new Set([selectedBefore]), true);

      await expect
        .poll(() => getMatrixHash(firstWindow), {
          timeout: 5000,
          message: `Matrix should not redraw when conditional on context is disabled (hierarchy-details-comp-${position})`,
        })
        .toBe(matrixHashBefore);
    }
  });
});
