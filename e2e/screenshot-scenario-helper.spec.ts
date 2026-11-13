import * as path from 'path';
import { promises as fs } from 'fs';
import { expect, test } from './fixtures/launch-electron';
import { parseScreenshotScenario, runScreenshotScenario } from './helpers/screenshot-scenario';
import { screenshotWindowSize } from './screenshot-playwright.config';

test('Parse screenshot filenames', () => {
  const commands = parseScreenshotScenario(
    'screenshot "images-khiops-guides/visualization/images/Visualization Adult Evaluation.png"\nscreenshot "images-khiops-guides/visualization/images\\nested\\plot.png"\nscreenshot legacy.png\nscreenshot "coclustering/AdultCovizuOptimal.jpg"\nscreenshot photo.JPEG\nscreenshot',
  );
  expect(commands.map((command) => command.argument)).toEqual([
    'images-khiops-guides/visualization/images/Visualization Adult Evaluation.png',
    'images-khiops-guides/visualization/images\\nested\\plot.png',
    'legacy.png',
    'coclustering/AdultCovizuOptimal.jpg',
    'photo.JPEG',
    '',
  ]);
});

test('Reject invalid screenshot filenames', () => {
  for (const filename of ['"../outside.png"', '"images\\..\\outside.png"', '"images/.. /outside.png"', '"/outside.png"', '"C:\\outside.png"', '"missing-quote.png', '"file.png" extra', '"../outside.jpg"', '"image.gif"']) {
    expect(() => parseScreenshotScenario(`screenshot ${filename}`)).toThrow(/Line 1/);
    expect(() => parseScreenshotScenario(`shotElt #app-histogram ${filename}`)).toThrow(/Line 1/);
  }
});

test('Parse element screenshot paths', () => {
  const commands = parseScreenshotScenario(
    'shotElt #app-histogram "images-khiops-guides/Capital Loss.png"\nshotElt .chart "images\\nested\\plot.png"\nshotElt #chart legacy.png\nshotElt #chart "images/photo.jpg"',
  );
  expect(commands.map((command) => command.argument)).toEqual([
    '#app-histogram images-khiops-guides/Capital Loss.png',
    '.chart images\\nested\\plot.png',
    '#chart legacy.png',
    '#chart images/photo.jpg',
  ]);
});

test('Parse element screenshot occurrences', () => {
  const commands = parseScreenshotScenario('shotElt .axis-comp 2 "images/Composition.png" {padding:2px, fade:1px}\n'
    + 'shotElt kl-chart 3 "images/Chart With Spaces.png"\nshotElt #chart 1 chart.png\nshotElt .chart chart.png');
  expect(commands.map((command) => command.occurrence)).toEqual([2, 3, 1, undefined]);
  expect(commands.map((command) => command.argument)).toEqual([
    '.axis-comp images/Composition.png {padding:2 2 2 2} {fade:1}',
    'kl-chart images/Chart With Spaces.png',
    '#chart chart.png',
    '.chart chart.png',
  ]);
  for (const occurrence of ['0', '-1', '+2', '1.5', '9007199254740992']) {
    expect(() => parseScreenshotScenario(`shotElt .axis-comp ${occurrence} "image.png"`)).toThrow(/Line 1/);
  }
});

test('Parse element screenshot sizes', () => {
  const commands = parseScreenshotScenario(
    'shotElt #header-right "images-khiops-guides/covisualization/UnfoldHierarchy.png" {size:600x200}\nshotElt .chart "plot.png"',
  );
  expect(commands.map((command) => command.argument)).toEqual([
    '#header-right images-khiops-guides/covisualization/UnfoldHierarchy.png {size:600x200}',
    '.chart plot.png',
  ]);
  expect(() => parseScreenshotScenario('shotElt #chart "plot.png" {size:0x200}')).toThrow(/Line 1/);
  expect(() => parseScreenshotScenario('shotElt #chart "plot.png" 600x200')).toThrow(/Line 1/);
});

test('Parse element screenshot padding', () => {
  const commands = parseScreenshotScenario(
    'shotElt .variable-graph-details-comp "images/DistributionZoom.png" {padding: 10px 5px}\n'
    + 'shotElt kl-keyboard-tooltip "images-khiops-guides/covisualization/CTRL.png" {padding: 5px 5px 5px 5px}',
  );
  expect(commands[0].argument).toBe('.variable-graph-details-comp images/DistributionZoom.png {padding:10 5 10 5}');
  expect(commands[1].argument).toBe('kl-keyboard-tooltip images-khiops-guides/covisualization/CTRL.png {padding:5 5 5 5}');
  expect(() => parseScreenshotScenario('shotElt 123invalid "plot.png"')).toThrow(/Line 1/);
  expect(() => parseScreenshotScenario('shotElt #chart "plot.png" {size:600x200} {padding: 10px}')).toThrow(/Line 1/);
  expect(() => parseScreenshotScenario('shotElt #chart "plot.png" {padding: 10em}')).toThrow(/Line 1/);
});

test('Parse element screenshot fade', () => {
  const commands = parseScreenshotScenario(
    'shotElt .button "button.png" {padding: 30px 150px 100px 150px, fade:20px}\n'
    + 'shotElt #chart "plot.jpg" {fade: .5px} {size:80x60}\n'
    + 'shotElt #chart "plot.png" {fade:0px}',
  );
  expect(commands.map((command) => command.argument)).toEqual([
    '.button button.png {padding:30 150 100 150} {fade:20}',
    '#chart plot.jpg {size:80x60} {fade:0.5}',
    '#chart plot.png {fade:0}',
  ]);
  for (const option of ['fade:-1px', 'fade:20', 'fade:2em', 'fade:20px, fade:10px', 'fade:20px, padding:1px, padding:2px']) {
    expect(() => parseScreenshotScenario(`shotElt #chart "plot.png" {${option}}`)).toThrow(/Line 1/);
  }
});

