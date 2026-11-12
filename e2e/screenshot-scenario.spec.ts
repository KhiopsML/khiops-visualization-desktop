import * as path from 'path';
import { test } from './fixtures/launch-electron';
import { runScreenshotScenario } from './helpers/screenshot-scenario';
import { screenshotWindowSize } from './screenshot-playwright.config';

test.describe('Screenshot scenario', () => {
  test.describe.configure({ timeout: 180000 });
  test.afterEach(async ({ firstWindow }, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) {
      await firstWindow.screenshot({ path: testInfo.outputPath('failure.png') });
    }
  });

  test('Generate screenshots', async ({ app, firstWindow }) => {
    // const scenario = path.resolve(process.env.SCREENSHOT_SCENARIO || 'e2e/scenarios/visualization-descriptive-analysis.txt');
    // const scenario = path.resolve(process.env.SCREENSHOT_SCENARIO || 'e2e/scenarios/visualization-supervised-analysis.txt');
    // const scenario = path.resolve(process.env.SCREENSHOT_SCENARIO || 'e2e/scenarios/visualization-elements.txt');
    const scenario = path.resolve(process.env.SCREENSHOT_SCENARIO || 'e2e/scenarios/histograms.txt');
    const output = path.resolve(process.env.SCREENSHOT_OUTPUT || 'e2e/screenshots');
    await runScreenshotScenario(app, firstWindow, scenario, output, screenshotWindowSize);
  });
});