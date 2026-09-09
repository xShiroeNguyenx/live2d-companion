/**
 * Starts the dev server and the app fully detached from the calling shell.
 *
 * `npm run dev` is a child of whatever shell started it, so when that shell
 * exits — which happens when an agent's background task finishes — the whole
 * tree goes with it and the window the user was about to test disappears.
 * Detaching keeps the app alive for a hands-on session.
 *
 * Usage: node scripts/launch-detached.js   (stop it with npm run dev:stop)
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const logDir = path.join(projectRoot, '.dev');
fs.mkdirSync(logDir, { recursive: true });

const logPath = path.join(logDir, 'dev.log');
const pidPath = path.join(logDir, 'dev.pid');
const out = fs.openSync(logPath, 'w');

const env = { ...process.env };
// Set when a shell is itself an Electron process running as Node; it would make
// our Electron start as plain Node, with no `app` object.
delete env.ELECTRON_RUN_AS_NODE;

// Invoke electron-vite's own script with the current Node rather than the npm
// wrapper: spawning a .cmd needs a shell, and Node 20 refuses that without
// `shell: true`, which then breaks detaching.
const electronVite = path.join(projectRoot, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js');

const child = spawn(process.execPath, [electronVite, 'dev'], {
  cwd: projectRoot,
  env,
  detached: true,
  stdio: ['ignore', out, out],
  windowsHide: false
});

fs.writeFileSync(pidPath, String(child.pid), 'utf8');
// Let the parent exit without waiting for, or killing, the child.
child.unref();

console.log(`dev server + app started detached (pid ${child.pid})`);
console.log(`log:  ${logPath}`);
console.log('stop: npm run dev:stop');