test('Parse chained resizeSplit selectors', () => {
  const commands = parseScreenshotScenario('resizeSplit .axis-comp > .as-horizontal 100 0\n'
    + 'resizeSplit .axis-comp>.as-horizontal 60 40\n'
    + 'resizeSplit .axis-comp 2>.as-horizontal 35 65\n'
    + 'resizeSplit .axis-comp 2 > .group 3 > .as-horizontal 40 60');
  expect(commands.map((command) => command.argument)).toEqual([
    '.axis-comp>.as-horizontal 100 0',
    '.axis-comp>.as-horizontal 60 40',
    '.axis-comp 2>.as-horizontal 35 65',
    '.axis-comp 2>.group 3>.as-horizontal 40 60',
  ]);
  expect(parseScreenshotScenario('resizeSplit axis-comp>as-split 100 0')).toHaveLength(1);
  for (const occurrence of ['0', '-1', '1.5', '9007199254740992']) {
    expect(() => parseScreenshotScenario(`resizeSplit .axis-comp ${occurrence}>.as-horizontal 35 65`)).toThrow(/Line 1/);
  }
});

test('Resize the split inside the selected parent occurrence', async ({ app, firstWindow }, testInfo) => {
  test.setTimeout(90000);
  const scenario = testInfo.outputPath('split-parent-occurrence.txt');
  const output = testInfo.outputPath('screenshots');
  await fs.writeFile(scenario, 'fileOpen e2e/mocks/src-screenshots/ExplanatoryAnalysis/AllReports.khj\nscreenshot');
  await runScreenshotScenario(app, firstWindow, scenario, output, screenshotWindowSize);
  await firstWindow.locator('khiops-visualization:visible').evaluate((host) => {
    const root = host.shadowRoot || host;
    const focusTarget = document.createElement('input');
    focusTarget.className = 'scenario-split-focus';
    focusTarget.style.cssText = 'position:fixed;left:100px;top:350px;z-index:2147483647';
    root.appendChild(focusTarget);
    for (let index = 0; index < 2; index++) {
      const parent = document.createElement('scenario-split-group');
      parent.className = 'scenario-split-group';
      parent.style.cssText = `position:fixed;left:${100 + index * 400}px;top:200px;z-index:2147483647`;
      const split = document.createElement('as-split');
      split.className = 'as-horizontal';
      split.style.cssText = 'display:grid;grid-template-columns:1fr 8px 1fr;width:300px;height:80px;background:white';
      const first = document.createElement('as-split-area');
      const gutter = document.createElement('div');
      gutter.className = 'as-split-gutter';
      const second = document.createElement('as-split-area');
      let dragging = false;
      gutter.addEventListener('mousedown', () => { dragging = true; });
      document.addEventListener('mousemove', (event) => {
        if (!dragging) return;
        const box = split.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (event.clientX - box.left - 4) / (box.width - 8)));
        split.style.gridTemplateColumns = `${ratio}fr 8px ${1 - ratio}fr`;
      });
      document.addEventListener('mouseup', () => { dragging = false; });
      split.append(first, gutter, second);
      parent.appendChild(split);
      root.appendChild(parent);
    }
  });
  await fs.writeFile(scenario, 'resizeSplit scenario-split-group 2>as-split 35 65\nscreenshot');
  const focusTarget = firstWindow.locator('.scenario-split-focus');
  const mouseClick = firstWindow.mouse.click;
  const clicks: { x: number; y: number }[] = [];
  firstWindow.mouse.click = async (x, y, options) => {
    clicks.push({ x, y });
    await mouseClick.call(firstWindow.mouse, x, y, options);
  };
  try {
    await focusTarget.focus();
    await runScreenshotScenario(app, firstWindow, scenario, output, screenshotWindowSize);
    await expect(focusTarget).not.toBeFocused();
    await focusTarget.focus();
    await expect(focusTarget).toBeFocused();
    await runScreenshotScenario(app, firstWindow, scenario, output, screenshotWindowSize);
    await expect(focusTarget).not.toBeFocused();
  } finally {
    firstWindow.mouse.click = mouseClick;
  }
  expect(clicks).toEqual([{ x: 1, y: 1 }, { x: 1, y: 1 }]);
  const ratios = await firstWindow.locator('.scenario-split-group as-split').evaluateAll((splits) => splits.map((split) => {
    const areas = split.querySelectorAll(':scope > as-split-area');
    const first = areas[0].getBoundingClientRect().width;
    const second = areas[1].getBoundingClientRect().width;
    return first / (first + second) * 100;
  }));
  expect(ratios[0]).toBeCloseTo(50, 0);
  expect(Math.abs(ratios[1] - 35)).toBeLessThan(1);
});

test('Parse element names as command targets', () => {
  for (const command of ['clickElt kl-button', 'hideElt kl-button', 'removeElt kl-button',
    'firstPlan kl-button', 'clickRow kl-table R11', 'clickChart canvas 0',
    'resizeSplit app-axis>as-split 50 50', 'frame app-axis',
    'annotation app-axis "text"', 'input mat-slider 50', 'shotElt app-axis image.png']) {
    expect(parseScreenshotScenario(command)).toHaveLength(1);
  }
  for (const command of ['clickElt 123target', 'hideElt 123target', 'removeElt 123target',
    'firstPlan 123target', 'clickChart 123target 0', 'input 123target 50']) {
    expect(() => parseScreenshotScenario(command)).toThrow(/Line 1/);
  }
});

test('Require quoted annotation text', () => {
  const commands = parseScreenshotScenario('annotation .target "Add or remove views"\n'
    + 'annotation #target "First line\\nSecond line"\nannotation .target "Say \\"hello\\""\n'
    + 'annotation app-selected-clusters "3 dimensions\\n2 main, 1 contextual"\nannotation div "A label"');
  expect(commands.map((command) => command.argument)).toEqual([
    '.target Add or remove views',
    '#target First line\nSecond line',
    '.target Say "hello"',
    'app-selected-clusters 3 dimensions\n2 main, 1 contextual',
    'div A label',
  ]);
  for (const command of ['annotation .target Add or remove views', 'annotation .target "missing quote',
    'annotation .target ""', 'annotation .target "text" extra', 'annotation 123invalid "text"']) {
    expect(() => parseScreenshotScenario(command)).toThrow(/Line 1/);
  }
});

test('Parse annotation occurrences', () => {
  const commands = parseScreenshotScenario('annotation .target 3 "\\"Class\\" is contextual\\nMore text"\nannotation .target "Default"');
  expect(commands[0].argument).toBe('.target "Class" is contextual\nMore text');
  expect(commands[0].occurrence).toBe(3);
  expect(commands[1].occurrence).toBeUndefined();
  for (const occurrence of ['0', '-1', '1.5', '9007199254740992', 'other']) {
    expect(() => parseScreenshotScenario(`annotation .target ${occurrence} "Label"`)).toThrow(/Line 1/);
  }
});

