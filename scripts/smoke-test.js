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
const fs = require('node:fs');
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

if (!fs.existsSync(electronBinary)) {
  console.error(`SMOKE FAIL: no Electron binary at ${electronBinary}`);
  console.error('Run `npm ci` first — the postinstall step downloads it.');
  process.exit(1);
}

const child = spawn(electronBinary, [path.join(__dirname, 'smoke-driver.js')], {
  cwd: projectRoot,
  env,
  stdio: 'inherit'
});

child.on('error', (error) => {
  console.error(`SMOKE FAIL: could not start Electron — ${error.message}`);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  // Electron exiting immediately with no output of its own almost always means
  // a missing system library rather than a failed assertion — the driver prints
  // its own diagnosis for everything else. On a bare CI image that is a silent
  // exit code 1, which is what made this take so long to place the first time.
  if (code !== 0) {
    const how = signal ? `signal ${signal}` : `exit code ${code}`;
    console.error(`SMOKE FAIL: Electron ended with ${how}.`);
    if (process.platform === 'linux') {
      console.error(
        'On Linux this is usually a missing library: Electron needs libgtk-3,',
        'libnss3, libasound2, libgbm and an X server (xvfb-run).'
      );
    }
  }
  process.exit(code ?? 1);
});
