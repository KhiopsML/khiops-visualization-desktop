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

type AnnotationPosition = 'top' | 'right' | 'bottom' | 'left';

export type ScreenshotCommand = {
  name: 'fileOpen' | 'openTab' | 'clickRow' | 'clickElt' | 'hover' | 'hideElt' | 'removeElt' | 'firstPlan' | 'clickChart' | 'zoomOut' | 'zoomIn' | 'refreshDom' | 'resizeSplit' | 'wait' | 'frame' | 'annotation' | 'annotationSelectedCell' | 'clean' | 'input' | 'unfocus' | 'setVisibility' | 'screenshot' | 'shotElt';
  argument: string;
  line: number;
  occurrence?: number;
  annotationPosition?: AnnotationPosition;
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
  const quoted = /^"((?:[\w. -]+[\\/])*[\w. -]+\.(?:png|jpe?g))"$/i.exec(argument);
  if (quoted && quoted[1].split(/[\\/]/).slice(0, -1).every((part) => /[\w-]$/.test(part))) {
    return quoted[1];
  }
  if (/^[\w.-]+\.(?:png|jpe?g)$/i.test(argument)) return argument;
  throw new Error(`Line ${line}: ${command} requires a relative PNG or JPEG path without parent directories`);
}

type FramePadding = { top: number; right: number; bottom: number; left: number };

function toElementSelector(selector: string): string {
  if (selector.startsWith('.')) return `[class~=${JSON.stringify(selector.slice(1))}]`;
  if (selector.startsWith('#')) return `[id=${JSON.stringify(selector.slice(1))}]`;
  return selector;
}

function parseSplitSelector(selector: string, line: number): { selector: string; occurrence?: number }[] {
  return selector.split('>').map((part) => {
    const segment = /^\s*([.#][\w-]+|[a-zA-Z][\w-]*)(?:\s+(\S+))?\s*$/.exec(part);
    if (!segment || (segment[2] && (!/^[1-9]\d*$/.test(segment[2]) || !Number.isSafeInteger(Number(segment[2]))))) {
      throw new Error(`Line ${line}: resizeSplit requires valid selectors and positive occurrences`);
    }
    return { selector: segment[1], occurrence: segment[2] ? Number(segment[2]) : undefined };
  });
}

// Chromium screenshot clips use zoomed coordinates, unlike Playwright's element bounds.
async function captureCssRect(page: Page, rect: { x: number; y: number; width: number; height: number }, zoomFactor: number, format: 'png' | 'jpeg'): Promise<Buffer> {
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
    const image = await session.send('Page.captureScreenshot', { format, clip, captureBeyondViewport: true });
    return Buffer.from(image.data, 'base64');
  } finally {
    await session.detach();
  }
}

async function fadeScreenshotEdges(page: Page, screenshot: Buffer, format: 'png' | 'jpeg', fade: number, width: number, height: number): Promise<Buffer> {
  const encoded = await page.evaluate(async ({ image, format, fade, width, height }) => {
    const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(image), (character) => character.charCodeAt(0))], { type: `image/${format}` }));
    try {
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Could not create screenshot canvas');
      context.drawImage(bitmap, 0, 0);
      const horizontal = Math.min(fade * bitmap.width / width, bitmap.width / 2);
      const vertical = Math.min(fade * bitmap.height / height, bitmap.height / 2);
      for (const [x0, y0, x1, y1, x, y, w, h] of [
        [0, 0, horizontal, 0, 0, 0, horizontal, bitmap.height],
        [bitmap.width, 0, bitmap.width - horizontal, 0, bitmap.width - horizontal, 0, horizontal, bitmap.height],
        [0, 0, 0, vertical, 0, 0, bitmap.width, vertical],
        [0, bitmap.height, 0, bitmap.height - vertical, 0, bitmap.height - vertical, bitmap.width, vertical],
      ]) {
        const gradient = context.createLinearGradient(x0, y0, x1, y1);
        gradient.addColorStop(0, 'white');
        gradient.addColorStop(1, 'rgba(255,255,255,0)');
        context.fillStyle = gradient;
        context.fillRect(x, y, w, h);
      }
      const result = canvas.toDataURL(`image/${format}`, 0.92);
      if (!result.startsWith(`data:image/${format};base64,`)) throw new Error('Could not encode faded screenshot');
      return result.slice(result.indexOf(',') + 1);
    } finally {
      bitmap.close();
    }
  }, { image: screenshot.toString('base64'), format, fade, width, height });
  return Buffer.from(encoded, 'base64');
}

// Parses the body of a "{padding: ...}" option using CSS shorthand order (top, right, bottom, left).
function parsePaddingOption(body: string, line: number, command: string): FramePadding {
  const declaration = /^\s*padding\s*:\s*(.*?)\s*;?\s*$/i.exec(body);
  const values = declaration?.[1].replace(/;$/, '').trim().split(/\s+/);
  if (!values || values.length < 1 || values.length > 4 ||
      values.some((value) => !/^(?:\d+(?:\.\d+)?|\.\d+)px$/i.test(value) || !Number.isFinite(parseFloat(value)))) {
    throw new Error(`Line ${line}: ${command} padding requires one to four non-negative pixel values`);
  }
  const numbers = values.map((value) => parseFloat(value));
  return {
    top: numbers[0], right: numbers[1] ?? numbers[0],
    bottom: numbers[2] ?? numbers[0], left: numbers[3] ?? numbers[1] ?? numbers[0],
  };
}