test('Annotate the requested visible occurrence', async ({ app, firstWindow }, testInfo) => {
  test.setTimeout(90000);
  const scenario = testInfo.outputPath('annotation-occurrence.txt');
  const output = testInfo.outputPath('screenshots');
  await fs.writeFile(scenario, 'fileOpen e2e/mocks/src-screenshots/ExplanatoryAnalysis/AllReports.khj\nscreenshot');
  await runScreenshotScenario(app, firstWindow, scenario, output, screenshotWindowSize);
  await firstWindow.locator('khiops-visualization:visible').evaluate((host) => {
    for (let index = 0; index < 4; index++) {
      const target = document.createElement('div');
      target.className = 'scenario-annotation-occurrence';
      target.style.cssText = `position:fixed;left:${150 + index * 200}px;top:200px;width:100px;height:40px;${index === 0 ? 'display:none;' : ''}`;
      (host.shadowRoot || host).appendChild(target);
    }
  });
  const target = firstWindow.locator('.scenario-annotation-occurrence').filter({ visible: true }).nth(2);
  const targetBox = await target.boundingBox();
  expect(targetBox).not.toBeNull();
  let labelCenter: number | undefined;
  const screenshot = firstWindow.screenshot;
  firstWindow.screenshot = async (options) => {
    labelCenter = await firstWindow.locator('#__screenshot_annotations > div').evaluate((label) => {
      const box = label.getBoundingClientRect();
      return box.left + box.width / 2;
    });
    return screenshot.call(firstWindow, options);
  };
  try {
    await fs.writeFile(scenario, 'annotation 3 .scenario-annotation-occurrence "Third"\nscreenshot');
    await runScreenshotScenario(app, firstWindow, scenario, output, screenshotWindowSize);
  } finally {
    firstWindow.screenshot = screenshot;
  }
  expect(labelCenter).toBeDefined();
  expect(labelCenter!).toBeCloseTo(targetBox!.x + targetBox!.width / 2, 1);
});

test('Parse clean command', () => {
  expect(parseScreenshotScenario('clean')[0].name).toBe('clean');
  expect(() => parseScreenshotScenario('clean .target')).toThrow(/Line 1/);
});

test('Clean queued frames and annotations', async ({ app, firstWindow }, testInfo) => {
  test.setTimeout(90000);
  const scenario = testInfo.outputPath('clean.txt');
  const output = testInfo.outputPath('screenshots');
  await fs.writeFile(scenario, 'fileOpen e2e/mocks/src-screenshots/ExplanatoryAnalysis/AllReports.khj\nscreenshot');
  await runScreenshotScenario(app, firstWindow, scenario, output, screenshotWindowSize);
  await firstWindow.locator('khiops-visualization:visible').evaluate((host) => {
    const target = document.createElement('div');
    target.className = 'scenario-clean-target';
    target.style.cssText = 'position:fixed;left:200px;top:200px;width:100px;height:40px';
    (host.shadowRoot || host).appendChild(target);
  });
  const snapshots: { frames: number; annotation: string | null }[] = [];
  const screenshot = firstWindow.screenshot;
  firstWindow.screenshot = async (options) => {
    snapshots.push(await firstWindow.evaluate(() => ({
      frames: document.querySelectorAll('#__an_overlay rect.an-hit').length,
      annotation: document.querySelector('#__screenshot_annotations')?.textContent ?? null,
    })));
    return screenshot.call(firstWindow, options);
  };
  try {
    await fs.writeFile(scenario, [
      'frame .scenario-clean-target',
      'annotation .scenario-clean-target "Discarded"',
      'clean',
      'clean',
      'screenshot "clean-before.png"',
      'frame .scenario-clean-target',
      'annotation .scenario-clean-target "Kept"',
      'screenshot "kept.png"',
      'frame .scenario-clean-target',
      'annotation .scenario-clean-target "Discarded again"',
      'clean',
      'screenshot "clean-after.png"',
    ].join('\n'));
    await runScreenshotScenario(app, firstWindow, scenario, output, screenshotWindowSize);
  } finally {
    firstWindow.screenshot = screenshot;
  }
  expect(snapshots).toEqual([
    { frames: 0, annotation: null },
    { frames: 1, annotation: 'Kept' },
    { frames: 0, annotation: null },
  ]);
});

test('Keep the annotation caret attached at different zoom levels', async ({ app, firstWindow }, testInfo) => {
  test.setTimeout(90000);
  const scenario = testInfo.outputPath('annotation-caret.txt');
  const output = testInfo.outputPath('screenshots');
  await fs.writeFile(scenario, 'fileOpen e2e/mocks/src-screenshots/ExplanatoryAnalysis/AllReports.khj\nscreenshot');
  await runScreenshotScenario(app, firstWindow, scenario, output, screenshotWindowSize);
  await firstWindow.locator('khiops-visualization:visible').evaluate((host) => {
    const target = document.createElement('div');
    target.className = 'scenario-annotation-target';
    target.style.cssText = 'position:fixed;left:200px;top:200px;width:100px;height:40px';
    (host.shadowRoot || host).appendChild(target);
  });
  const snapshots: { image: Buffer; x: number; y: number; caretBottom: number; viewportWidth: number; viewportHeight: number }[] = [];
  const screenshot = firstWindow.screenshot;
  firstWindow.screenshot = async (options) => {
    const bounds = await firstWindow.evaluate(() => {
      const label = document.querySelector('#__screenshot_annotations > div')!;
      const caret = label.querySelector('span')!.getBoundingClientRect();
      return { x: caret.left + caret.width / 2, y: label.getBoundingClientRect().top, caretBottom: caret.bottom,
        viewportWidth: window.innerWidth, viewportHeight: window.innerHeight };
    });
    const image = await screenshot.call(firstWindow, options);
    snapshots.push({ image, ...bounds });
    return image;
  };
  try {
    await fs.writeFile(scenario, [
      'annotation .scenario-annotation-target "Label"',
      'screenshot "normal.png"',
      'zoomIn',
      'annotation .scenario-annotation-target "Label"',
      'screenshot "zoom.png"',
    ].join('\n'));
    await runScreenshotScenario(app, firstWindow, scenario, output, screenshotWindowSize);
  } finally {
    firstWindow.screenshot = screenshot;
  }
  expect(snapshots).toHaveLength(2);
  for (const { y, caretBottom } of snapshots) {
    expect(caretBottom - y).toBeGreaterThan(0.5);
  }
  const { image, x, y, viewportWidth, viewportHeight } = snapshots[0];
  const pixels = await firstWindow.evaluate(async ({ image, x, y, viewportWidth, viewportHeight }) => {
    const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(image), (character) => character.charCodeAt(0))], { type: 'image/png' }));
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    const pixelX = Math.floor(x * bitmap.width / viewportWidth);
    const pixelY = Math.round(y * bitmap.height / viewportHeight);
    return [-1, 0, 1].map((offset) => Array.from(context.getImageData(pixelX, pixelY + offset, 1, 1).data));
  }, { image: image.toString('base64'), x, y, viewportWidth, viewportHeight });
  for (const pixel of pixels) {
    expect(pixel[0]).toBeGreaterThan(220);
    expect(pixel[1]).toBeGreaterThan(120);
    expect(pixel[1]).toBeLessThan(200);
    expect(pixel[2]).toBeLessThan(50);
  }
});

