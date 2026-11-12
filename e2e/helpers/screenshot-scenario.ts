import { promises as fs } from 'fs';
import { randomUUID } from 'crypto';
import * as path from 'path';
import { ElectronApplication, Locator, Page } from 'playwright';
import { expect } from '../fixtures/launch-electron';
import { clickMenuItem, mockOpenDialogAbsolute } from './electron-menu';

const ANNOTATION_COLOR = '#f59e0b';
// const ANNOTATION_OVERLAY_COLOR = 'rgba(245, 158, 11, 0.04)';
const ANNOTATION_OVERLAY_COLOR = 'rgba(245, 158, 11, 0)';
const ANNOTATION_FONT_SIZE = 14;

export type ScreenshotCommand = {
  name: 'fileOpen' | 'openTab' | 'clickRow' | 'clickElt' | 'hideElt' | 'removeElt' | 'firstPlan' | 'clickChart' | 'zoomOut' | 'zoomIn' | 'refreshDom' | 'resizeSplit' | 'wait' | 'frame' | 'annotation' | 'input' | 'unfocus' | 'screenshot' | 'shotElt';
  argument: string;
  line: number;
};

async function writeScreenshot(filePath: string, screenshot: Buffer): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  await fs.writeFile(temporaryPath, screenshot, { flag: 'wx' });
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        await fs.rename(temporaryPath, filePath);
        break;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (attempt >= 19 || !['EACCES', 'EBUSY', 'EPERM', 'UNKNOWN'].includes(code || '')) throw error;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }
}

function parseScreenshotFilename(argument: string, line: number, command: string): string {
  const quoted = /^"((?:[\w. -]+[\\/])*[\w. -]+\.png)"$/i.exec(argument);
  if (quoted && quoted[1].split(/[\\/]/).slice(0, -1).every((part) => /[\w-]$/.test(part))) {
    return quoted[1];
  }
  if (/^[\w.-]+\.png$/i.test(argument)) return argument;
  throw new Error(`Line ${line}: ${command} requires a quoted relative PNG path without parent directories`);
}

type FramePadding = { top: number; right: number; bottom: number; left: number };

// Converts "#id" or ".class" segments, chained with ">", into a CSS selector.
function toCssSelector(selector: string): string {
  return selector.split('>')
    .map((part) => part.startsWith('.') ? `[class~=${JSON.stringify(part.slice(1))}]` : `[id=${JSON.stringify(part.slice(1))}]`)
    .join(' > ');
}

// Chromium screenshot clips use zoomed coordinates, unlike Playwright's element bounds.
async function captureCssRect(page: Page, rect: { x: number; y: number; width: number; height: number }, zoomFactor: number): Promise<Buffer> {
  const scroll = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
  const x = Math.floor((rect.x + scroll.x) * zoomFactor);
  const y = Math.floor((rect.y + scroll.y) * zoomFactor);
  const clip = {
    x, y,
    width: Math.ceil((rect.x + scroll.x + rect.width) * zoomFactor) - x,
    height: Math.ceil((rect.y + scroll.y + rect.height) * zoomFactor) - y,
    scale: 1,
  };
  const session = await page.context().newCDPSession(page);
  try {
    const image = await session.send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: true });
    return Buffer.from(image.data, 'base64');
  } finally {
    await session.detach();
  }
}