function parseFrameArgument(argument: string, line: number): {
  selector: string; noId: boolean; badge: 'letter' | 'number'; padding: FramePadding; occurrence?: number;
} {
  let selector = argument;
  let noId = false;
  let badge: 'letter' | 'number' = 'letter';
  let padding: FramePadding | undefined;
  let occurrence: number | undefined;
  let optionsBlockSeen = false;
  while (true) {
    const options = /^(.*?)\s+\{([^{}]*)\}$/.exec(selector);
    if (options) {
      // Only one brace block is allowed per frame line
      if (optionsBlockSeen) throw new Error(`Line ${line}: only one frame options block is allowed`);
      optionsBlockSeen = true;
      const seen = new Set<string>();
      for (const entry of options[2].split(',')) {
        const option = /^\s*(\w+)\s*:(.*)$/.exec(entry);
        const key = option?.[1];
        if (!key || seen.has(key)) throw new Error(`Line ${line}: invalid or duplicate frame option ${entry.trim()}`);
        seen.add(key);
        if (key === 'noId') {
          if (!/^\s*(true|false)\s*$/.test(option![2])) throw new Error(`Line ${line}: noId must be true or false`);
          noId = option![2].trim() === 'true';
        } else if (key === 'badge') {
          if (option![2].trim() !== 'number') throw new Error(`Line ${line}: badge must be number`);
          badge = 'number';
        } else if (key === 'padding') {
          padding = parsePaddingOption(entry, line, 'frame');
        } else {
          throw new Error(`Line ${line}: unknown frame option ${key}`);
        }
      }
      selector = options[1];
      continue;
    }
    const suffix = /^(.*?)\s+(\S+)$/.exec(selector);
    if (!suffix) break;
    if (suffix[2] === 'noId') {
      throw new Error(`Line ${line}: noId must be written as {noId:true}`);
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
  if (/\s+\{/.test(selector)) throw new Error(`Line ${line}: invalid frame options`);
  return { selector, noId, badge, padding: padding || { top: 0, right: 0, bottom: 0, left: 0 }, occurrence };
}

function parseAnnotationArgument(argument: string, line: number): { selector: string; text: string; occurrence?: number; position?: AnnotationPosition } {
  const annotation = /^(\S+)(?:\s+(\S+))?\s+"((?:[^"\\]|\\.)+)"(?:\s+\{\s*position\s*:\s*([a-z]+)\s*\})?$/.exec(argument);
  if (!annotation || (/^[\w-]+$/.test(annotation[1]) && !/^[a-zA-Z][\w-]*$/.test(annotation[1])) || !/\S/.test(annotation[3])) {
    throw new Error(`Line ${line}: annotation requires a selector or element name, an optional occurrence, quoted text, and an optional {position:top|right|bottom|left}; IDs must start with #`);
  }
  if (annotation[2] && (!/^[1-9]\d*$/.test(annotation[2]) || !Number.isSafeInteger(Number(annotation[2])))) {
    throw new Error(`Line ${line}: annotation occurrence must be a positive integer`);
  }
  const position = annotation[4];
  if (position && position !== 'top' && position !== 'right' && position !== 'bottom' && position !== 'left') {
    throw new Error(`Line ${line}: annotation position must be top, right, bottom, or left`);
  }
  return {
    selector: annotation[1],
    text: annotation[3].replace(/\\(n|")/g, (_match, escaped: string) => escaped === 'n' ? '\n' : '"'),
    occurrence: annotation[2] ? Number(annotation[2]) : undefined,
    position,
  };
}

// Views manager checkbox (box) of each ViewLayoutVO / DimensionViewLayoutModel visibility property.
const visibilityBoxSelectors = new Map<string, string>([
  ['isDimensionsChecked', '.box-dimensions'],
  ['isCooccurrenceChecked', '.box-cooccurrence'],
  ['isChecked', '.box-dimension'],
  ['isHierarchyChecked', '.box-hierarchy'],
  ['isClustersChecked', '.box-clusters'],
  ['isAnnotationChecked', '.box-annotation'],
  ['isCompositionChecked', '.box-composition'],
  ['isExternalDataChecked', '.box-external-data'],
  ['isDistributionChecked', '.box-distribution'],
]);

export function parseScreenshotScenario(source: string): ScreenshotCommand[] {
  const commands: ScreenshotCommand[] = [];
  for (const [index, rawLine] of source.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const match = /^(\S+)(?:\s+(.+))?$/.exec(line);
    const name = match![1];
    let argument = (match![2] || '').trim();
    let occurrence: number | undefined;
    let annotationPosition: AnnotationPosition | undefined;
    if (!['fileOpen', 'openTab', 'clickRow', 'clickElt', 'hover', 'hideElt', 'removeElt', 'firstPlan', 'clickChart', 'zoomOut', 'zoomIn', 'refreshDom', 'resizeSplit',     'wait', 'frame', 'annotation', 'annotationSelectedCell', 'clean', 'input', 'unfocus', 'screenshot', 'shotElt', 'setVisibility'].includes(name)) {
      throw new Error(`Line ${index + 1}: unknown command "${name}"`);
    }
        if (name !== 'screenshot' && name !== 'zoomOut' && name !== 'zoomIn' && name !== 'refreshDom' && name !== 'unfocus' && name !== 'clean' && !argument) {
      throw new Error(`Line ${index + 1}: ${name} requires an argument`);
    }
        if ((name === 'zoomOut' || name === 'zoomIn' || name === 'refreshDom' || name === 'unfocus' || name === 'clean') && argument) {
      throw new Error(`Line ${index + 1}: ${name} does not take an argument`);
    }
        const setOccurrence = (value: string) => {
          if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)) || occurrence !== undefined) {
            throw new Error(`Line ${index + 1}: ${name} occurrence must be a single positive integer`);
          }
          occurrence = Number(value);
        };
        if (['openTab', 'clickRow', 'clickElt', 'hover', 'hideElt', 'removeElt', 'firstPlan', 'clickChart',
          'resizeSplit', 'frame', 'annotation', 'annotationSelectedCell', 'input', 'shotElt', 'setVisibility'].includes(name)) {
          const prefix = /^([+-]?\d\S*)\s+(.+)$/.exec(argument);
          if (prefix) {
            setOccurrence(prefix[1]);
            argument = prefix[2];
          }
        }
    if (name === 'wait' && (!/^\d+$/.test(argument) || Number(argument) > 2147483647)) {
      throw new Error(`Line ${index + 1}: wait requires a non-negative integer duration in milliseconds`);
    }
    if (name === 'annotation' || name === 'annotationSelectedCell') {
      const { selector, text, occurrence: annotationOccurrence, position } = parseAnnotationArgument(
        name === 'annotation' ? argument : `#matrix-selected ${argument}`, index + 1);
      argument = name === 'annotation' ? `${selector} ${text}` : text;
      if (annotationOccurrence !== undefined) setOccurrence(String(annotationOccurrence));
      annotationPosition = position;
    }
    if (name === 'input') {
      const input = /^([.#][\w-]+|[a-zA-Z][\w-]*)(?:\s+([+-]?\d\S*))?\s+(?:"((?:[^"\\]|\\.)*)"|([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?))$/.exec(argument);
      if (!input) {
        throw new Error(`Line ${index + 1}: input requires an ID, class, or element name and quoted text or a number`);
      }
      if (input[2]) setOccurrence(input[2]);
      const text = input[3] === undefined ? input[4] : input[3].replace(/\\(n|")/g, (_match, escaped: string) => escaped === 'n' ? '\n' : '"');
      argument = `${input[1]} ${text}`;
    }
    if (name === 'frame') {
      const frame = parseFrameArgument(argument, index + 1);
      if (frame.occurrence !== undefined && occurrence !== undefined) {
        throw new Error(`Line ${index + 1}: frame occurrence must be a single positive integer`);
      }
    }
    if (name === 'clickRow' && /\s/.test(argument) && !/^(?:[.#][\w-]+|[a-zA-Z][\w-]*)\s+\S/.test(argument)) {
      throw new Error(`Line ${index + 1}: clickRow requires an optional table ID, class, or element name and row text`);
    }
    if (name === 'clickElt') {
      const element = /^([.#][\w-]+|[a-zA-Z][\w-]*)(?:\s+([+-]?\d\S*))?$/.exec(argument);
      const text = /^"((?:[^"\\]|\\.)+)"(?:\s+([+-]?\d\S*))?$/.exec(argument);
      if ((!text || !/\S/.test(text[1].replace(/\\(n|")/g, (_match, escaped: string) => escaped === 'n' ? '\n' : '"'))) &&
          !element) {
        throw new Error(`Line ${index + 1}: clickElt requires quoted text, an ID, a class, or an element name and an optional positive occurrence number`);
      }
      if (element?.[2]) setOccurrence(element[2]);
      if (text?.[2]) setOccurrence(text[2]);
      if (element) argument = element[1];
      if (text) argument = `"${text[1]}"`;
    }
    if (name === 'hover' || name === 'hideElt' || name === 'removeElt' || name === 'firstPlan') {
      const element = /^([.#][\w-]+|[a-zA-Z][\w-]*)(?:\s+([+-]?\d\S*))?$/.exec(argument);
      if (!element) throw new Error(`Line ${index + 1}: ${name} requires an ID, a class, or an element name`);
      if (element[2]) setOccurrence(element[2]);
      argument = element[1];
    }
    if (name === 'setVisibility') {
      const visibility = /^(?:#sym:)?(\w+)(?:\s+([1-9]\d*))?\s+(true|false)$/.exec(argument);
      if (!visibility || !visibilityBoxSelectors.has(visibility[1])) {
        throw new Error(`Line ${index + 1}: setVisibility requires a known visibility property, an optional positive occurrence number, and true or false`);
      }
      if (visibility[2]) setOccurrence(visibility[2]);
      argument = `${visibility[1]} ${occurrence ?? '1'} ${visibility[3]}`;
    }
    if (name === 'shotElt') {
      let shotPadding: FramePadding | undefined;
      let shotSize: { width: number; height: number } | undefined;
      let shotFade: number | undefined;
      let rest = argument;
      for (let option = /^(.*?)\s+\{([^{}]*)\}$/.exec(rest); option; option = /^(.*?)\s+\{([^{}]*)\}$/.exec(rest)) {
        for (const entry of option[2].split(',')) {
          const sizeOption = /^\s*size\s*:\s*(\d+)x(\d+)\s*$/i.exec(entry);
          const fadeOption = /^\s*fade\s*:\s*((?:\d+(?:\.\d+)?|\.\d+)px)\s*$/i.exec(entry);
          if (sizeOption) {
            if (shotSize) throw new Error(`Line ${index + 1}: duplicate shotElt size`);
            if (Number(sizeOption[1]) === 0 || Number(sizeOption[2]) === 0) {
              throw new Error(`Line ${index + 1}: shotElt size must be greater than zero`);
            }
            shotSize = { width: Number(sizeOption[1]), height: Number(sizeOption[2]) };
          } else if (fadeOption) {
            if (shotFade !== undefined) throw new Error(`Line ${index + 1}: duplicate shotElt fade`);
            shotFade = parseFloat(fadeOption[1]);
            if (!Number.isFinite(shotFade)) throw new Error(`Line ${index + 1}: shotElt fade requires a finite non-negative pixel value`);
          } else if (/^\s*fade\s*:/i.test(entry)) {
            throw new Error(`Line ${index + 1}: shotElt fade requires a finite non-negative pixel value`);
          } else {
            if (shotPadding) throw new Error(`Line ${index + 1}: duplicate shotElt padding`);
            shotPadding = parsePaddingOption(entry, index + 1, 'shotElt');
          }
        }
        rest = option[1];
      }
      const element = /^([.#][\w-]+|[a-zA-Z][\w-]*)\s+(?:([+-]?\d\S*)\s+)?(.+)$/.exec(rest);
      if (!element) {
        throw new Error(`Line ${index + 1}: shotElt requires an ID prefixed with #, a class prefixed with ., or an element name, an optional occurrence, and a PNG or JPEG path, optionally followed by size, padding, and fade options`);
      }
      if (element[2]) {
        setOccurrence(element[2]);
      }
      if (shotSize && shotPadding) {
        throw new Error(`Line ${index + 1}: shotElt cannot combine size with padding`);
      }
      const size = shotSize ? ` {size:${shotSize.width}x${shotSize.height}}` : '';
      const padding = shotPadding ? ` {padding:${[shotPadding.top, shotPadding.right, shotPadding.bottom, shotPadding.left].join(' ')}}` : '';
      const fade = shotFade !== undefined ? ` {fade:${shotFade}}` : '';
      argument = `${element[1]} ${parseScreenshotFilename(element[3], index + 1, name)}${size}${padding}${fade}`;
    }
    if (name === 'screenshot' && argument) {
      argument = parseScreenshotFilename(argument, index + 1, name);
    }
    if (name === 'clickChart') {
      const chart = /^([.#][\w-]+|[a-zA-Z][\w-]*)(?:\s+([+-]?\d\S*))?\s+(\d+)$/.exec(argument);
      if (!chart) throw new Error(`Line ${index + 1}: clickChart requires an ID, a class, or an element name and a zero-based index`);
      if (chart[2]) setOccurrence(chart[2]);
      argument = `${chart[1]} ${chart[3]}`;
    }
    if (name === 'resizeSplit') {
      const match = /^(.+?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)$/.exec(argument);
      if (!match || Math.abs(Number(match[2]) + Number(match[3]) - 100) > 1e-8) {
        throw new Error(`Line ${index + 1}: resizeSplit requires a split selector (ID, class, or element name, optionally chained with >) and two percentages totaling 100`);
      }
      const segments = parseSplitSelector(match[1], index + 1);
      const last = segments[segments.length - 1];
      if (last.occurrence !== undefined) {
        setOccurrence(String(last.occurrence));
        last.occurrence = undefined;
      }
      const selector = segments.map((segment) => `${segment.selector}${segment.occurrence ? ` ${segment.occurrence}` : ''}`).join('>');
      argument = `${selector} ${match[2]} ${match[3]}`;
    }
    commands.push({ name: name as ScreenshotCommand['name'], argument, line: index + 1,
      ...(occurrence !== undefined ? { occurrence } : {}),
      ...(annotationPosition !== undefined ? { annotationPosition } : {}) });
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
  let frames: { target: Locator; noId: boolean; badge: 'letter' | 'number'; padding: FramePadding }[] = [];
  let annotations: { target: Locator; text: string; position: AnnotationPosition; selectedCell?: boolean }[] = [];
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
          const tabs = activeView.getByRole('tab', { name: command.argument, exact: true });
          const tab = command.occurrence === undefined ? tabs : tabs.filter({ visible: true }).nth(command.occurrence - 1);
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
          const [, splitSelector, firstPercentage] = /^(.+)\s+(\d+(?:\.\d+)?)\s+\d+(?:\.\d+)?$/.exec(command.argument)!;
          const segments = parseSplitSelector(splitSelector, command.line);
          const isId = segments[segments.length - 1].selector.startsWith('#');
          let matches = firstWindow.locator('khiops-visualization:visible, khiops-covisualization:visible');
          for (const [index, segment] of segments.entries()) {
            const css = toElementSelector(segment.selector);
            matches = matches.locator(index === 0 ? css : `:scope > ${css}`);
            if (segment.occurrence !== undefined) matches = matches.filter({ visible: true }).nth(segment.occurrence - 1);
          }
          matches = matches.filter({ visible: true });
          if (isId && command.occurrence === undefined) await expect(matches).toHaveCount(1, { timeout: 30000 });
          const split = matches.nth((command.occurrence ?? 1) - 1);
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
          if (await isReached()) {
            await firstWindow.mouse.click(1, 1);
            break;
          }
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
          await firstWindow.mouse.click(1, 1);
          break;
        }

        case 'clickRow': {
          const match = /^(\S+)(?:\s+(.+))?$/.exec(command.argument)!;
          const activeView = firstWindow.locator('khiops-visualization:visible, khiops-covisualization:visible');
          const table = match[2] ? activeView.locator(toElementSelector(match[1])) : activeView;
          const rows = table.getByRole('row').filter({ hasText: match[2] || match[1], visible: true });
          if (command.occurrence === undefined) await expect(rows).toHaveCount(1, { timeout: 30000 });
          const row = command.occurrence === undefined ? rows : rows.nth(command.occurrence - 1);
          await row.click();
          break;
        }
        case 'clickElt': {
          const text = /^"((?:[^"\\]|\\.)+)"$/.exec(command.argument);
          const index = (command.occurrence ?? 1) - 1;
          if (text) {
            const value = text[1].replace(/\\(n|")/g, (_match, escaped: string) => escaped === 'n' ? '\n' : '"');
            const matches = firstWindow.locator('khiops-visualization:visible, khiops-covisualization:visible').getByText(value);
            const visibleMatches = matches.filter({ visible: true });
            await expect.poll(async () => (await visibleMatches.count()) > index || (await matches.count()) > index,
              { timeout: 30000 }).toBe(true);
            const match = (await visibleMatches.count()) > index ? visibleMatches.nth(index) : matches.nth(index);
            await match.evaluate((element) => {
              if (!(element instanceof HTMLElement)) throw new Error('clickElt text target must be an HTML element');
              element.click();
            });
            break;
          }
          const elementSelector = command.argument;
          const selector = toElementSelector(elementSelector);
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
        case 'hover': {
          const selector = toElementSelector(command.argument);
          const targets = firstWindow.locator('khiops-visualization:visible, khiops-covisualization:visible')
            .locator(selector).filter({ visible: true });
          if (command.argument.startsWith('#') && command.occurrence === undefined) {
            await expect(targets).toHaveCount(1, { timeout: 30000 });
          }
          await targets.nth((command.occurrence ?? 1) - 1).hover({ timeout: 30000 });
          break;
        }
        case 'firstPlan': {
          const isId = command.argument.startsWith('#');
          const selector = toElementSelector(command.argument);
          const targets = firstWindow.locator('khiops-visualization:visible, khiops-covisualization:visible')
            .locator(selector).filter({ visible: true });
          if (isId && command.occurrence === undefined) await expect(targets).toHaveCount(1, { timeout: 30000 });
          const target = targets.nth((command.occurrence ?? 1) - 1);
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
          const selector = toElementSelector(command.argument);
          const matches = firstWindow.locator(selector).filter({ visible: true });
          const targets = command.occurrence === undefined ? matches : matches.nth(command.occurrence - 1);
          await expect(command.occurrence === undefined ? targets.first() : targets).toBeVisible({ timeout: 30000 });
          await targets.evaluateAll((elements) => {
            for (const element of elements) (element as HTMLElement).style.setProperty('display', 'none', 'important');
          });
          break;
        }
        case 'removeElt': {
          const selector = toElementSelector(command.argument);
          const matches = firstWindow.locator(selector);
          const targets = command.occurrence === undefined ? matches : matches.nth(command.occurrence - 1);
          await expect(command.occurrence === undefined ? targets.first() : targets).toBeAttached({ timeout: 30000 });
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
          const canvases = firstWindow.locator('khiops-visualization:visible, khiops-covisualization:visible')
            .locator(toElementSelector(chartId)).filter({ visible: true });
          if (chartId.startsWith('#') && command.occurrence === undefined) await expect(canvases).toHaveCount(1, { timeout: 30000 });
          const canvas = chartId.startsWith('#') && command.occurrence === undefined
            ? canvases : canvases.nth((command.occurrence ?? 1) - 1);
          await expect(canvas).toBeVisible({ timeout: 30000 });
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
        case 'setVisibility': {
          const [property, occurrence, value] = command.argument.split(/\s+/);
          const box = visibilityBoxSelectors.get(property)!;
          const wanted = value === 'true';
          const activeView = firstWindow.locator('khiops-visualization:visible, khiops-covisualization:visible');
          const openButton = activeView.locator('[class~="button-manage-views"]').filter({ visible: true }).first();
          await expect(openButton).toBeVisible({ timeout: 30000 });
          await openButton.click().catch(() => openButton.evaluate((element) => (element as HTMLElement).click()));
          const save = activeView.locator('#manage-views-save').filter({ visible: true }).first();
          await expect(save).toBeVisible({ timeout: 30000 });
          // A checkbox is unchecked when its block carries the "disabled" class.
          const target = activeView.locator(`[class~="${box.slice(1)}"]`).filter({ visible: true }).nth(Number(occurrence) - 1);
          await expect(target).toBeVisible({ timeout: 30000 });
          const isChecked = () => target.evaluate((element) => !element.classList.contains('disabled'));
          if ((await isChecked()) !== wanted) {
            await target.click().catch(() => target.evaluate((element) => (element as HTMLElement).click()));
          }
          await expect.poll(isChecked, { timeout: 5000 }).toBe(wanted);
          await save.click();
          await expect(save).toBeHidden({ timeout: 30000 });
          break;
        }
        case 'input': {
          const separator = command.argument.indexOf(' ');
          const selector = command.argument.slice(0, separator);
          const text = command.argument.slice(separator + 1);
          const targets = firstWindow.locator('khiops-visualization:visible, khiops-covisualization:visible')
            .locator(toElementSelector(selector));
          const targetIndex = (command.occurrence ?? 1) - 1;
          const visibleTargets = targets.filter({ visible: true });
          await expect.poll(async () => (await visibleTargets.count()) > targetIndex || (await targets.count()) > targetIndex,
            { timeout: 30000 }).toBe(true);
          const target = (await visibleTargets.count()) > targetIndex ? visibleTargets.nth(targetIndex) : targets.nth(targetIndex);
          const isInput = await target.evaluate((element) => element instanceof HTMLInputElement);
          const inputs = isInput ? target : target.locator('input');
          await expect(inputs.first()).toBeAttached({ timeout: 30000 });
          const visibleInput = inputs.filter({ visible: true }).first();
          const input = await visibleInput.count() ? visibleInput : inputs.first();
          const isRange = await input.evaluate((element) => element instanceof HTMLInputElement && element.type === 'range');
          if (isRange) {
            const requested = Number(text);
            const { min, max, step } = await input.evaluate((element: HTMLInputElement) => ({
              min: Number(element.min || 0), max: Number(element.max || 100), step: Number(element.step || 1),
            }));
            const steps = (requested - min) / step;
            if (!text.trim() || !Number.isFinite(requested) || !Number.isFinite(steps) ||
              requested < min || requested > max || Math.abs(steps - Math.round(steps)) > 1e-9) {
              throw new Error(`input ${selector}: ${JSON.stringify(text)} is not a valid slider value`);
            }
            await input.press('Home');
            for (let index = 0; index < Math.round(steps); index++) await input.press('ArrowRight');
            await expect.poll(() => input.evaluate((element: HTMLInputElement) => element.valueAsNumber))
              .toBe(requested);
          } else {
            await input.fill(text, { force: !(await input.isVisible()) });
          }
          break;
        }
        case 'frame': {
          const { selector, noId, badge, padding, occurrence } = parseFrameArgument(command.argument, command.line);
          const targets = firstWindow.locator('khiops-visualization:visible, khiops-covisualization:visible').locator(selector).filter({ visible: true });
          const target = targets.nth((command.occurrence ?? occurrence ?? 1) - 1);
          await expect(target).toBeVisible();
          frames.push({ target, noId, badge, padding });
          break;
        }
        case 'annotation': {
          const separator = command.argument.indexOf(' ');
          const selector = command.argument.slice(0, separator);
          const text = command.argument.slice(separator + 1);
          const target = firstWindow.locator('khiops-visualization:visible, khiops-covisualization:visible')
            .locator(selector).filter({ visible: true }).nth((command.occurrence ?? 1) - 1);
          await expect(target).toBeVisible({ timeout: 30000 });
          annotations.push({ target, text, position: command.annotationPosition ?? 'bottom' });
          break;
        }
        case 'annotationSelectedCell': {
          const targets = firstWindow.locator('khiops-visualization:visible, khiops-covisualization:visible')
            .locator('#matrix-selected').filter({ visible: true });
          if (command.occurrence === undefined) await expect(targets).toHaveCount(1, { timeout: 30000 });
          const target = targets.nth((command.occurrence ?? 1) - 1);
          await expect(target).toBeVisible({ timeout: 30000 });
          annotations.push({ target, text: command.argument, position: command.annotationPosition ?? 'bottom', selectedCell: true });
          break;
        }
        case 'clean': {
          frames = [];
          annotations = [];
          break;
        }
        case 'shotElt':
        case 'screenshot': {
          let target: Locator | undefined;
          let filename: string;
          let size: { width: number; height: number } | undefined;
          let shotPadding: FramePadding | undefined;
          let shotFade: number | undefined;
          if (command.name === 'shotElt') {
            const [, elementSelector, elementFilename, sizeWidth, sizeHeight, paddingText, fadeText] =
              /^(\S+)\s+(.+?)(?:\s+\{size:(\d+)x(\d+)\})?(?:\s+\{padding:([\d. ]+)\})?(?:\s+\{fade:([\d.e+-]+)\})?$/.exec(command.argument)!;
            size = sizeWidth !== undefined ? { width: Number(sizeWidth), height: Number(sizeHeight) } : undefined;
            shotFade = fadeText !== undefined ? Number(fadeText) : undefined;
            if (paddingText !== undefined) {
              const [top, right, bottom, left] = paddingText.split(' ').map(Number);
              shotPadding = { top, right, bottom, left };
            }
            const isId = elementSelector.startsWith('#');
            const selector = toElementSelector(elementSelector);
            const targets = firstWindow.locator(selector).filter({ visible: true });
            if (isId && command.occurrence === undefined) await expect(targets).toHaveCount(1, { timeout: 30000 });
            target = isId && command.occurrence === undefined ? targets : targets.nth((command.occurrence ?? 1) - 1);
            await expect(target).toBeVisible({ timeout: 30000 });
            await target.scrollIntoViewIfNeeded();
            filename = elementFilename.replace(/[\\/]/g, path.sep);
          } else {
            filename = command.argument.replace(/[\\/]/g, path.sep) || `screenshot-${String(screenshotCount + 1).padStart(3, '0')}.png`;
            await firstWindow.locator('.mat-mdc-snack-bar-container:visible').first().waitFor({ state: 'hidden', timeout: 15000 });
          }
          const format = /\.jpe?g$/i.test(filename) ? 'jpeg' : 'png';
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
                  const labels: string[] = (window as any).__kvdBadgeLabels || [];
                  for (const [index, badge] of Array.from(overlay.querySelectorAll('g > text')).entries()) {
                    const label = labels[index];
                    if (label === undefined) continue;
                    if (!label) {
                      (badge.parentElement as unknown as SVGElement).style.setProperty('display', 'none', 'important');
                    }
                    if (badge.textContent !== label) badge.textContent = label;
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
            const boxes = await Promise.all(frames.map(async ({ target, padding }) => {
              await expect(target).toBeVisible();
              const box = await target.boundingBox();
              if (!box || box.width <= 0 || box.height <= 0) throw new Error('Annotation target has no visible area');
              return {
                x: box.x - padding.left, y: box.y - padding.top,
                width: box.width + padding.left + padding.right,
                height: box.height + padding.top + padding.bottom,
              };
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
            let letters = 0;
            let numbers = 0;
            const labels = frames.map((frame) => {
              if (frame.noId) return '';
              if (frame.badge === 'number') return String(++numbers);
              let value = ++letters;
              let label = '';
              while (value > 0) {
                value--;
                label = String.fromCharCode(65 + value % 26) + label;
                value = Math.floor(value / 26);
              }
              return label;
            });
            await firstWindow.evaluate((badgeLabels) => { (window as any).__kvdBadgeLabels = badgeLabels; }, labels);
            await firstWindow.evaluate(() => (window as any).Annotate.import());
            const chooser = await chooserPromise;
            await chooser.setFiles({ name: 'annotations.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(payload)) });
            await expect(firstWindow.locator('#__an_overlay rect.an-hit')).toHaveCount(frames.length);
            const badges = firstWindow.locator('#__an_overlay g > text');
            await expect(badges).toHaveCount(frames.length);
            await expect(badges).toHaveText(labels);
          }
          if (annotations.length) {
            const items = await Promise.all(annotations.map(async ({ target, text, position, selectedCell }) => {
              await expect(target).toBeVisible();
              const box = selectedCell ? await target.evaluate((element) => {
                if (!(element instanceof HTMLCanvasElement)) throw new Error('Selected matrix target must be a canvas');
                const canvas = element as HTMLCanvasElement & {
                  getSelectedCellBounds?: () => { x: number; y: number; width: number; height: number } | undefined;
                };
                if (!canvas.getSelectedCellBounds) throw new Error('Matrix selection bounds are unavailable; rebuild the visualization component');
                const bounds = canvas.getSelectedCellBounds();
                if (!bounds || ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) ||
                    bounds.width <= 0 || bounds.height <= 0) throw new Error('No valid matrix cell selection is available');
                const context = canvas.getContext('2d');
                if (!context || !canvas.width || !canvas.height) throw new Error('Matrix canvas has no drawing area');
                const matrix = context.getTransform();
                const corners = [
                  new DOMPoint(bounds.x, bounds.y), new DOMPoint(bounds.x + bounds.width, bounds.y),
                  new DOMPoint(bounds.x, bounds.y + bounds.height),
                  new DOMPoint(bounds.x + bounds.width, bounds.y + bounds.height),
                ].map((point) => point.matrixTransform(matrix));
                const xs = corners.map((point) => point.x);
                const ys = corners.map((point) => point.y);
                const rect = canvas.getBoundingClientRect();
                const scaleX = rect.width / canvas.width;
                const scaleY = rect.height / canvas.height;
                return { x: rect.x + Math.min(...xs) * scaleX, y: rect.y + Math.min(...ys) * scaleY,
                  width: (Math.max(...xs) - Math.min(...xs)) * scaleX,
                  height: (Math.max(...ys) - Math.min(...ys)) * scaleY };
              }) : await target.boundingBox();
              if (!box || box.width <= 0 || box.height <= 0) throw new Error('annotation target has no visible area');
              return { box, text, position };
            }));
            await firstWindow.evaluate(({ items, color, fontSize }) => {
              const overlay = document.createElement('div');
              overlay.id = '__screenshot_annotations';
              overlay.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
              document.body.appendChild(overlay);
              for (const { box, text, position } of items) {
                const label = document.createElement('div');
                label.textContent = text;
                label.style.cssText = `position:absolute;max-width:180px;box-sizing:border-box;padding:6px 9px;border-radius:4px;background:${color};box-shadow:0 1px 4px rgba(0,0,0,0.2);white-space:pre-wrap;overflow-wrap:anywhere;font:600 ${fontSize}px/1.35 sans-serif;color:#553300;`;
                const caret = document.createElement('span');
                const caretStyles = {
                  bottom: `left:50%;top:-7px;transform:translateX(-50%);border-left:7px solid transparent;border-right:7px solid transparent;border-bottom:8px solid ${color};`,
                  top: `left:50%;bottom:-7px;transform:translateX(-50%);border-left:7px solid transparent;border-right:7px solid transparent;border-top:8px solid ${color};`,
                  right: `left:-7px;top:50%;transform:translateY(-50%);border-top:7px solid transparent;border-bottom:7px solid transparent;border-right:8px solid ${color};`,
                  left: `right:-7px;top:50%;transform:translateY(-50%);border-top:7px solid transparent;border-bottom:7px solid transparent;border-left:8px solid ${color};`,
                };
                caret.style.cssText = `position:absolute;width:0;height:0;${caretStyles[position]}`;
                label.appendChild(caret);
                overlay.appendChild(label);
                const labelBox = label.getBoundingClientRect();
                const left = position === 'right' ? box.x + box.width + 7 :
                  position === 'left' ? box.x - labelBox.width - 7 : box.x + box.width / 2 - labelBox.width / 2;
                const top = position === 'bottom' ? box.y + box.height + 7 :
                  position === 'top' ? box.y - labelBox.height - 7 : box.y + box.height / 2 - labelBox.height / 2;
                label.style.left = `${Math.max(4, Math.min(window.innerWidth - labelBox.width - 4, left))}px`;
                label.style.top = `${Math.max(11, Math.min(window.innerHeight - labelBox.height - 4, top))}px`;
              }
            }, { items, color: ANNOTATION_COLOR, fontSize: ANNOTATION_FONT_SIZE });
          }
          let screenshot: Buffer;
          if (target) {
            const zoomFactor = await browserWindow.evaluate((window: any) => window.webContents.getZoomFactor() as number);
            const box = await target.boundingBox();
            if (!box || box.width <= 0 || box.height <= 0) throw new Error('Screenshot target has no visible area');
            let captureWidth = box.width;
            let captureHeight = box.height;
            if (size) {
              const rect = { x: box.x, y: box.y, width: size.width, height: size.height };
              captureWidth = rect.width;
              captureHeight = rect.height;
              // Playwright clips are exact in CSS pixels at zoom 1; zoomed windows use the CDP clip path.
              screenshot = zoomFactor === 1
                ? await firstWindow.screenshot({ animations: 'disabled', clip: rect, type: format })
                : await captureCssRect(firstWindow, rect, zoomFactor, format);
            } else if (shotPadding) {
              // Padding can extend past the element, so the clip is always taken through CDP.
              const rect = {
                x: box.x - shotPadding.left, y: box.y - shotPadding.top,
                width: box.width + shotPadding.left + shotPadding.right,
                height: box.height + shotPadding.top + shotPadding.bottom,
              };
              captureWidth = rect.width;
              captureHeight = rect.height;
              screenshot = await captureCssRect(firstWindow, rect, zoomFactor, format);
            } else {
              screenshot = await target.screenshot({ animations: 'disabled', type: format });
              if (zoomFactor !== 1) screenshot = await captureCssRect(firstWindow, box, zoomFactor, format);
            }
            if (shotFade) screenshot = await fadeScreenshotEdges(firstWindow, screenshot, format, shotFade, captureWidth, captureHeight);
          } else {
            const [width, height] = await browserWindow.evaluate((window: any) => window.getContentSize() as [number, number]);
            screenshot = await firstWindow.screenshot({ animations: 'disabled', clip: { x: 0, y: 0, width, height }, type: format });
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