test('Parse frame tag occurrences', () => {
  for (const command of ['frame app-axis', 'frame app-axis 2',
    'frame #axis', 'frame .axis', 'frame div .axis',
    'frame .cdk-overlay-pane {noId:true, padding: 10px 10px 10px 10px}',
    'frame app-axis 2 {padding: 1px 2px 3px, noId: false}', 'frame app-axis 2 {noId:true} ',
    'frame .axis {badge: number}', 'frame .axis {badge:number, noId:true, padding: 1px}',
    'frame .axis {padding: 1.5px 2px;}', 'frame .axis {padding: 0px}']) {
    expect(parseScreenshotScenario(command)).toHaveLength(1);
  }
  for (const command of ['frame app-axis 0', 'frame app-axis -1', 'frame app-axis 1.5',
    'frame app-axis 9007199254740992', 'frame .axis noId', 'frame .axis {noId:yes}',
    'frame .axis {noId:true, noId:false}', 'frame .axis {padding: 1px, padding: 2px}',
    'frame .axis {padding: -1px}', 'frame .axis {padding: 10}',
    'frame .axis {badge: letter}', 'frame .axis {badge: 1}', 'frame .axis {badge:number, badge:number}',
    'frame .axis {padding: 1px 2px 3px 4px 5px}',
    'frame .axis {padding: 10px', 'frame .axis {margin: 10px}',
    'frame .axis {padding: 1px} {padding: 2px}']) {
    expect(() => parseScreenshotScenario(command)).toThrow(/Line 1/);
  }
});

test('Render frame padding and optional badges', async ({ app, firstWindow }, testInfo) => {
  test.setTimeout(90000);
  const scenario = testInfo.outputPath('frames.txt');
  const output = testInfo.outputPath('screenshots');
  await fs.writeFile(scenario, 'fileOpen e2e/mocks/src-screenshots/ExplanatoryAnalysis/AllReports.khj\nscreenshot');
  await runScreenshotScenario(app, firstWindow, scenario, output, screenshotWindowSize);
  await firstWindow.locator('khiops-visualization:visible').evaluate((host) => {
    for (let index = 0; index < 4; index++) {
      const target = document.createElement('div');
      target.className = 'scenario-frame-test';
      if (index < 2) target.id = 'scenario-frame-duplicate';
      target.style.cssText = `position:fixed;left:${100 + index * 200}px;top:200px;width:100px;height:80px;background:white`;
      (host.shadowRoot || host).appendChild(target);
    }
  });
  const targets = firstWindow.locator('.scenario-frame-test');
  const boxes = await Promise.all([0, 1, 2, 3].map((index) => targets.nth(index).boundingBox()));
  const snapshots: { rectangles: { x: number; y: number; width: number; height: number }[]; badges: { text: string | null; display: string }[] }[] = [];
  const screenshot = firstWindow.screenshot;
  firstWindow.screenshot = async (options) => {
    snapshots.push(await firstWindow.evaluate(() => ({
      rectangles: Array.from(document.querySelectorAll('#__an_overlay rect.an-hit'), (element) => {
        const box = element.getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width, height: box.height };
      }),
      badges: Array.from(document.querySelectorAll('#__an_overlay g > text'), (element) => ({
        text: element.textContent, display: getComputedStyle(element.parentElement!).display,
      })),
    })));
    return screenshot.call(firstWindow, options);
  };
  try {
    await fs.writeFile(scenario, [
      'frame .scenario-frame-test {noId:true, padding: 10px 20px 30px 40px}',
      'frame 2 .scenario-frame-test',
      'frame .scenario-frame-test 3 {noId:true, padding: 5px}',
      'frame .scenario-frame-test 4 {padding: 4px 8px}',
      'frame #scenario-frame-duplicate',
      'screenshot "frames.png"',
      'frame .scenario-frame-test 2 {padding: 1px 2px 3px}',
      'screenshot "next.png"',
      'frame .scenario-frame-test {badge:number}',
      'frame .scenario-frame-test 2',
      'frame .scenario-frame-test 3 {badge:number, noId:true}',
      'frame .scenario-frame-test 4 {badge:number, padding: 4px}',
      'frame #scenario-frame-duplicate',
      'screenshot "mixed.png"',
      'frame .scenario-frame-test {badge:number}',
      'screenshot "number-reset.png"',
    ].join('\n'));
    await runScreenshotScenario(app, firstWindow, scenario, output, screenshotWindowSize);
  } finally {
    firstWindow.screenshot = screenshot;
  }
  expect(snapshots).toHaveLength(4);
  expect(snapshots[0].badges.map(({ text, display }) => display === 'none' ? null : text)).toEqual([null, 'A', null, 'B', 'C']);
  expect(snapshots[1].badges.map(({ text }) => text)).toEqual(['A']);
  expect(snapshots[2].badges.map(({ text, display }) => display === 'none' ? null : text)).toEqual(['1', 'A', null, '2', 'B']);
  expect(snapshots[3].badges.map(({ text }) => text)).toEqual(['1']);
  const expectedPadding = [
    { top: 10, right: 20, bottom: 30, left: 40 },
    { top: 0, right: 0, bottom: 0, left: 0 },
    { top: 5, right: 5, bottom: 5, left: 5 },
    { top: 4, right: 8, bottom: 4, left: 8 },
    { top: 0, right: 0, bottom: 0, left: 0 },
  ];
  for (const [index, padding] of expectedPadding.entries()) {
    const box = boxes[index === 4 ? 0 : index]!;
    const rectangle = snapshots[0].rectangles[index];
    expect(rectangle.x).toBeCloseTo(box.x - padding.left, 1);
    expect(rectangle.y).toBeCloseTo(box.y - padding.top, 1);
    expect(rectangle.width).toBeCloseTo(box.width + padding.left + padding.right, 1);
    expect(rectangle.height).toBeCloseTo(box.height + padding.top + padding.bottom, 1);
  }
  const box = boxes[1]!;
  expect(snapshots[1].rectangles[0].x).toBeCloseTo(box.x - 2, 1);
  expect(snapshots[1].rectangles[0].y).toBeCloseTo(box.y - 1, 1);
  expect(snapshots[1].rectangles[0].width).toBeCloseTo(box.width + 4, 1);
  expect(snapshots[1].rectangles[0].height).toBeCloseTo(box.height + 4, 1);
});

