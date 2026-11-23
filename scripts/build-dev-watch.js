const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const desktopDir = path.resolve(__dirname, '..');
const componentDir = path.resolve(desktopDir, '..', 'khiops-visualization');
const outputDir = path.join(componentDir, 'dist', 'khiops-webcomponent');
const outputs = ['main.js', 'styles.css'].map((file) => path.join(outputDir, file));
const children = [];
let stopping = false;
let readinessTimer;

function stop(code) {
  if (stopping) return;
  stopping = true;
  clearInterval(readinessTimer);
  process.exitCode = code;
  console.log('Cleaning up processes...');
  for (const child of children) {
    if (!child.pid) continue;
    if (process.platform === 'win32') {
      const result = spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
      });
      if (result.error) console.error(`Failed to stop process ${child.pid}: ${result.error.message}`);
    } else {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch (error) {
        if (error.code !== 'ESRCH') {
          console.error(`Failed to stop process ${child.pid}: ${error.message}`);
        }
      }
    }
  }
}

function start(command, args, cwd, shell = false) {
  const child = spawn(command, args, {
    cwd,
    stdio: 'inherit',
    shell,
    detached: process.platform !== 'win32',
  });
  children.push(child);
  child.on('error', (error) => {
    console.error(`ERROR: Failed to start ${command}: ${error.message}`);
    stop(1);
  });
  child.on('exit', (code, signal) => {
    if (!stopping) {
      console.error(`ERROR: ${command} exited unexpectedly (${signal || code}).`);
      stop(code || 1);
    }
  });
}

function updateFile(file, replacements) {
  const original = fs.readFileSync(file, 'utf8');
  let updated = original;
  for (const [pattern, replacement] of replacements) {
    updated = updated.replace(pattern, replacement);
  }
  if (updated !== original) fs.writeFileSync(file, updated);
}

function main() {
  if (!fs.existsSync(componentDir)) {
    throw new Error(`khiops-visualization was not found at ${componentDir}.`);
  }
  if (!fs.existsSync(path.join(componentDir, 'node_modules', '.yarn-state.yml'))) {
    throw new Error(`Dependencies are missing in ${componentDir}. Run "yarn install" there first.`);
  }
  const angularCli = require.resolve('@angular/cli/bin/ng.js', { paths: [componentDir] });

  updateFile(path.join(desktopDir, 'angular.json'), [
    [/"styles": \["src\/styles.scss"\]/g, '"styles": ["../khiops-visualization/dist/khiops-webcomponent/styles.css", "src/styles.scss"]'],
    [/"scripts": \[\]/g, '"scripts": ["../khiops-visualization/dist/khiops-webcomponent/main.js"]'],
  ]);
  updateFile(path.join(desktopDir, 'src', 'app', 'app.component.ts'), [
    [/^import 'khiops-visualization';/m, "// import 'khiops-visualization';"],
  ]);

  for (const output of outputs) fs.rmSync(output, { force: true });
  start(process.execPath, [angularCli, 'build', 'khiops-webcomponent', '--configuration=development', '--source-map', '--watch'], componentDir);

  console.log('Waiting for webcomponents build to be ready...');
  console.log(`Watching: ${outputs.join(', ')}`);
  const deadline = Date.now() + 600_000;
  let previousSizes = '';
  let stableCount = 0;
  readinessTimer = setInterval(() => {
    if (Date.now() >= deadline) {
      console.error('ERROR: webcomponents build did not produce main.js and styles.css within 600s.');
      stop(1);
      return;
    }
    try {
      const sizes = outputs.map((file) => fs.statSync(file).size);
      const currentSizes = sizes.join(',');
      stableCount = sizes.every((size) => size > 0) && currentSizes === previousSizes ? stableCount + 1 : 0;
      previousSizes = currentSizes;
      if (stableCount >= 3) {
        clearInterval(readinessTimer);
        console.log('Webcomponents build is ready. Starting the application...');
        start('yarn start', [], desktopDir, true);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error(`ERROR: Cannot check webcomponents build: ${error.message}`);
        stop(1);
      }
      previousSizes = '';
      stableCount = 0;
    }
  }, 1000);
}

process.on('SIGINT', () => stop(130));
process.on('SIGTERM', () => stop(143));

try {
  main();
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  stop(1);
}
