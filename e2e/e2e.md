# Commands

## Screenshot scenarios

Start the development server with `yarn ng:serve:dev`, then run
`yarn e2e:screenshots`. The default scenario is
`e2e/scenarios/demo.txt` and PNG files are written to `e2e/screenshots`.
If port 4200 is occupied, start `yarn ng serve -c dev --port 4201` and set
`E2E_APP_URL=http://localhost:4201` for the test process.
Set `SCREENSHOT_SCENARIO` and `SCREENSHOT_OUTPUT` to override these paths;
relative paths are resolved from the desktop project root.
Set `screenshotWindowSize` in `e2e/screenshot-playwright.config.ts` to change
the Electron window size used by screenshot scenarios.

Screenshot scenarios are excluded from the standard E2E suite. On GitHub,
run the **Screenshot Scenarios** workflow manually to generate a separate
`screenshot-scenarios` artifact. The workflow checks out the visualization
repository beside the desktop repository for the default scenario's input file.

Scenario commands are one per line. Blank lines and lines beginning with `#`
are ignored. `fileOpen` takes an absolute path or a path relative to the
desktop project root. `openTab` takes the exact visible tab name. `clickRow`
clicks the unique visible row containing the supplied text, for example `clickRow R11`.
To scope the search to one table, include its ID: `clickRow preparation-variables-list R11`.
`clickElt .kl-icon-cell-comp-btn` clicks the first visible element with that class;
`clickElt kl-icon-cell-comp-btn` clicks the visible element with that ID.
`hideElt level-distribution-btn` hides the visible element with that ID;
`hideElt .class-elt` hides all visible elements with that class. An optional `#`
prefix is supported for IDs. Hidden elements no longer occupy layout space.
`removeElt app-var-details-preparation-2d-comp-variables-lists` removes elements
with that ID from the DOM. `removeElt .class-elt` removes all elements with that
class, including hidden elements. An optional `#` prefix is supported for IDs.
If the element is the only child of an Angular Split area, the area is also
removed. When one area remains, it fills the split.
`shotElt header-tools-comp TopRightButtons.png` captures the unique visible element
with that ID to the named PNG file in the screenshot output directory. An optional
`#` prefix is supported. `shotElt .ag-grid-comp-header-tools TopRightPanelAButtons.png`
captures the first visible element with that class. Queued frames and annotations
remain for the next `screenshot`.
`clickChart distribution-chart-0 1` clicks the chart's bar at zero-based index 1.
`zoomOut` decreases the window's zoom by one step, like View > Zoom Out.
`zoomIn` increases the window's zoom by one step, like View > Zoom In.
`refreshDom` resizes the window briefly and restores its original size.
`wait 500` pauses the scenario for 500 milliseconds.
`resizeSplit app-var-details-preparation-comp 50 50` resizes the two areas of a vertical split;
the percentages must total 100.
`frame`
takes an element ID without `#`, or a Playwright CSS selector, and queues a
rectangle around that element. Append `card` (for example, `frame variable-graph-details-comp card`)
to frame the nearest `.kl-card` ancestor, including the element itself. If no card exists,
the selected element is used. `screenshot` optionally takes a PNG filename;
otherwise files are numbered. Annotations are cleared after each screenshot.
Frame targets must be uniquely visible in the active visualization.

## yarn playwright test

Runs the end-to-end tests.

## yarn playwright test --ui

Starts the interactive UI mode.

## yarn playwright test --project=chromium

Runs the tests only on Desktop Chrome.

## yarn playwright test example

Runs the tests in a specific file.

## yarn playwright test --debug

Runs the tests in debug mode.

## yarn playwright codegen

Auto generate tests with Codegen.