test('Parse input commands', () => {
  expect(parseScreenshotScenario('input .tree-leaf-text-input "NewName"')[0].argument)
    .toBe('.tree-leaf-text-input NewName');
  expect(parseScreenshotScenario('input #name "Say \\"hi\\"\\nnow"')[0].argument)
    .toBe('#name Say "hi"\nnow');
  for (const number of ['6', '-1.5', '.25', '1e3']) {
    expect(parseScreenshotScenario(`input #name ${number}`)[0].argument).toBe(`#name ${number}`);
  }
  for (const command of ['input .name NewName', 'input .name 6abc', 'input .name NaN',
    'input 123name "text"', 'input .name "missing quote', 'input .name']) {
    expect(() => parseScreenshotScenario(command)).toThrow(/Line 1/);
  }
});

test('Use element names for input and element commands', async ({ app, firstWindow }, testInfo) => {
  test.setTimeout(90000);
  const scenario = testInfo.outputPath('element-names.txt');
  const output = testInfo.outputPath('screenshots');
  await fs.writeFile(scenario, 'fileOpen e2e/mocks/src-screenshots/ExplanatoryAnalysis/AllReports.khj\nscreenshot');
  await runScreenshotScenario(app, firstWindow, scenario, output, screenshotWindowSize);
  await firstWindow.locator('khiops-visualization:visible').evaluate((host) => {
    const root = host.shadowRoot || host;
    const container = document.createElement('div');
    container.style.cssText = 'position:fixed;left:200px;top:200px;z-index:2147483647;background:white';
    const button = document.createElement('scenario-element-button');
    button.textContent = 'Click';
    button.addEventListener('click', () => { document.body.dataset.elementClicked = 'yes'; });
    const slider = document.createElement('scenario-element-slider');
    const range = document.createElement('input');
    range.type = 'range';
    range.min = '10';
    range.max = '90';
    range.step = '10';
    range.value = '10';
    slider.appendChild(range);
    const hidden = document.createElement('scenario-element-hide');
    hidden.textContent = 'Hide';
    const removed = document.createElement('scenario-element-remove');
    removed.textContent = 'Remove';
    const table = document.createElement('scenario-element-table');
    const row = document.createElement('div');
    row.setAttribute('role', 'row');
    row.textContent = 'Unique R11';
    row.addEventListener('click', () => { document.body.dataset.elementRowClicked = 'yes'; });
    table.appendChild(row);
    container.append(button, slider, hidden, removed, table);
    root.appendChild(container);
  });
  await fs.writeFile(scenario, [
    'clickElt scenario-element-button',
    'input scenario-element-slider 50',
    'hideElt scenario-element-hide',
    'removeElt scenario-element-remove',
    'clickRow scenario-element-table R11',
    'screenshot',
  ].join('\n'));
  await runScreenshotScenario(app, firstWindow, scenario, output, screenshotWindowSize);
  await expect(firstWindow.locator('body')).toHaveAttribute('data-element-clicked', 'yes');
  await expect(firstWindow.locator('body')).toHaveAttribute('data-element-row-clicked', 'yes');
  await expect(firstWindow.locator('scenario-element-slider input')).toHaveValue('50');
  await expect(firstWindow.locator('scenario-element-hide')).toBeHidden();
  await expect(firstWindow.locator('scenario-element-remove')).toHaveCount(0);
});

test('Set the matrix contrast when other sliders are visible', async ({ app, firstWindow }, testInfo) => {
  test.setTimeout(90000);
  const scenario = testInfo.outputPath('matrix-slider.txt');
  const output = testInfo.outputPath('screenshots');
  await fs.writeFile(scenario, [
    'fileOpen e2e/mocks/src-screenshots/Covisualization/IV-AdultComplete.khcj',
    'input #contrast 50',
    'screenshot',
  ].join('\n'));
  await runScreenshotScenario(app, firstWindow, scenario, output, screenshotWindowSize);
  const slider = firstWindow.locator('khiops-covisualization:visible').locator('#contrast mat-slider').filter({ visible: true }).first();
  await expect(slider.locator('input').first()).toHaveValue('50');
});

test('Fill a hidden unfolding input', async ({ app, firstWindow }, testInfo) => {
  test.setTimeout(90000);
  const scenario = testInfo.outputPath('hidden-input.txt');
  await fs.writeFile(scenario, [
    'fileOpen e2e/mocks/src-screenshots/Covisualization/IV-AdultComplete.khcj',
    'clickElt .button-unfold-hierarchy',
    'input #cy-unfold-value-input 6',
    'clickElt #cy-unfold-value-button',
    'screenshot',
  ].join('\n'));
  await runScreenshotScenario(app, firstWindow, scenario, testInfo.outputPath('screenshots'), screenshotWindowSize);
  await expect(firstWindow.locator('#unfold-hierarchy-settings kl-important-badge')).toHaveText('6');
});

test('Set and save the unfolding slider', async ({ app, firstWindow }, testInfo) => {
  test.setTimeout(90000);
  const scenario = testInfo.outputPath('unfold-slider.txt');
  const output = testInfo.outputPath('screenshots');
  await fs.writeFile(scenario, [
    'fileOpen e2e/mocks/src-screenshots/screenshots/CoclusteringAdult_Uidocs_Coclustering.khcj',
    'clickElt .button-unfold-hierarchy',
    'input .unfold-hierarchy-settings-slider 6',
    'screenshot',
  ].join('\n'));
  await runScreenshotScenario(app, firstWindow, scenario, output, screenshotWindowSize);
  await expect(firstWindow.locator('#unfold-hierarchy-settings kl-important-badge')).toHaveText('6');
  await firstWindow.locator('.button-confirm-hierarchy').click();
  await expect(firstWindow.locator('#unfold-hierarchy-settings')).toBeHidden({ timeout: 30000 });
  await fs.writeFile(scenario, 'clickElt .button-unfold-hierarchy\nscreenshot');
  await runScreenshotScenario(app, firstWindow, scenario, output, screenshotWindowSize);
  await expect(firstWindow.locator('#unfold-hierarchy-settings kl-important-badge')).toHaveText('6');
});

