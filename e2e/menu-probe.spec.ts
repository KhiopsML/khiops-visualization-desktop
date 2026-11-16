import { promises as fs } from 'fs';
import * as path from 'path';
import { screenshotTest as test } from './fixtures/launch-electron';
import { runScreenshotScenario } from './helpers/screenshot-scenario';

test('probe menu geometry', async ({ app, firstWindow }, testInfo) => {
  const scenario = testInfo.outputPath('probe.txt');
  await fs.writeFile(scenario, 'fileOpen e2e/mocks/src-screenshots/Covisualization/1-Adult2varsEducationOccupation.khcj\nzoomOut\nopenMenu\nscreenshot "full.png"');
  await runScreenshotScenario(app, firstWindow, scenario, testInfo.outputPath('output'));
  console.log('MENU', await firstWindow.locator('.cet-menubar-menu-container').evaluateAll((elements) => elements.map((e) => ({
    html: e.outerHTML.slice(0, 1000), rect: e.getBoundingClientRect().toJSON(),
    text: e.textContent?.slice(0, 500),
  }))));
  console.log('ITEM', await firstWindow.getByText('Save current hierarchy as', { exact: true }).evaluate((e) => ({
    html: e.parentElement?.outerHTML, rect: e.parentElement?.getBoundingClientRect().toJSON(),
  })));
  console.log('VIEWPORT', await firstWindow.evaluate(() => ({ innerWidth, innerHeight, devicePixelRatio })), await firstWindow.locator('.cet-menubar-menu-container:visible').first().boundingBox());
  const cdp = await firstWindow.context().newCDPSession(firstWindow);
  const image = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 29, y: 25, width: 762, height: 680, scale: 1 }, captureBeyondViewport: true });
  await fs.writeFile(testInfo.outputPath('cdp.png'), Buffer.from(image.data, 'base64'));
  const image2 = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 29, y: 25, width: 762, height: 680, scale: 1 }, captureBeyondViewport: false });
  await fs.writeFile(testInfo.outputPath('cdp-viewport.png'), Buffer.from(image2.data, 'base64'));
  await cdp.detach();
});
