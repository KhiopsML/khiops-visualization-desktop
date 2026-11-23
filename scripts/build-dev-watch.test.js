const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'khiops-dev-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const desktop = path.join(root, 'khiops-visualization-desktop');
  const component = path.join(root, 'khiops-visualization');
  const scripts = path.join(desktop, 'scripts');
  const app = path.join(desktop, 'src', 'app');
  fs.mkdirSync(scripts, { recursive: true });
  fs.mkdirSync(app, { recursive: true });
  fs.mkdirSync(component);
  fs.copyFileSync(path.join(__dirname, 'build-dev-watch.js'), path.join(scripts, 'build-dev-watch.js'));
  fs.writeFileSync(path.join(desktop, 'angular.json'), '{"styles": ["src/styles.scss"], "scripts": []}');
  fs.writeFileSync(path.join(app, 'app.component.ts'), "import 'khiops-visualization';\n");
  return { root, desktop, component, script: path.join(scripts, 'build-dev-watch.js') };
}

function installFakeCli(component, source) {
  const modules = path.join(component, 'node_modules');
  const cli = path.join(modules, '@angular', 'cli', 'bin');
  fs.mkdirSync(cli, { recursive: true });
  fs.writeFileSync(path.join(modules, '.yarn-state.yml'), '');
  fs.writeFileSync(path.join(cli, 'ng.js'), source);
}

test('reports missing component dependencies without changing desktop files', (t) => {
  const { desktop, script } = fixture(t);
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Dependencies are missing.*yarn install/);
  assert.equal(fs.readFileSync(path.join(desktop, 'angular.json'), 'utf8'), '{"styles": ["src/styles.scss"], "scripts": []}');
});

test('fails promptly when the component build exits', (t) => {
  const { component, script } = fixture(t);
  installFakeCli(component, 'process.exit(7);');
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 7);
  assert.match(result.stderr, /exited unexpectedly/);
});

test('starts desktop only after both build outputs are ready', (t) => {
  const { root, component, script } = fixture(t);
  installFakeCli(component, `
    const fs = require('node:fs');
    fs.mkdirSync('dist/khiops-webcomponent', { recursive: true });
    fs.writeFileSync('dist/khiops-webcomponent/main.js', 'main');
    setTimeout(() => fs.writeFileSync('dist/khiops-webcomponent/styles.css', 'styles'), 1500);
    setInterval(() => {}, 1000);
  `);
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  const yarn = path.join(bin, process.platform === 'win32' ? 'yarn.cmd' : 'yarn');
  fs.writeFileSync(yarn, process.platform === 'win32'
    ? '@echo off\r\nif not exist ..\\khiops-visualization\\dist\\khiops-webcomponent\\styles.css exit /b 2\r\necho DESKTOP_STARTED\r\nexit /b 0\r\n'
    : '#!/bin/sh\ntest -f ../khiops-visualization/dist/khiops-webcomponent/styles.css || exit 2\necho DESKTOP_STARTED\nexit 0\n');
  fs.chmodSync(yarn, 0o755);
  const result = spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    timeout: 15000,
    env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` },
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /Webcomponents build is ready[\s\S]*DESKTOP_STARTED/);
  assert.ok(fs.existsSync(path.join(component, 'dist', 'khiops-webcomponent', 'styles.css')));
});
