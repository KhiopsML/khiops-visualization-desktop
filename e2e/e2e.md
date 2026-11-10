# Commands

## Screenshot scenarios

Start the development server with `yarn ng:serve:dev`, then run
`yarn e2e:screenshots`. The default scenario is
`e2e/scenarios/demo.txt` and PNG files are written to `e2e/screenshots`.
If port 4200 is occupied, start `yarn ng serve -c dev --port 4201` and set
`E2E_APP_URL=http://localhost:4201` for the test process.
Set `SCREENSHOT_SCENARIO` and `SCREENSHOT_OUTPUT` to override these paths;
relative paths are resolved from the desktop project root.

Screenshot scenarios are excluded from the standard E2E suite. On GitHub,
run the **Screenshot Scenarios** workflow manually to generate a separate
`screenshot-scenarios` artifact. The workflow checks out the visualization
repository beside the desktop repository for the default scenario's input file.

Scenario commands are one per line. Blank lines and lines beginning with `#`
are ignored. `fileOpen` takes an absolute path or a path relative to the
desktop project root. `openTab` takes the exact visible tab name. `clickRow`
clicks the unique visible row containing the supplied text, for example `clickRow R11`.
To scope the search to one table, include its ID: `clickRow preparation-variables-list R11`.
`clickChart distribution-chart-0 1` clicks the chart's bar at zero-based index 1.
`frame`
takes an element ID without `#`, or a Playwright CSS selector, and queues a
rectangle around that element. Append `card` (for example, `frame variable-graph-details-comp card`)
to frame the nearest `.kl-card` ancestor, including the element itself. If no card exists,
the selected element is used. `screenshot` optionally takes a PNG filename;
otherwise files are numbered. Annotations are cleared after each screenshot.
Targets must be uniquely visible in the active visualization.

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
