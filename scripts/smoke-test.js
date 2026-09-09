/**
 * Runs the smoke driver under the Electron binary.
 *
 * Separate from smoke-driver.js because that file must be Electron's entry
 * point, and because `ELECTRON_RUN_AS_NODE` has to be stripped from the
 * environment here — when it is set (some IDE terminals set it), Electron
 * starts as plain Node and `app` is undefined.
 *
 * Usage: npm run build && npm run smoke
 */
const path = require('node:path');
const { spawn } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const electronBinary = path.join(
  projectRoot,
  'node_modules',
  'electron',
  'dist',
  process.platform === 'win32' ? 'electron.exe' : 'electron'
);

const env = { ...process.env, NODE_ENV: 'production' };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronBinary, [path.join(__dirname, 'smoke-driver.js')], {
  cwd: projectRoot,
  env,
  stdio: 'inherit'
});

child.on('exit', (code) => process.exit(code ?? 1));
