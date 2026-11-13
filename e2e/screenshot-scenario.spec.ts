import * as path from 'path';
import { test } from './fixtures/launch-electron';
import { runScreenshotScenario } from './helpers/screenshot-scenario';
import { screenshotWindowSize } from './screenshot-playwright.config';

const scenarios = process.env.SCREENSHOT_SCENARIO
  ? [process.env.SCREENSHOT_SCENARIO]
  : [
      'e2e/scenarios/covisualization/covisualization.txt',
      // 'e2e/scenarios/covisualization/covisualization-2.txt',
      // 'e2e/scenarios/common/screenshots.txt',
      // 'e2e/scenarios/visualization/descriptive-analysis.txt',
      // 'e2e/scenarios/visualization/supervised-analysis.txt',
      // 'e2e/scenarios/visualization/elements.txt',
      // 'e2e/scenarios/visualization/histograms.txt',
      // 'e2e/scenarios/visualization/regression-analysis.txt',
    ];

test.describe('Screenshot scenario', () => {
  test.describe.configure({ timeout: 180000 });
  test.afterEach(async ({ firstWindow }, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) {
      await firstWindow.screenshot({
        path: testInfo.outputPath('failure.png'),
      });
    }
  });

  for (const scenario of scenarios) {
    test(`Generate screenshots: ${path.basename(scenario)}`, async ({
      app,
      firstWindow,
    }) => {
      const output = path.resolve(
        process.env.SCREENSHOT_OUTPUT || 'e2e/screenshots',
      );
      await runScreenshotScenario(
        app,
        firstWindow,
        path.resolve(scenario),
        output,
        screenshotWindowSize,
      );
    });
  }
});