test('Parse unfocus command', () => {
  expect(parseScreenshotScenario('unfocus').map((command) => command.name)).toEqual(['unfocus']);
  expect(() => parseScreenshotScenario('unfocus .target')).toThrow(/Line 1/);
});

test('Parse setVisibility commands', () => {
  const commands = parseScreenshotScenario('setVisibility isHierarchyChecked true\nsetVisibility #sym:isClustersChecked 2 false');
  expect(commands.map((command) => command.argument)).toEqual([
    'isHierarchyChecked 1 true',
    'isClustersChecked 2 false',
  ]);
  for (const invalid of ['setVisibility unknownFlag true', 'setVisibility isChecked 0 true',
    'setVisibility isChecked yes', 'setVisibility isChecked']) {
    expect(() => parseScreenshotScenario(invalid)).toThrow(/Line 1/);
  }
});

test('Parse class click occurrences', () => {
  for (const command of ['clickElt .box-distribution', 'clickElt .box-distribution 1',
    'clickElt .box-distribution 2', 'clickElt 2 .box-distribution', 'clickElt #box-distribution 2']) {
    expect(parseScreenshotScenario(command)).toHaveLength(1);
  }
  for (const command of ['clickElt .box-distribution 0', 'clickElt .box-distribution -1',
    'clickElt .box-distribution 1.5', 'clickElt .box-distribution 9007199254740992', 'clickElt 2 .box-distribution 2']) {
    expect(() => parseScreenshotScenario(command)).toThrow(/Line 1/);
  }
});

test('Parse text click commands', () => {
  for (const command of ['clickElt "C1"', 'clickElt "C1" 2', 'clickElt 2 "C1"', 'clickElt "Say \\"hi\\"\\nnow"']) {
    expect(parseScreenshotScenario(command)).toHaveLength(1);
  }
  for (const command of ['clickElt ""', 'clickElt "   "', 'clickElt "\\n"', 'clickElt "C1', 'clickElt 2 "C1" 2']) {
    expect(() => parseScreenshotScenario(command)).toThrow(/Line 1/);
  }
});

test('Parse target occurrence prefixes', () => {
  for (const command of [
    'openTab 2 Context', 'clickRow 2 #table R11', 'clickElt 2 .target',
    'hideElt 2 .target', 'removeElt 2 .target', 'firstPlan 2 .target',
    'clickChart 2 #chart 0', 'resizeSplit 2 .split 50 50', 'frame 2 .target',
    'annotation 2 .target "Label"', 'input 2 .target 6', 'shotElt 2 .target "image.png"',
    'setVisibility 2 isChecked true',
  ]) {
    expect(parseScreenshotScenario(command)[0].occurrence, command).toBe(2);
  }
  for (const command of [
    'clickElt 0 .target', 'removeElt -1 .target', 'input 1.5 .target "value"',
    'shotElt 9007199254740992 .target "image.png"', 'frame 2 .target 3',
    'annotation 2 .target 3 "Label"', 'input 2 .target 3 "value"',
    'resizeSplit 2 .split 3 50 50', 'setVisibility 2 isChecked 3 true',
  ]) {
    expect(() => parseScreenshotScenario(command), command).toThrow(/Line 1/);
  }
  expect(parseScreenshotScenario('input .target 6')[0].argument).toBe('.target 6');
  expect(parseScreenshotScenario('clickChart #chart 2')[0].argument).toBe('#chart 2');
});

test('Apply target occurrences to click, input, hide and remove', async ({ app, firstWindow }, testInfo) => {
  test.setTimeout(90000);
  const scenario = testInfo.outputPath('target-occurrences.txt');
  const output = testInfo.outputPath('screenshots');
  await fs.writeFile(scenario, 'fileOpen e2e/mocks/src-screenshots/ExplanatoryAnalysis/AllReports.khj\nscreenshot');
  await runScreenshotScenario(app, firstWindow, scenario, output, screenshotWindowSize);
  await firstWindow.locator('khiops-visualization:visible').evaluate((host) => {
    const root = host.shadowRoot || host;
    for (let index = 0; index < 3; index++) {
      const container = document.createElement('div');
      container.style.cssText = `position:fixed;left:${200 + index * 200}px;top:200px;z-index:2147483647;background:white`;
      const button = document.createElement('button');
      button.className = 'occurrence-click';
      button.textContent = `Click ${index}`;
      button.addEventListener('click', () => { document.body.dataset.occurrenceClick = String(index); });
      const input = document.createElement('input');
      input.className = 'occurrence-input';
      const hidden = document.createElement('div');
      hidden.className = 'occurrence-hide';
      hidden.textContent = `Hide ${index}`;
      const removed = document.createElement('div');
      removed.className = 'occurrence-remove';
      removed.textContent = `Remove ${index}`;
      container.append(button, input, hidden, removed);
      root.appendChild(container);
    }
  });
  await fs.writeFile(scenario, [
    'clickElt 2 .occurrence-click',
    'input .occurrence-input 2 "second"',
    'hideElt 2 .occurrence-hide',
    'removeElt .occurrence-remove 2',
    'screenshot',
  ].join('\n'));
  await runScreenshotScenario(app, firstWindow, scenario, output, screenshotWindowSize);
  await expect(firstWindow.locator('body')).toHaveAttribute('data-occurrence-click', '1');
  const inputs = firstWindow.locator('.occurrence-input');
  await expect(inputs.nth(0)).toHaveValue('');
  await expect(inputs.nth(1)).toHaveValue('second');
  const hidden = firstWindow.locator('.occurrence-hide');
  await expect(hidden.nth(0)).toBeVisible();
  await expect(hidden.nth(1)).toBeHidden();
  await expect(hidden.nth(2)).toBeVisible();
  await expect(firstWindow.locator('.occurrence-remove')).toHaveText(['Remove 0', 'Remove 2']);
});

