import * as path from 'path';
import { expect, test } from './fixtures/launch-electron';
import { parseScreenshotScenario, runScreenshotScenario } from './helpers/screenshot-scenario';
import { screenshotWindowSize } from './screenshot-playwright.config';

const scenarios = process.env.SCREENSHOT_SCENARIO
  ? [process.env.SCREENSHOT_SCENARIO]
  : [
      'e2e/scenarios/screenshots.txt',
      'e2e/scenarios/visualization-descriptive-analysis.txt',
      'e2e/scenarios/visualization-supervised-analysis.txt',
      'e2e/scenarios/visualization-elements.txt',
      'e2e/scenarios/visualization-histograms.txt',
      'e2e/scenarios/visualization-regression-analysis.txt',
    ];

test('Parse screenshot filenames', () => {
  const commands = parseScreenshotScenario(
    'screenshot "images-khiops-guides/visualization/images/Visualization Adult Evaluation.png"\nscreenshot "images-khiops-guides/visualization/images\\nested\\plot.png"\nscreenshot legacy.png\nscreenshot',
  );
  expect(commands.map((command) => command.argument)).toEqual([
    'images-khiops-guides/visualization/images/Visualization Adult Evaluation.png',
    'images-khiops-guides/visualization/images\\nested\\plot.png',
    'legacy.png',
    '',
  ]);
});

test('Reject invalid screenshot filenames', () => {
  for (const filename of ['"../outside.png"', '"images\\..\\outside.png"', '"images/.. /outside.png"', '"/outside.png"', '"C:\\outside.png"', '"missing-quote.png', '"file.png" extra']) {
    expect(() => parseScreenshotScenario(`screenshot ${filename}`)).toThrow(/Line 1/);
    expect(() => parseScreenshotScenario(`shotElt #app-histogram ${filename}`)).toThrow(/Line 1/);
  }
});

test('Parse element screenshot paths', () => {
  const commands = parseScreenshotScenario(
    'shotElt #app-histogram "images-khiops-guides/Capital Loss.png"\nshotElt .chart "images\\nested\\plot.png"\nshotElt #chart legacy.png',
  );
  expect(commands.map((command) => command.argument)).toEqual([
    '#app-histogram images-khiops-guides/Capital Loss.png',
    '.chart images\\nested\\plot.png',
    '#chart legacy.png',
  ]);
});

test('Require prefixes for ID references', () => {
  const commands = [
    ['frame', 'target', '#target'],
    ['annotation', 'target text', '#target text'],
    ['clickElt', 'target', '#target'],
    ['hideElt', 'target', '#target'],
    ['removeElt', 'target', '#target'],
    ['shotElt', 'target image.png', '#target image.png'],
    ['clickRow', 'table row', '#table row'],
    ['clickChart', 'chart 0', '#chart 0'],
    ['resizeSplit', 'split 50 50', '#split 50 50'],
  ];
  for (const [command, invalid, valid] of commands) {
    expect(() => parseScreenshotScenario(`${command} ${invalid}`)).toThrow(/Line 1/);
    expect(parseScreenshotScenario(`${command} ${valid}`)).toHaveLength(1);
  }
  for (const command of ['frame .target', 'annotation .target text', 'clickElt .target',
    'hideElt .target', 'removeElt .target', 'shotElt .target image.png', 'clickRow row']) {
    expect(parseScreenshotScenario(command)).toHaveLength(1);
  }
});

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
