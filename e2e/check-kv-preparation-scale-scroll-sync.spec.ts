/*
 * Copyright (c) 2023-2026 Orange. All rights reserved.
 * This software is distributed under the BSD 3-Clause-clear License, the text of which is available
 * at https://spdx.org/licenses/BSD-3-Clause-Clear.html or see the "LICENSE" file for more details.
 */
// @ts-nocheck

import * as PATH from 'path';
import { Locator } from '@playwright/test';
import { test, expect } from './fixtures/launch-electron';
import { clickMenuItem, mockOpenDialogAbsolute } from './helpers/electron-menu';

async function getScrollableMetrics(scroller: Locator): Promise<{
  scrollLeft: number;
  clientWidth: number;
  scrollWidth: number;
}> {
  return scroller.evaluate((node: HTMLElement) => ({
    scrollLeft: node.scrollLeft,
    clientWidth: node.clientWidth,
    scrollWidth: node.scrollWidth,
  }));
}

test.afterEach(async ({ firstWindow }, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    await firstWindow.screenshot({
      path: `test-results/${testInfo.title}-manual.png`,
      fullPage: true,
    });
  }
});

test.describe('KV preparation graph scale and scroll sync', () => {
  test('Scale increase shows horizontal scroll and syncs both charts', async ({
    app,
    firstWindow,
  }) => {
    await firstWindow.waitForLoadState('networkidle');

    const kvFilePath = PATH.resolve(
      __dirname,
      '../../visualization-component/src/assets/mocks/kv/C100_AllReports.json',
    );

    await mockOpenDialogAbsolute(app, kvFilePath);
    await clickMenuItem(app, 'File', 'Open');

    await expect(firstWindow.locator('khiops-visualization')).toBeVisible({
      timeout: 30000,
    });

    const preparationTab = firstWindow.getByRole('tab', {
      name: /^Preparation$/i,
    });
    await preparationTab.click();

    const preparationVars = firstWindow.locator('#preparation-variables-list');
    await expect(preparationVars).toBeVisible({ timeout: 20000 });

    // Ensure a variable is selected to render both graphs.
    const selectedRows = preparationVars.locator('.ag-row-selected');
    if ((await selectedRows.count()) === 0) {
      await preparationVars.locator('.ag-row').first().click({ force: true });
    }

    const distributionCanvas = firstWindow.locator('#distribution-chart-0');
    const targetDistributionCanvas = firstWindow.locator(
      '#target-distribution-chart-0',
    );

    await expect(distributionCanvas).toBeVisible({ timeout: 20000 });
    await expect(targetDistributionCanvas).toBeVisible({ timeout: 20000 });

    const scaleSliderInput = firstWindow.locator(
      'mat-slider[aria-label="Update graph scale"] input[type="range"]',
    );
    await expect(scaleSliderInput.first()).toBeVisible({ timeout: 10000 });

    await scaleSliderInput.first().evaluate((el: HTMLInputElement) => {
      el.value = '400';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const distributionScroller = firstWindow.locator(
      '#distribution-graph0 .chart-comp',
    );
    const targetScroller = firstWindow.locator(
      '#target-distribution-graph0 .chart-comp',
    );

    await expect(distributionScroller).toBeVisible();
    await expect(targetScroller).toBeVisible();

    await expect
      .poll(async () => {
        const d = await getScrollableMetrics(distributionScroller);
        const t = await getScrollableMetrics(targetScroller);
        return d.scrollWidth > d.clientWidth && t.scrollWidth > t.clientWidth;
      }, {
        timeout: 10000,
        message:
          'Both preparation charts should become horizontally scrollable after scale change',
      })
      .toBe(true);

    await distributionScroller.evaluate((node: HTMLElement) => {
      node.scrollLeft = 600;
      node.dispatchEvent(new Event('scroll', { bubbles: true }));
    });

    await expect
      .poll(async () => {
        const d = await getScrollableMetrics(distributionScroller);
        const t = await getScrollableMetrics(targetScroller);
        return {
          distributionScroll: d.scrollLeft,
          targetScroll: t.scrollLeft,
          delta: Math.abs(d.scrollLeft - t.scrollLeft),
        };
      }, {
        timeout: 10000,
        message: 'Horizontal scroll should sync from distribution graph to target graph',
      })
      .toMatchObject({
        distributionScroll: expect.any(Number),
        targetScroll: expect.any(Number),
        delta: expect.any(Number),
      });

    await expect
      .poll(async () => {
        const d = await getScrollableMetrics(distributionScroller);
        const t = await getScrollableMetrics(targetScroller);
        return Math.abs(d.scrollLeft - t.scrollLeft);
      }, { timeout: 10000 })
      .toBeLessThanOrEqual(2);

    await targetScroller.evaluate((node: HTMLElement) => {
      node.scrollLeft = 950;
      node.dispatchEvent(new Event('scroll', { bubbles: true }));
    });

    await expect
      .poll(async () => {
        const d = await getScrollableMetrics(distributionScroller);
        const t = await getScrollableMetrics(targetScroller);
        return Math.abs(d.scrollLeft - t.scrollLeft);
      }, {
        timeout: 10000,
        message: 'Horizontal scroll should sync from target graph to distribution graph',
      })
      .toBeLessThanOrEqual(2);
  });
});