test('Click the element containing matching text', async ({ app, firstWindow }, testInfo) => {
  test.setTimeout(90000);
  const scenario = testInfo.outputPath('text-click.txt');
  const output = testInfo.outputPath('screenshots');
  await fs.writeFile(scenario, 'fileOpen e2e/mocks/src-screenshots/ExplanatoryAnalysis/AllReports.khj\nscreenshot');
  await runScreenshotScenario(app, firstWindow, scenario, output, screenshotWindowSize);
  await firstWindow.locator('khiops-visualization:visible').evaluate((host) => {
    const root = host.shadowRoot || host;
    for (const [id, hidden] of [['hidden', true], ['first', false], ['second', false]] as const) {
      const parent = document.createElement('div');
      parent.style.cssText = `position:fixed;top:200px;left:200px;${hidden ? 'display:none;' : ''}`;
      const child = document.createElement('span');
      child.textContent = 'Unique C1 test cluster';
      child.addEventListener('click', (event) => {
        event.stopPropagation();
        document.body.dataset.textClick = id;
      });
      parent.appendChild(child);
      root.appendChild(parent);
    }
  });
  await fs.writeFile(scenario, 'clickElt "Unique C1"\nscreenshot');
  await runScreenshotScenario(app, firstWindow, scenario, output, screenshotWindowSize);
  await expect(firstWindow.locator('body')).toHaveAttribute('data-text-click', 'first');
});

test('Select a context cluster by text', async ({ app, firstWindow }, testInfo) => {
  test.setTimeout(90000);
  const scenario = testInfo.outputPath('text-cluster.txt');
  const output = testInfo.outputPath('screenshots');
  await fs.writeFile(scenario, [
    'fileOpen e2e/mocks/src-screenshots/Covisualization/2-Iris3vars-Coclustering.khcj',
    'openTab Context',
    'screenshot',
  ].join('\n'));
  await runScreenshotScenario(app, firstWindow, scenario, output, screenshotWindowSize);
  const cluster = firstWindow.locator('khiops-covisualization:visible').getByText('C1').filter({ visible: true }).first();
  await expect(cluster).toHaveClass(/tree-leaf-text/);
  await cluster.locator('..').evaluate((element) => element.classList.remove('tree-selected'));
  await fs.writeFile(scenario, 'clickElt "C1"\nscreenshot');
  await runScreenshotScenario(app, firstWindow, scenario, output, screenshotWindowSize);
  await expect(cluster.locator('..')).toHaveClass(/tree-selected/);
});

test('Capture an element at different zoom levels', async ({ app, firstWindow }, testInfo) => {
  test.setTimeout(90000);
  const scenario = testInfo.outputPath('zoom.txt');
  const output = testInfo.outputPath('screenshots');
  await fs.writeFile(scenario, 'fileOpen e2e/mocks/src-screenshots/ExplanatoryAnalysis/AllReports.khj\nscreenshot');
  await runScreenshotScenario(app, firstWindow, scenario, output, screenshotWindowSize);
  await firstWindow.locator('khiops-visualization:visible').evaluate((host) => {
    const root = host.shadowRoot || host;
    const decoy = document.createElement('div');
    decoy.id = 'scenario-zoom-target';
    decoy.style.cssText = 'position:fixed;left:10px;top:80px;width:75px;height:31px;background:blue';
    root.appendChild(decoy);
    const hidden = document.createElement('scenario-zoom-target');
    hidden.className = 'scenario-zoom-test';
    hidden.style.display = 'none';
    root.appendChild(hidden);
    const target = document.createElement('scenario-zoom-target');
    target.className = 'scenario-zoom-test';
    target.style.cssText = 'position:fixed;right:10px;top:80px;width:75px;height:31px;background:rgb(255,0,0);z-index:2147483647';
    root.appendChild(target);
    const second = document.createElement('scenario-zoom-target');
    second.className = 'scenario-zoom-test';
    second.style.cssText = 'position:fixed;left:100px;top:80px;width:75px;height:31px;background:blue;z-index:2147483647';
    root.appendChild(second);
  });
  await fs.writeFile(scenario, [
    'zoomOut', 'shotElt .scenario-zoom-test "zoom-out.png"',
    'zoomIn', 'shotElt .scenario-zoom-test "normal.png"',
    'shotElt 2 .scenario-zoom-test "second.png"',
    'shotElt .scenario-zoom-test 2 "second-padded.png" {padding:2px}',
    'shotElt scenario-zoom-target 2 "tag-second.png" {size:30x20}',
    'shotElt scenario-zoom-target "tag.png" {padding:5px}',
    'zoomIn', 'shotElt .scenario-zoom-test "zoom-in.png"',
    'zoomOut', 'screenshot "full.jpg"',
    'shotElt .scenario-zoom-test "element.JPEG"',
    'shotElt .scenario-zoom-test "size.jpg" {size:30x20}',
    'shotElt .scenario-zoom-test "padding.jpg" {padding:2px}',
    'zoomOut', 'shotElt .scenario-zoom-test "zoom.jpg"',
  ].join('\n'));
  await runScreenshotScenario(app, firstWindow, scenario, output, screenshotWindowSize);
  for (const filename of ['zoom-out.png', 'normal.png', 'zoom-in.png', 'tag.png',
    'second.png', 'second-padded.png', 'tag-second.png']) {
    const image = (await fs.readFile(path.join(output, filename))).toString('base64');
    const pixel = await firstWindow.evaluate(async (encoded) => {
      const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0))], { type: 'image/png' }));
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(bitmap, 0, 0);
      return Array.from(context.getImageData(Math.floor(bitmap.width / 2), Math.floor(bitmap.height / 2), 1, 1).data);
    }, image);
    expect(pixel, filename).toEqual(filename.includes('second') ? [0, 0, 255, 255] : [255, 0, 0, 255]);
  }
  for (const filename of ['full.jpg', 'element.JPEG', 'size.jpg', 'padding.jpg', 'zoom.jpg']) {
    const image = await fs.readFile(path.join(output, filename));
    expect(image.subarray(0, 3), filename).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    const dimensions = await firstWindow.evaluate(async (encoded) => {
      const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0))], { type: 'image/jpeg' }));
      return { width: bitmap.width, height: bitmap.height };
    }, image.toString('base64'));
    expect(dimensions.width, filename).toBeGreaterThan(0);
    expect(dimensions.height, filename).toBeGreaterThan(0);
  }
});

