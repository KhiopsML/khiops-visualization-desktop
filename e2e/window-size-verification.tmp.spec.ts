import * as path from 'path';
import { test, expect } from './fixtures/launch-electron';
import { runScreenshotScenario } from './helpers/screenshot-scenario';
import { screenshotWindowSize } from './screenshot-playwright.config';

test('applies configured screenshot window size', async ({ app, firstWindow }, testInfo) => {
  await runScreenshotScenario(app, firstWindow, path.resolve('e2e/scenarios/window-size-verification.tmp.txt'), testInfo.outputPath(), screenshotWindowSize);
  const size = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getSize());
  expect(size).toEqual([screenshotWindowSize.width, screenshotWindowSize.height]);
});