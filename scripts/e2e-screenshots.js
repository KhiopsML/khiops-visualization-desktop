const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const [scenarioArg, ...extraArgs] = process.argv.slice(2);
const env = { ...process.env };

if (scenarioArg) {
  const candidates = [
    path.resolve(scenarioArg),
    path.join(root, scenarioArg),
    path.join(root, 'e2e', scenarioArg),
    path.join(root, 'e2e', 'scenarios', scenarioArg),
  ];
  const found = candidates.find((c) => fs.existsSync(c) && fs.statSync(c).isFile());
  if (!found) {
    console.error(`Scenario not found: ${scenarioArg}`);
    process.exit(1);
  }
  env.SCREENSHOT_SCENARIO = path.relative(root, found);
}

const result = spawnSync(
  'yarn',
  ['playwright', 'test', '-c', 'e2e/screenshot-playwright.config.ts', ...extraArgs],
  { cwd: root, env, stdio: 'inherit', shell: true },
);
process.exit(result.status === null ? 1 : result.status);