function parseFrameArgument(argument: string, line: number): {
  selector: string; card: boolean; noId: boolean; padding: FramePadding; occurrence?: number;
} {
  let selector = argument;
  let card = false;
  let noId = false;
  let padding: FramePadding | undefined;
  let occurrence: number | undefined;
  while (true) {
    const paddingOption = /^(.*?)\s+\{([^{}]*)\}$/.exec(selector);
    if (paddingOption) {
      const declaration = /^\s*padding\s*:\s*(.*?)\s*;?\s*$/i.exec(paddingOption[2]);
      const values = declaration?.[1].replace(/;$/, '').trim().split(/\s+/);
      if (padding || !values || values.length < 1 || values.length > 4 ||
          values.some((value) => !/^(?:\d+(?:\.\d+)?|\.\d+)px$/i.test(value) || !Number.isFinite(parseFloat(value)))) {
        throw new Error(`Line ${line}: frame padding requires one to four non-negative pixel values`);
      }
      const numbers = values.map((value) => parseFloat(value));
      padding = {
        top: numbers[0], right: numbers[1] ?? numbers[0],
        bottom: numbers[2] ?? numbers[0], left: numbers[3] ?? numbers[1] ?? numbers[0],
      };
      selector = paddingOption[1];
      continue;
    }
    const suffix = /^(.*?)\s+(\S+)$/.exec(selector);
    if (!suffix) break;
    if (suffix[2] === 'card' || suffix[2] === 'noId') {
      if (suffix[2] === 'card' ? card : noId) throw new Error(`Line ${line}: duplicate frame option ${suffix[2]}`);
      if (suffix[2] === 'card') card = true;
      else noId = true;
    } else if (/^[+-]?\d/.test(suffix[2])) {
      if (occurrence !== undefined || !/^[1-9]\d*$/.test(suffix[2]) || !Number.isSafeInteger(Number(suffix[2]))) {
        throw new Error(`Line ${line}: frame occurrence must be a positive integer`);
      }
      occurrence = Number(suffix[2]);
    } else {
      break;
    }
    selector = suffix[1];
  }
  if (/\s+\{/.test(selector)) throw new Error(`Line ${line}: invalid frame padding`);
  return { selector, card, noId, padding: padding || { top: 0, right: 0, bottom: 0, left: 0 }, occurrence };
}

function parseAnnotationArgument(argument: string, line: number): { selector: string; text: string } {
  const annotation = /^(\S+)\s+"((?:[^"\\]|\\.)+)"$/.exec(argument);
  if (!annotation || /^[\w-]+$/.test(annotation[1]) || !/\S/.test(annotation[2])) {
    throw new Error(`Line ${line}: annotation requires a selector and quoted text; IDs must start with #`);
  }
  return {
    selector: annotation[1],
    text: annotation[2].replace(/\\(n|")/g, (_match, escaped: string) => escaped === 'n' ? '\n' : '"'),
  };
}

export function parseScreenshotScenario(source: string): ScreenshotCommand[] {
  const commands: ScreenshotCommand[] = [];
  for (const [index, rawLine] of source.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const match = /^(\S+)(?:\s+(.+))?$/.exec(line);
    const name = match![1];
    let argument = (match![2] || '').trim();
    if (!['fileOpen', 'openTab', 'clickRow', 'clickElt', 'hideElt', 'removeElt', 'firstPlan', 'clickChart', 'zoomOut', 'zoomIn', 'refreshDom', 'resizeSplit',     'wait', 'frame', 'annotation', 'input', 'unfocus', 'screenshot', 'shotElt'].includes(name)) {
      throw new Error(`Line ${index + 1}: unknown command "${name}"`);
    }
        if (name !== 'screenshot' && name !== 'zoomOut' && name !== 'zoomIn' && name !== 'refreshDom' && name !== 'unfocus' && !argument) {
      throw new Error(`Line ${index + 1}: ${name} requires an argument`);
    }
        if ((name === 'zoomOut' || name === 'zoomIn' || name === 'refreshDom' || name === 'unfocus') && argument) {
      throw new Error(`Line ${index + 1}: ${name} does not take an argument`);
    }
    if (name === 'wait' && (!/^\d+$/.test(argument) || Number(argument) > 2147483647)) {
      throw new Error(`Line ${index + 1}: wait requires a non-negative integer duration in milliseconds`);
    }
    if (name === 'annotation') {
      const { selector, text } = parseAnnotationArgument(argument, index + 1);
      argument = `${selector} ${text}`;
    }
    if (name === 'input') {
      const input = /^([.#][\w-]+)\s+"((?:[^"\\]|\\.)*)"$/.exec(argument);
      if (!input) {
        throw new Error(`Line ${index + 1}: input requires an ID prefixed with # or a class prefixed with . and quoted text`);
      }
      argument = `${input[1]} ${input[2].replace(/\\(n|")/g, (_match, escaped: string) => escaped === 'n' ? '\n' : '"')}`;
    }
    if (name === 'frame') parseFrameArgument(argument, index + 1);
    if (name === 'clickRow' && /\s/.test(argument) && !/^#[\w-]+\s+\S/.test(argument)) {
      throw new Error(`Line ${index + 1}: clickRow table IDs must start with #`);
    }
    if (name === 'clickElt') {
      const element = /^(#[\w-]+|\.[\w-]+)(?:\s+([1-9]\d*))?$/.exec(argument);
      if (!element || (element[2] && (!element[1].startsWith('.') || !Number.isSafeInteger(Number(element[2]))))) {
        throw new Error(`Line ${index + 1}: clickElt requires an ID prefixed with # or a class prefixed with . and an optional positive occurrence number`);
      }
    }
    if ((name === 'hideElt' || name === 'removeElt' || name === 'firstPlan') && !/^[.#][\w-]+$/.test(argument)) {
      throw new Error(`Line ${index + 1}: ${name} requires an ID prefixed with # or a class prefixed with .`);
    }
    if (name === 'shotElt') {
      const element = /^([.#][\w-]+)\s+(.+?)(?:\s+(\d+)x(\d+))?$/.exec(argument);
      if (!element) {
        throw new Error(`Line ${index + 1}: shotElt requires an ID prefixed with # or a class prefixed with . and a PNG path, optionally followed by WxH`);
      }
      if (element[3] !== undefined && (Number(element[3]) === 0 || Number(element[4]) === 0)) {
        throw new Error(`Line ${index + 1}: shotElt size must be greater than zero`);
      }
      const size = element[3] !== undefined ? ` ${element[3]}x${element[4]}` : '';
      argument = `${element[1]} ${parseScreenshotFilename(element[2], index + 1, name)}${size}`;
    }
    if (name === 'screenshot' && argument) {
      argument = parseScreenshotFilename(argument, index + 1, name);
    }
    if (name === 'clickChart' && !/^#[\w-]+\s+\d+$/.test(argument)) {
      throw new Error(`Line ${index + 1}: clickChart requires a chart ID prefixed with # and a zero-based index`);
    }
    if (name === 'resizeSplit') {
      const match = /^((?:[.#][\w-]+)(?:\s*>\s*[.#][\w-]+)*)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)$/.exec(argument);
      if (!match || Math.abs(Number(match[2]) + Number(match[3]) - 100) > 1e-8) {
        throw new Error(`Line ${index + 1}: resizeSplit requires a split selector (#id or .class, optionally chained with >) and two percentages totaling 100`);
      }
      argument = `${match[1].replace(/\s+/g, '')} ${match[2]} ${match[3]}`;
    }
    commands.push({ name: name as ScreenshotCommand['name'], argument, line: index + 1 });
  }
  return commands;
}

export async function runScreenshotScenario(
  app: ElectronApplication,
  firstWindow: Page,
  scenarioPath: string,
  outputDirectory: string,
  windowSize: { width: number; height: number },
): Promise<void> {
  const commands = parseScreenshotScenario(await fs.readFile(scenarioPath, 'utf8'));
  const projectRoot = path.resolve(__dirname, '../..');
  let frames: { target: Locator; card: boolean; noId: boolean; padding: FramePadding }[] = [];
  let annotations: { target: Locator; text: string }[] = [];
  let screenshotCount = 0;
  let annotationReady = false;

  await fs.mkdir(outputDirectory, { recursive: true });
  await firstWindow.waitForLoadState('networkidle');
  const browserWindow = await app.browserWindow(firstWindow);
  await browserWindow.evaluate((window: any, { width, height }) => {
    window.webContents.setZoomLevel(0);
    window.setSize(width, height);
    window.center();
  }, windowSize);

  for (const command of commands) {
    try {
      switch (command.name) {
        case 'fileOpen': {
          const filePath = path.resolve(projectRoot, command.argument.replace(/[\\/]/g, path.sep));
          await fs.access(filePath);
          const tabTitles = await firstWindow.locator('.tab[title]').evaluateAll((tabs) =>
            tabs.map((tab) => tab.getAttribute('title') || ''),
          );
          const comparablePath = process.platform === 'win32' ? filePath.toLowerCase() : filePath;
          const alreadyOpen = tabTitles.some((title) => {
            const separator = title.indexOf('\n');
            if (separator < 0) return false;
            const tabPath = path.normalize(title.slice(separator + 1));
            return (process.platform === 'win32' ? tabPath.toLowerCase() : tabPath) === comparablePath;
          });
          const toast = firstWindow.locator('.mat-mdc-snack-bar-container:visible').first();
          await toast.waitFor({ state: 'hidden', timeout: 15000 });
          await mockOpenDialogAbsolute(app, filePath);
          await clickMenuItem(app, 'File', 'Open');
          if (!alreadyOpen) await toast.waitFor({ state: 'visible', timeout: 30000 });
          const filename = path.basename(filePath).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          await expect(firstWindow.locator('.tab.active')).toHaveAttribute('title', new RegExp(`^${filename}(?:\\r?\\n|$)`), { timeout: 30000 });
          await expect(firstWindow.locator('khiops-visualization:visible, khiops-covisualization:visible')).toBeVisible({ timeout: 30000 });
          await toast.waitFor({ state: 'hidden', timeout: 15000 });
          break;
        }
        case 'openTab': {
          const activeView = firstWindow.locator('khiops-visualization:visible, khiops-covisualization:visible');
          const tab = activeView.getByRole('tab', { name: command.argument, exact: true });
          await expect(tab).toBeVisible({ timeout: 30000 });
          await tab.click();
          await expect(tab).toHaveAttribute('aria-selected', 'true');
          break;
        }
        case 'zoomOut': {
          await browserWindow.evaluate((window: any) => {
            const webContents = window.webContents;
            webContents.setZoomLevel(webContents.getZoomLevel() - 0.5);
          });
          break;
        }
        case 'zoomIn': {
          await browserWindow.evaluate((window: any) => {
            const webContents = window.webContents;
            webContents.setZoomLevel(webContents.getZoomLevel() + 0.5);
          });
          break;
        }
        case 'refreshDom': {
          const [width, height] = await browserWindow.evaluate((window: any) => window.getSize() as [number, number]);
          const originalViewport = await firstWindow.evaluate(() => [window.innerWidth, window.innerHeight]);
          try {
            await browserWindow.evaluate((window: any, size) => window.setSize(size.width + 32, size.height), { width, height });
            await expect.poll(() => firstWindow.evaluate(() => [window.innerWidth, window.innerHeight]), { timeout: 5000 })
              .not.toEqual(originalViewport);
            await firstWindow.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
          } finally {
            await browserWindow.evaluate((window: any, size) => window.setSize(size.width, size.height), { width, height });
          }
          await expect.poll(() => firstWindow.evaluate(() => [window.innerWidth, window.innerHeight]), { timeout: 5000 })
            .toEqual(originalViewport);
          await firstWindow.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
          break;
        }
        case 'unfocus': {
          await firstWindow.mouse.click(1, 1);
          break;
        }
        case 'wait': {
          await firstWindow.waitForTimeout(Number(command.argument));
          break;
        }
        case 'resizeSplit': {
          const [splitSelector, firstPercentage] = command.argument.split(/\s+/);
          const isClass = splitSelector.split('>').pop()!.startsWith('.');
          const matches = firstWindow.locator('khiops-visualization:visible, khiops-covisualization:visible')
            .locator(toCssSelector(splitSelector)).filter({ visible: true });
          if (!isClass) await expect(matches).toHaveCount(1, { timeout: 30000 });
          const split = matches.first();
          await expect(split).toBeVisible({ timeout: 30000 });
          const vertical = await split.evaluate((element) => element.classList.contains('as-vertical'));
          const horizontal = await split.evaluate((element) => element.classList.contains('as-horizontal'));
          if (!vertical && !horizontal) throw new Error(`resizeSplit ${splitSelector} is not an as-split with a direction`);
          const areas = split.locator(':scope > as-split-area');
          const gutter = split.locator(':scope > .as-split-gutter');
          await expect(areas).toHaveCount(2);
          // Drag along the split's own axis: y for vertical splits, x for horizontal splits.
          const axisSize = vertical ? 'height' : 'width';
          const readFirstPercentage = () => areas.evaluateAll((elements, size) => {
            const sizes = elements.map((element) => element.getBoundingClientRect()[size as 'width' | 'height']);
            return sizes[0] + sizes[1] > 0 ? sizes[0] / (sizes[0] + sizes[1]) * 100 : NaN;
          }, axisSize);
          const requested = Number(firstPercentage);
          const isReached = async () => Math.abs((await readFirstPercentage()) - requested) < 1;
          const waitForRatio = async (timeout: number) => {
            const deadline = Date.now() + timeout;
            while (Date.now() < deadline) {
              if (await isReached()) return true;
              await firstWindow.waitForTimeout(100);
            }
            return isReached();
          };
          if (await isReached()) break;
          // An open Angular CDK menu or dialog leaves a backdrop that blocks the pointer: close it first.
          const openBackdrops = firstWindow.locator('.cdk-overlay-backdrop-showing');
          if (await openBackdrops.count()) {
            await firstWindow.keyboard.press('Escape');
            await expect(openBackdrops).toHaveCount(0, { timeout: 5000 });
          }
          await expect(gutter).toBeAttached();
          const splitBox = await split.boundingBox();
          const gutterBox = await gutter.boundingBox();
          if (!splitBox || !gutterBox) throw new Error('Split has no visible area');
          if (splitBox[axisSize] <= gutterBox[axisSize]) throw new Error('Split has no visible size on its axis');
          const gutterCenterX = gutterBox.x + gutterBox.width / 2;
          const gutterCenterY = gutterBox.y + gutterBox.height / 2;
          // Diagnostic: which element receives pointer events at the gutter centre.
          const gutterHit = await firstWindow.evaluate(([x, y]) => {
            // elementFromPoint stops at shadow hosts, so descend into their shadow roots.
            let element: Element | null = document.elementFromPoint(x, y);
            while (element?.shadowRoot) {
              const inner: Element | null = element.shadowRoot.elementFromPoint(x, y);
              if (!inner || inner === element) break;
              element = inner;
            }
            if (!element) return 'none';
            const classes = String(element.getAttribute('class') ?? '').trim().split(/\s+/).filter(Boolean).join('.');
            return `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}${classes ? `.${classes}` : ''}`;
          }, [gutterCenterX, gutterCenterY] as [number, number]);
          const targetOffset = (splitBox[axisSize] - gutterBox[axisSize]) * requested / 100 + gutterBox[axisSize] / 2;
          const targetX = vertical ? gutterCenterX : splitBox.x + targetOffset;
          const targetY = vertical ? splitBox.y + targetOffset : gutterCenterY;
          // First try a real mouse drag.
          await firstWindow.mouse.move(gutterCenterX, gutterCenterY);
          await firstWindow.mouse.down();
          try {
            await firstWindow.mouse.move(targetX, targetY, { steps: 10 });
          } finally {
            await firstWindow.mouse.up();
          }
          // Fallback: dispatch the drag events directly, in case the mouse hit-test landed on another element.
          if (!(await waitForRatio(3000))) {
            await gutter.evaluate((element, { startX, startY, endX, endY }) => {
              const fire = (target: EventTarget, type: string, x: number, y: number, buttons: number) =>
                target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons }));
              fire(element, 'mousedown', startX, startY, 1);
              fire(document, 'mousemove', endX, endY, 1);
              fire(document, 'mouseup', endX, endY, 0);
            }, { startX: gutterCenterX, startY: gutterCenterY, endX: targetX, endY: targetY });
          }
          if (!(await waitForRatio(30000))) {
            const current = await readFirstPercentage();
            throw new Error(`Split ${splitSelector} could not reach ${requested}/${100 - requested}: current first area is ${current.toFixed(1)}% (pointer hit-test at gutter: ${gutterHit})`);
          }
          break;
        }

        case 'clickRow': {
          const match = /^(\S+)(?:\s+(.+))?$/.exec(command.argument)!;
          const activeView = firstWindow.locator('khiops-visualization:visible, khiops-covisualization:visible');
          const table = match[2] ? activeView.locator(`[id=${JSON.stringify(match[1].replace(/^#/, ''))}]`) : activeView;
          const row = table.getByRole('row').filter({ hasText: match[2] || match[1], visible: true });
          await expect(row).toHaveCount(1, { timeout: 30000 });
          await row.click();
          break;
        }
        case 'clickElt': {
          const [elementSelector, occurrence] = command.argument.split(/\s+/);
          const isClass = elementSelector.startsWith('.');
          const value = elementSelector.slice(1);
          const selector = `[${isClass ? 'class~' : 'id'}=${JSON.stringify(value)}]`;
          const index = occurrence ? Number(occurrence) - 1 : 0;
          const matches = firstWindow.locator('khiops-visualization:visible, khiops-covisualization:visible').locator(selector);
          const visibleMatches = matches.filter({ visible: true });
          await expect.poll(async () => (await visibleMatches.count()) > index || (await matches.count()) > index,
            { timeout: 30000 }).toBe(true);
          if ((await visibleMatches.count()) > index) {
            // Fall back to a DOM click when another element covers the target and blocks the pointer click.
            await visibleMatches.nth(index).click({ timeout: 3000 }).catch(() =>
              visibleMatches.nth(index).evaluate((element) => (element as HTMLElement).click()));
          } else {
            await matches.nth(index).evaluate((element) => (element as HTMLElement).click());
          }
          break;
        }
        case 'firstPlan': {
          const isClass = command.argument.startsWith('.');
          const value = command.argument.slice(1);
          const selector = `[${isClass ? 'class~' : 'id'}=${JSON.stringify(value)}]`;
          const targets = firstWindow.locator('khiops-visualization:visible, khiops-covisualization:visible')
            .locator(selector).filter({ visible: true });
          if (!isClass) await expect(targets).toHaveCount(1, { timeout: 30000 });
          const target = targets.first();
          await expect(target).toBeVisible({ timeout: 30000 });
          await target.evaluate((element) => {
            if (!(element instanceof HTMLElement)) throw new Error('firstPlan requires an HTML element');
            const box = element.getBoundingClientRect();
            if (box.width <= 0 || box.height <= 0) throw new Error('firstPlan target has no visible area');
            if (element.matches(':popover-open')) {
              element.hidePopover();
            } else {
              const style = getComputedStyle(element);
              if (style.position !== 'absolute' && style.position !== 'fixed') {
                const placeholder = document.createElement('span');
                placeholder.setAttribute('aria-hidden', 'true');
                for (const [property, value] of Object.entries({
                  display: style.display === 'inline' ? 'inline-block' : style.display,
                  width: `${box.width}px`, height: `${box.height}px`, 'box-sizing': 'border-box',
                  margin: style.margin, flex: style.flex, order: style.order,
                  'align-self': style.alignSelf, 'vertical-align': style.verticalAlign,
                  'grid-area': style.gridArea, visibility: 'hidden', 'pointer-events': 'none',
                })) {
                  placeholder.style.setProperty(property, value, 'important');
                }
                element.before(placeholder);
              }
            }
            element.setAttribute('popover', 'manual');
            for (const [property, value] of Object.entries({
              position: 'fixed', inset: 'auto', top: `${box.top}px`, left: `${box.left}px`,
              width: `${box.width}px`, height: `${box.height}px`, margin: '0',
              'max-width': 'none', 'max-height': 'none', 'box-sizing': 'border-box',
              background: 'white',
            })) {
              element.style.setProperty(property, value, 'important');
            }
            element.showPopover();
          });
          break;
        }
        case 'hideElt': {
          const isClass = command.argument.startsWith('.');
          const value = command.argument.replace(/^[.#]/, '');
          const selector = `[${isClass ? 'class~' : 'id'}=${JSON.stringify(value)}]`;
          const targets = firstWindow.locator(selector).filter({ visible: true });
          await expect(targets.first()).toBeVisible({ timeout: 30000 });
          await targets.evaluateAll((elements) => {
            for (const element of elements) (element as HTMLElement).style.setProperty('display', 'none', 'important');
          });
          break;
        }
        case 'removeElt': {
          const isClass = command.argument.startsWith('.');
          const value = command.argument.replace(/^[.#]/, '');
          const selector = `[${isClass ? 'class~' : 'id'}=${JSON.stringify(value)}]`;
          const targets = firstWindow.locator(selector);
          await expect(targets.first()).toBeAttached({ timeout: 30000 });
          await targets.evaluateAll((elements) => {
            for (const element of elements) {
              const parent = element.parentElement;
              const area = element.matches('as-split-area') ? element :
                parent?.matches('as-split-area') && parent.children.length === 1 ? parent : null;
              const split = area?.parentElement;
              if (!area || !split?.matches('as-split')) {
                element.remove();
                continue;
              }
              area.remove();
              const remainingAreas = Array.from(split.children).filter((child) => child.matches('as-split-area'));
              if (remainingAreas.length === 1) {
                for (const gutter of split.querySelectorAll(':scope > .as-split-gutter')) gutter.remove();
                (split as HTMLElement).style.setProperty('grid-template', '1fr / 1fr', 'important');
                const remainingArea = remainingAreas[0] as HTMLElement;
                remainingArea.style.setProperty('grid-row', '1', 'important');
                remainingArea.style.setProperty('grid-column', '1', 'important');
              }
            }
          });
          break;
        }
        case 'clickChart': {
          const [chartId, indexArgument] = command.argument.split(/\s+/);
          const index = Number(indexArgument);
          if (!Number.isSafeInteger(index)) throw new Error('Chart index must be a safe integer');
          const canvas = firstWindow.locator('khiops-visualization:visible, khiops-covisualization:visible')
            .locator(`[id=${JSON.stringify(chartId.replace(/^#/, ''))}]`).filter({ visible: true });
          await expect(canvas).toHaveCount(1, { timeout: 30000 });
          await canvas.scrollIntoViewIfNeeded();
          let position: { x: number; y: number } | null = null;
          await expect.poll(async () => {
            position = await canvas.evaluate((element, barIndex) => {
              const chart = (element.closest('kl-chart') as any)?.componentInstance?.chartManagerService?.getChart();
              if (!chart || !chart.width || !chart.height) return null;
              const bar = chart.data.datasets
                .map((_dataset: unknown, datasetIndex: number) => chart.getDatasetMeta(datasetIndex).data[barIndex])
                .find((entry: any) => entry && Math.abs(entry.base - entry.y) > 1);
              if (!bar) return null;
              const bounds = element.getBoundingClientRect();
              return { x: bar.x * bounds.width / chart.width, y: (bar.y + bar.base) / 2 * bounds.height / chart.height };
            }, index);
            return position !== null;
          }, { timeout: 30000, message: `Chart ${chartId} has no visible bar at index ${index}` }).toBe(true);
          await canvas.click({ position: position! });
          await firstWindow.mouse.move(0, 0);
          break;
        }
        case 'input': {
          const separator = command.argument.indexOf(' ');
          const selector = command.argument.slice(0, separator);
          const text = command.argument.slice(separator + 1);
          const isClass = selector.startsWith('.');
          const value = selector.slice(1);
          const target = firstWindow.locator('khiops-visualization:visible, khiops-covisualization:visible')
            .locator(`[${isClass ? 'class~' : 'id'}=${JSON.stringify(value)}]`).filter({ visible: true }).first();
          await expect(target).toBeVisible({ timeout: 30000 });
          const isInput = await target.evaluate((element) => element instanceof HTMLInputElement);
          const input = isInput ? target : target.locator('input').filter({ visible: true }).first();
          await expect(input).toBeVisible({ timeout: 30000 });
          await input.fill(text);
          break;
        }
        case 'frame': {
          const { selector, card, noId, padding, occurrence } = parseFrameArgument(command.argument, command.line);
          const targets = firstWindow.locator('khiops-visualization:visible, khiops-covisualization:visible').locator(selector).filter({ visible: true });
          const target = targets.nth((occurrence || 1) - 1);
          await expect(target).toBeVisible();
          frames.push({ target, card, noId, padding });
          break;
        }
        case 'annotation': {
          const separator = command.argument.indexOf(' ');
          const selector = command.argument.slice(0, separator);
          const text = command.argument.slice(separator + 1);
          const target = firstWindow.locator('khiops-visualization:visible, khiops-covisualization:visible')
            .locator(selector).filter({ visible: true }).first();
          await expect(target).toBeVisible({ timeout: 30000 });
          annotations.push({ target, text });
          break;
        }
        case 'shotElt':
        case 'screenshot': {
          let target: Locator | undefined;
          let filename: string;
          let size: { width: number; height: number } | undefined;
          if (command.name === 'shotElt') {
            const [, elementSelector, elementFilename, sizeWidth, sizeHeight] = /^(\S+)\s+(.+?)(?:\s+(\d+)x(\d+))?$/.exec(command.argument)!;
            size = sizeWidth !== undefined ? { width: Number(sizeWidth), height: Number(sizeHeight) } : undefined;
            const isClass = elementSelector.startsWith('.');
            const value = elementSelector.replace(/^[.#]/, '');
            const selector = `[${isClass ? 'class~' : 'id'}=${JSON.stringify(value)}]`;
            const targets = firstWindow.locator(selector).filter({ visible: true });
            if (!isClass) await expect(targets).toHaveCount(1, { timeout: 30000 });
            target = isClass ? targets.first() : targets;
            await expect(target).toBeVisible({ timeout: 30000 });
            await target.scrollIntoViewIfNeeded();
            filename = elementFilename.replace(/[\\/]/g, path.sep);
          } else {
            filename = command.argument.replace(/[\\/]/g, path.sep) || `screenshot-${String(screenshotCount + 1).padStart(3, '0')}.png`;
            await firstWindow.locator('.mat-mdc-snack-bar-container:visible').first().waitFor({ state: 'hidden', timeout: 15000 });
          }
          if (annotations.length) {
            await firstWindow.mouse.move(0, 0);
            await firstWindow.locator('.mat-mdc-tooltip:visible').first().waitFor({ state: 'hidden', timeout: 5000 });
          }
          if (frames.length) {
            if (!annotationReady) {
              const script = await fs.readFile(require.resolve('@reviewjs/annotate/annotate.js'), 'utf8');
              await firstWindow.addScriptTag({ content: `(function(module, exports) {\n${script}\n})(undefined, undefined);` });
              await firstWindow.evaluate(() => {
                const annotate = (window as any).Annotate;
                annotate.init({ project: 'kvd-screenshot-scenario', startOpen: true });
                annotate.clear();
              });
              await firstWindow.locator('#__an_overlay').evaluate((overlay) => {
                const updateBadges = () => {
                  for (const badge of overlay.querySelectorAll('g > text')) {
                    let number = Number(badge.textContent);
                    if (!Number.isInteger(number) || number < 1) continue;
                    let label = '';
                    while (number > 0) {
                      number--;
                      label = String.fromCharCode(65 + number % 26) + label;
                      number = Math.floor(number / 26);
                    }
                    badge.textContent = label;
                  }
                };
                new MutationObserver(updateBadges).observe(overlay, { childList: true, subtree: true });
                updateBadges();
              });
              await firstWindow.addStyleTag({ content: `
                #__an_host > :not(#__an_overlay):not(#__an_pins) { display: none !important; }
                #__an_overlay rect.an-hit { fill: ${ANNOTATION_OVERLAY_COLOR}; }
              ` });
              annotationReady = true;
            }
            const boxes = await Promise.all(frames.map(async ({ target, card: useCard, padding }) => {
              await expect(target).toBeVisible();
              const card = await target.evaluateHandle((element, useCard) => {
                if (!useCard) return element;
                let current: Element | null = element;
                while (current) {
                  if (current.classList.contains('kl-card')) return current;
                  if (current.parentElement) {
                    current = current.parentElement;
                  } else {
                    const root = current.getRootNode();
                    current = root instanceof ShadowRoot ? root.host : null;
                  }
                }
                return element;
              }, useCard);
              try {
                const box = await card.asElement()!.boundingBox();
                if (!box || box.width <= 0 || box.height <= 0) throw new Error('Annotation target has no visible area');
                return {
                  x: box.x - padding.left, y: box.y - padding.top,
                  width: box.width + padding.left + padding.right,
                  height: box.height + padding.top + padding.bottom,
                };
              } finally {
                await card.dispose();
              }
            }));
            const payload = await firstWindow.evaluate(({ targets, color }) => {
              const body = document.body.getBoundingClientRect();
              const now = new Date().toISOString();
              return {
                comments: targets.map((box, index) => ({
                  id: `screenshot-${Date.now()}-${index}`,
                  type: 'shape', author: 'Screenshot', text: '', color,
                  geom: { kind: 'rect', selector: 'body', x: (box.x - body.left) / body.width,
                    y: (box.y - body.top) / body.height, w: box.width / body.width, h: box.height / body.height,
                    vw: window.innerWidth, vh: window.innerHeight },
                  replies: [], createdAt: now, updatedAt: now,
                })),
              };
            }, { targets: boxes, color: ANNOTATION_COLOR });
            const chooserPromise = firstWindow.waitForEvent('filechooser');
            await firstWindow.evaluate(() => (window as any).Annotate.import());
            const chooser = await chooserPromise;
            await chooser.setFiles({ name: 'annotations.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(payload)) });
            await expect(firstWindow.locator('#__an_overlay rect.an-hit')).toHaveCount(frames.length);
            const badges = firstWindow.locator('#__an_overlay g > text');
            await expect(badges).toHaveCount(frames.length);
            let visibleIndex = 0;
            for (let index = 0; index < frames.length; index++) {
              const badge = badges.nth(index);
              if (frames[index].noId) {
                await badge.locator('..').evaluate((element) => (element as SVGElement).style.setProperty('display', 'none', 'important'));
                await expect(badge).toBeHidden();
              } else {
                let number = ++visibleIndex;
                let label = '';
                while (number > 0) {
                  number--;
                  label = String.fromCharCode(65 + number % 26) + label;
                  number = Math.floor(number / 26);
                }
                await badge.evaluate((element, text) => { element.textContent = text; }, label);
                await expect(badge).toHaveText(label);
              }
            }
          }
          if (annotations.length) {
            const items = await Promise.all(annotations.map(async ({ target, text }) => {
              await expect(target).toBeVisible();
              const box = await target.boundingBox();
              if (!box || box.width <= 0 || box.height <= 0) throw new Error('annotation target has no visible area');
              return { box, text };
            }));
            await firstWindow.evaluate(({ items, color, fontSize }) => {
              const overlay = document.createElement('div');
              overlay.id = '__screenshot_annotations';
              overlay.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
              document.body.appendChild(overlay);
              for (const { box, text } of items) {
                const label = document.createElement('div');
                label.textContent = text;
                label.style.cssText = `position:absolute;max-width:180px;box-sizing:border-box;padding:6px 9px;border-radius:4px;background:${color};box-shadow:0 1px 4px rgba(0,0,0,0.2);white-space:pre-wrap;overflow-wrap:anywhere;font:600 ${fontSize}px/1.35 sans-serif;color:#553300;`;
                const caret = document.createElement('span');
                caret.style.cssText = `position:absolute;left:50%;top:-7px;transform:translateX(-50%);border-left:7px solid transparent;border-right:7px solid transparent;border-bottom:7px solid ${color};`;
                label.appendChild(caret);
                overlay.appendChild(label);
                const labelBox = label.getBoundingClientRect();
                const left = box.x + box.width / 2 - labelBox.width / 2;
                label.style.left = `${Math.max(4, Math.min(window.innerWidth - labelBox.width - 4, left))}px`;
                label.style.top = `${Math.max(11, Math.min(window.innerHeight - labelBox.height - 4, box.y + box.height + 7))}px`;
              }
            }, { items, color: ANNOTATION_COLOR, fontSize: ANNOTATION_FONT_SIZE });
          }
          let screenshot: Buffer;
          if (target) {
            const zoomFactor = await browserWindow.evaluate((window: any) => window.webContents.getZoomFactor() as number);
            const box = await target.boundingBox();
            if (!box || box.width <= 0 || box.height <= 0) throw new Error('Screenshot target has no visible area');
            if (size) {
              const rect = { x: box.x, y: box.y, width: size.width, height: size.height };
              // Playwright clips are exact in CSS pixels at zoom 1; zoomed windows use the CDP clip path.
              screenshot = zoomFactor === 1
                ? await firstWindow.screenshot({ animations: 'disabled', clip: rect })
                : await captureCssRect(firstWindow, rect, zoomFactor);
            } else {
              screenshot = await target.screenshot({ animations: 'disabled' });
              if (zoomFactor !== 1) screenshot = await captureCssRect(firstWindow, box, zoomFactor);
            }
          } else {
            const [width, height] = await browserWindow.evaluate((window: any) => window.getContentSize() as [number, number]);
            screenshot = await firstWindow.screenshot({ animations: 'disabled', clip: { x: 0, y: 0, width, height } });
          }
          await writeScreenshot(path.join(outputDirectory, filename), screenshot);
          screenshotCount++;
          if (annotationReady) await firstWindow.evaluate(() => (window as any).Annotate.clear());
          if (annotations.length) await firstWindow.locator('#__screenshot_annotations').evaluate((overlay) => overlay.remove());
          frames = [];
          annotations = [];
          break;
        }
      }
    } catch (error) {
      throw new Error(`${scenarioPath}:${command.line}: ${command.name} ${command.argument}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (frames.length || annotations.length) throw new Error(`${scenarioPath}: annotations must be followed by a screenshot`);
  if (!screenshotCount) throw new Error(`${scenarioPath}: scenario contains no screenshot`);
}