test('Fade element screenshot edges to white', async ({ app, firstWindow }, testInfo) => {
  test.setTimeout(90000);
  const scenario = testInfo.outputPath('fade.txt');
  const output = testInfo.outputPath('screenshots');
  await fs.writeFile(scenario, 'fileOpen e2e/mocks/src-screenshots/ExplanatoryAnalysis/AllReports.khj\nscreenshot');
  await runScreenshotScenario(app, firstWindow, scenario, output, screenshotWindowSize);
  await firstWindow.locator('khiops-visualization:visible').evaluate((host) => {
    const background = document.createElement('div');
    background.style.cssText = 'position:fixed;left:100px;top:100px;width:120px;height:120px;background:rgb(255,0,0);z-index:2147483647';
    const target = document.createElement('div');
    target.className = 'scenario-fade-test';
    target.style.cssText = 'position:absolute;left:20px;top:20px;width:80px;height:80px';
    background.appendChild(target);
    (host.shadowRoot || host).appendChild(background);
    const white = document.createElement('div');
    white.className = 'scenario-fade-white-test';
    white.style.cssText = 'position:fixed;left:300px;top:100px;width:80px;height:80px;background:white;z-index:2147483647';
    (host.shadowRoot || host).appendChild(white);
  });
  await fs.writeFile(scenario, [
    'shotElt .scenario-fade-test "plain.png"',
    'shotElt .scenario-fade-test "zero.png" {fade:0px}',
    'shotElt .scenario-fade-test "fade.png" {fade:20px}',
    'shotElt .scenario-fade-white-test "white.png" {fade:20px}',
    'shotElt .scenario-fade-test "wide.png" {fade:200px}',
    'shotElt .scenario-fade-test "padding.png" {padding:10px, fade:20px}',
    'shotElt .scenario-fade-test "size.jpg" {size:60x60, fade:20px}',
    'zoomIn',
    'shotElt .scenario-fade-test "zoom.png" {fade:20px}',
  ].join('\n'));
  await runScreenshotScenario(app, firstWindow, scenario, output, screenshotWindowSize);
  for (const filename of ['plain.png', 'zero.png', 'fade.png', 'white.png', 'wide.png', 'padding.png', 'size.jpg', 'zoom.png']) {
    const image = (await fs.readFile(path.join(output, filename))).toString('base64');
    const pixels = await firstWindow.evaluate(async ({ image, jpeg }) => {
      const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(image), (character) => character.charCodeAt(0))], { type: jpeg ? 'image/jpeg' : 'image/png' }));
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(bitmap, 0, 0);
      const pixel = (x: number, y: number) => Array.from(context.getImageData(x, y, 1, 1).data);
      const x = Math.floor(bitmap.width / 2);
      const y = Math.floor(bitmap.height / 2);
      return [pixel(x, y), pixel(0, y), pixel(bitmap.width - 1, y), pixel(x, 0), pixel(x, bitmap.height - 1),
        pixel(Math.floor(bitmap.width * 0.1), y)];
    }, { image, jpeg: filename.endsWith('.jpg') });
    if (filename === 'white.png') {
      for (const pixel of pixels) {
        for (const channel of pixel.slice(0, 3)) expect(channel, filename).toBeGreaterThan(245);
      }
      continue;
    }
    for (const pixel of pixels) expect(pixel[0], filename).toBeGreaterThan(245);
    expect(pixels[0][1], filename).toBeLessThan(15);
    if (filename === 'plain.png' || filename === 'zero.png') {
      for (const pixel of pixels) expect(pixel[1], filename).toBeLessThan(15);
    } else {
      for (const pixel of pixels.slice(1, 5)) expect(pixel[1], filename).toBeGreaterThan(220);
      expect(pixels[5][1], filename).toBeGreaterThan(50);
      expect(pixels[5][1], filename).toBeLessThan(220);
    }
  }
});

test('Bring an element above a modal dialog', async ({ app, firstWindow }, testInfo) => {
  test.setTimeout(90000);
  const scenario = testInfo.outputPath('foreground.txt');
  const output = testInfo.outputPath('screenshots');
  await fs.writeFile(scenario, 'fileOpen e2e/mocks/src-screenshots/ExplanatoryAnalysis/AllReports.khj\nscreenshot');
  await runScreenshotScenario(app, firstWindow, scenario, output, screenshotWindowSize);
  await firstWindow.locator('khiops-visualization:visible').evaluate((host) => {
    const container = document.createElement('div');
    container.style.cssText = 'position:fixed;left:100px;top:100px;display:flex;z-index:9999';
    const button = document.createElement('scenario-foreground-button');
    button.className = 'scenario-foreground-test';
    button.style.cssText = 'width:100px;height:40px;background:rgb(255,0,0);border:0;padding:0';
    button.addEventListener('click', () => { document.body.dataset.scenarioForegroundClicked = 'yes'; });
    const sibling = document.createElement('span');
    sibling.className = 'scenario-foreground-sibling';
    sibling.style.cssText = 'width:20px;height:40px';
    container.append(button, sibling);
    (host.shadowRoot || host).appendChild(container);
    const modal = document.createElement('dialog');
    modal.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;max-width:none;max-height:none;margin:0;padding:0;border:0;background:rgb(0,0,255)';
    document.body.appendChild(modal);
    modal.showModal();
  });
  const target = firstWindow.locator('.scenario-foreground-test');
  const sibling = firstWindow.locator('.scenario-foreground-sibling');
  const before = await target.boundingBox();
  const siblingBefore = await sibling.boundingBox();
  await fs.writeFile(scenario, 'firstPlan scenario-foreground-button\nscreenshot "foreground.png"');
  await runScreenshotScenario(app, firstWindow, scenario, output, screenshotWindowSize);
  expect(await target.boundingBox()).toEqual(before);
  expect(await sibling.boundingBox()).toEqual(siblingBefore);
  expect(await target.evaluate((element) => element.matches(':popover-open'))).toBe(true);
  await target.evaluate((element: HTMLElement) => element.click());
  await expect(firstWindow.locator('body')).toHaveAttribute('data-scenario-foreground-clicked', 'yes');
  const image = (await fs.readFile(path.join(output, 'foreground.png'))).toString('base64');
  const pixel = await firstWindow.evaluate(async ({ image, x, y }) => {
    const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(image), (character) => character.charCodeAt(0))], { type: 'image/png' }));
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    return Array.from(context.getImageData(x, y, 1, 1).data);
  }, { image, x: Math.floor(before!.x + before!.width / 2), y: Math.floor(before!.y + before!.height / 2) });
  expect(pixel).toEqual([255, 255, 255, 255]);
});
