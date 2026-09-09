/**
 * Captures a screenshot of each editor tab, for reviewing the UI without
 * clicking through the app by hand.
 *
 * Usage: npm run build && node scripts/ui-shots.js
 */
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const driver = path.join(__dirname, 'ui-shots-driver.js');
const electronBinary = path.join(
  projectRoot,
  'node_modules',
  'electron',
  'dist',
  process.platform === 'win32' ? 'electron.exe' : 'electron'
);

fs.mkdirSync(path.join(projectRoot, '.smoke'), { recursive: true });

const env = { ...process.env, NODE_ENV: 'production' };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronBinary, [driver], { cwd: projectRoot, env, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 1));
