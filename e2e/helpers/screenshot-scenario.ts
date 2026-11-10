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
  name: 'fileOpen' | 'openTab' | 'clickRow' | 'clickChart' | 'frame' | 'annotation' | 'screenshot';
  argument: string;
  line: number;
};

async function writeScreenshot(filePath: string, screenshot: Buffer): Promise<void> {
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

export function parseScreenshotScenario(source: string): ScreenshotCommand[] {
  const commands: ScreenshotCommand[] = [];
  for (const [index, rawLine] of source.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const match = /^(\S+)(?:\s+(.+))?$/.exec(line);
    const name = match![1];
    const argument = (match![2] || '').trim();
    if (!['fileOpen', 'openTab', 'clickRow', 'clickChart', 'frame', 'annotation', 'screenshot'].includes(name)) {
      throw new Error(`Line ${index + 1}: unknown command "${name}"`);
    }
    if (name !== 'screenshot' && !argument) {
      throw new Error(`Line ${index + 1}: ${name} requires an argument`);
    }
    if (name === 'annotation' && !/^\S+\s+\S/.test(argument)) {
      throw new Error(`Line ${index + 1}: annotation requires a selector and text`);
    }
    if (name === 'clickChart' && !/^#?[\w-]+\s+\d+$/.test(argument)) {
      throw new Error(`Line ${index + 1}: clickChart requires a chart ID and a zero-based index`);
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
): Promise<void> {
  const commands = parseScreenshotScenario(await fs.readFile(scenarioPath, 'utf8'));
  const projectRoot = path.resolve(__dirname, '../..');
  let frames: { target: Locator; card: boolean }[] = [];
  let annotations: { target: Locator; text: string }[] = [];
  let screenshotCount = 0;
  let annotationReady = false;

  await fs.mkdir(outputDirectory, { recursive: true });
  await firstWindow.waitForLoadState('networkidle');
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setSize(1440, 900);
    window.center();
  });

  for (const command of commands) {
    try {
      switch (command.name) {
        case 'fileOpen': {
          const filePath = path.resolve(projectRoot, command.argument.replace(/[\\/]/g, path.sep));
          await fs.access(filePath);
          await mockOpenDialogAbsolute(app, filePath);
          await clickMenuItem(app, 'File', 'Open');
          await expect(firstWindow.locator('.tab.active')).toContainText(path.basename(filePath), { timeout: 30000 });
          await expect(firstWindow.locator('khiops-visualization:visible, khiops-covisualization:visible')).toBeVisible({ timeout: 30000 });
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
        case 'clickRow': {
          const match = /^(\S+)(?:\s+(.+))?$/.exec(command.argument)!;
          const activeView = firstWindow.locator('khiops-visualization:visible, khiops-covisualization:visible');
          const table = match[2] ? activeView.locator(`[id=${JSON.stringify(match[1].replace(/^#/, ''))}]`) : activeView;
          const row = table.getByRole('row').filter({ hasText: match[2] || match[1], visible: true });
          await expect(row).toHaveCount(1, { timeout: 30000 });
          await row.click();
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
        case 'frame': {
          const card = /\s+card$/.test(command.argument);
          const frameSelector = card ? command.argument.replace(/\s+card$/, '') : command.argument;
          const selector = /^[\w-]+$/.test(frameSelector) ? `#${frameSelector}` : frameSelector;
          const target = firstWindow.locator('khiops-visualization:visible, khiops-covisualization:visible').locator(selector).filter({ visible: true });
          await expect(target).toHaveCount(1, { timeout: 30000 });
          await expect(target).toBeVisible();
          frames.push({ target, card });
          break;
        }
        case 'annotation': {
          const match = /^(\S+)\s+(.+)$/.exec(command.argument)!;
          const selector = /^[\w-]+$/.test(match[1]) ? `#${match[1]}` : match[1];
          const target = firstWindow.locator('khiops-visualization:visible, khiops-covisualization:visible')
            .locator(selector).filter({ visible: true }).first();
          await expect(target).toBeVisible({ timeout: 30000 });
          annotations.push({ target, text: match[2].replace(/\\n/g, '\n') });
          break;
        }
        case 'screenshot': {
          screenshotCount++;
          const filename = command.argument || `screenshot-${String(screenshotCount).padStart(3, '0')}.png`;
          if (!/^[\w.-]+\.png$/i.test(filename) || filename === '..') {
            throw new Error('Screenshot name must be a PNG filename without directories');
          }
          await firstWindow.locator('.mat-mdc-snack-bar-container:visible').first().waitFor({ state: 'hidden', timeout: 15000 });
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
                #__an_root, #__an_launch, #__an_toasts, #__an_plus { display: none !important; }
                #__an_overlay rect.an-hit { fill: ${ANNOTATION_OVERLAY_COLOR}; }
              ` });
              annotationReady = true;
            }
            const boxes = await Promise.all(frames.map(async ({ target, card: useCard }) => {
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
                return box;
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
            for (let index = 0; index < frames.length; index++) {
              await expect(badges.nth(index)).toHaveText(/^[A-Z]+$/);
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
          const screenshot = await firstWindow.screenshot({ animations: 'disabled' });
          await writeScreenshot(path.join(outputDirectory, filename), screenshot);
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