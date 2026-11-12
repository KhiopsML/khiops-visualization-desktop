# Commands

## Screenshot scenarios

Start the development server with `yarn ng:serve:dev`, then run
`yarn e2e:screenshots`. This runs the descriptive, supervised, elements,
histograms, and regression visualization scenarios. PNG files are written
to `e2e/screenshots`.
If port 4200 is occupied, start `yarn ng serve -c dev --port 4201` and set
`E2E_APP_URL=http://localhost:4201` for the test process.
Set `SCREENSHOT_SCENARIO` to run a single scenario and `SCREENSHOT_OUTPUT`
to change the output directory; relative paths are resolved from the desktop
project root.
Set `screenshotWindowSize` in `e2e/screenshot-playwright.config.ts` to change
the Electron window size used by screenshot scenarios.

Screenshot scenarios are excluded from the standard E2E suite. On GitHub,
run the **Screenshot Scenarios** workflow manually to generate a separate
`screenshot-scenarios` artifact. The workflow accepts one scenario path and
checks out the visualization repository beside the desktop repository.
The scenario helper tests run with the standard E2E suite; run them separately
with `yarn e2e screenshot-scenario-helper`.

Scenario commands are one per line. Blank lines and lines beginning with `#`
are ignored. `fileOpen` takes an absolute path or a path relative to the
desktop project root and waits for the load notification to disappear.
`openTab` takes the exact visible tab name. `clickRow`
clicks the unique visible row containing the supplied text, for example `clickRow R11`.
To scope the search to one table, include its ID: `clickRow #preparation-variables-list R11`.
`clickElt .kl-icon-cell-comp-btn` clicks the first visible element with that class;
`clickElt .box-distribution 2` clicks the second visible element with that class.
Class occurrence numbers start at 1. If no visible match exists, `clickElt` dispatches
the click on the first attached match, so it works on elements with `display: none`.
If a visible target is covered by another element and the pointer click is blocked for 3 seconds,
`clickElt` also dispatches the click on that target.
`clickElt #kl-icon-cell-comp-btn` clicks the visible element with that ID.
`hideElt #level-distribution-btn` hides the visible element with that ID;
`hideElt .class-elt` hides all visible elements with that class.
Hidden elements no longer occupy layout space.
`firstPlan .button-manage-views` brings the first visible matching element above
open dialogs with a white background, keeping its current screen position. IDs require a `#` prefix.
Run it after opening the dialog.
`removeElt #app-var-details-preparation-2d-comp-variables-lists` removes elements
with that ID from the DOM. `removeElt .class-elt` removes all elements with that
class, including hidden elements.
If the element is the only child of an Angular Split area, the area is also
removed. When one area remains, it fills the split.
`shotElt #header-tools-comp "images/Top Right Buttons.png"` captures the unique visible
element with that ID to the relative PNG path in the screenshot output directory.
`shotElt .ag-grid-comp-header-tools "TopRightPanelAButtons.png"`
captures the first visible element with that class. An optional `WxH` size after the
path, such as `shotElt #header-right "UnfoldHierarchy.png" {size:600x200}`, captures a region of exactly
that size starting at the element's top-left corner instead of the element's bounds. An optional
`{padding: 10px 10px 10px 10px}` (CSS shorthand, pixels) grows the captured area around the element by those
amounts; it cannot be combined with `{size:WxH}`. As with `screenshot`, directories
are created as needed and unquoted filenames without spaces are supported. Queued frames and annotations
are applied to the capture and cleared, as with `screenshot`; only the portion
within the captured element is visible.
`clickChart #distribution-chart-0 1` clicks the chart's bar at zero-based index 1.
`zoomOut` decreases the window's zoom by one step, like View > Zoom Out.
`zoomIn` increases the window's zoom by one step, like View > Zoom In.
`refreshDom` resizes the window briefly and restores its original size.
`unfocus` clicks the top-left corner of the window to remove focus from the current element.
`setVisibility <property> [occurrence] <true|false>` sets a view-layout flag (for example `isHierarchyChecked`, `isClustersChecked`, `isCompositionChecked`) in the manage-views dialog. The `#sym:` prefix is optional. The occurrence is 1-based and defaults to 1. The command opens the dialog only when a change is needed, then saves it.
`wait 500` pauses the scenario for 500 milliseconds.
`resizeSplit #app-var-details-preparation-comp 50 50` resizes the two areas of a split;
`resizeSplit #app-var-details-preparation-comp 50 50` resizes the two areas of a split;
`resizeSplit .as-horizontal 100 0` targets the first visible split with that class.
Selectors can be chained with `>`, for example `resizeSplit .axis-comp>.as-horizontal 100 0`.
The split may be vertical or horizontal; the percentages must total 100. Open CDK overlays (such as a filter menu) are closed with `Escape` first, because their backdrop would otherwise block the drag.
`frame`
takes an element ID prefixed with `#`, a class prefixed with `.`, or a Playwright
CSS selector. By default, `frame` selects the first visible match, including
when multiple elements share the same ID. Add a 1-based occurrence number to
select another visible match, for example `frame app-axis 2`. The command queues a rectangle around the
selected element. Append `card` (for example, `frame #variable-graph-details-comp card`)
to frame the nearest `.kl-card` ancestor, including the element itself. If no card exists,
the selected element is used. Append `noId` to hide the orange letter badge, and
`{padding: 10px 10px 10px 10px}` to expand the frame by the specified top, right,
bottom, and left padding. Padding accepts one to four non-negative pixel values,
using CSS shorthand rules. For example:
`frame .cdk-overlay-pane noId {padding: 10px 10px 10px 10px}`.
Frames without a badge do not consume a letter.
`input .tree-leaf-text-input "NewName"` fills the text input inside the first visible
element matching the ID or class (or the element itself, if it is an input). The text must be quoted;
`\n` and `\"` are supported.
`annotation .button-manage-views "Add or remove views"`
queues a text label; its text must be quoted. Use `\n` for a line break and `\"`
for a quote within the text.
`screenshot "images-khiops-guides/visualization/images/Visualization Adult Evaluation.png"`
captures a PNG under the screenshot output directory, creating subdirectories as
needed. Paths must be relative and cannot contain parent-directory segments.
Without a filename, files are numbered. Unquoted filenames without spaces are also supported.
Annotations are cleared after each screenshot.
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
