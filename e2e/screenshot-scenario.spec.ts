import { readdirSync } from 'fs';
import * as path from 'path';
import { screenshotTest as test } from './fixtures/launch-electron';
import { runScreenshotScenario } from './helpers/screenshot-scenario';

function findScenarios(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return findScenarios(entryPath);
      return entry.isFile() && entry.name.endsWith('.txt') ? [entryPath] : [];
    });
}

const scenarios = process.env.SCREENSHOT_SCENARIO
  ? [process.env.SCREENSHOT_SCENARIO]
  : findScenarios(path.join('e2e', 'scenarios'));

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
    test(`Generate screenshots: ${scenario}`, async ({ app, firstWindow }) => {
      const output = path.resolve(
        process.env.SCREENSHOT_OUTPUT || 'e2e/screenshots',
      );
      await runScreenshotScenario(
        app,
        firstWindow,
        path.resolve(scenario),
        output,
      );
    });
  }
});
