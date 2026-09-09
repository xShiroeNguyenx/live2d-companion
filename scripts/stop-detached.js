/**
 * Stops the detached dev session started by launch-detached.js.
 *
 * The recorded pid belongs to the electron-vite process, which spawns Electron
 * as a grandchild and may already have exited on its own — so killing the pid
 * alone can leave the app window running. This walks the process table instead
 * and stops every Electron whose executable is this project's, which is both
 * more reliable and safe for other Electron apps the user has open.
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const pidPath = path.join(projectRoot, '.dev', 'dev.pid');
const electronExe = path.join(
  projectRoot,
  'node_modules',
  'electron',
  'dist',
  process.platform === 'win32' ? 'electron.exe' : 'electron'
);

function killTree(pid) {
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      process.kill(-pid, 'SIGTERM');
    }
    return true;
  } catch {
    return false;
  }
}

let stopped = 0;

// The recorded pid first, in case the dev server is still alive.
if (fs.existsSync(pidPath)) {
  const pid = Number(fs.readFileSync(pidPath, 'utf8').trim());
  if (Number.isFinite(pid) && killTree(pid)) stopped += 1;
  fs.rmSync(pidPath, { force: true });
}

// Then any Electron still running from this project's binary.
if (process.platform === 'win32') {
  try {
    const csv = execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        // Match on the executable path so other Electron apps are untouched.
        `Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | ` +
          `Where-Object { $_.ExecutablePath -eq '${electronExe.replace(/'/g, "''")}' } | ` +
          `Select-Object -ExpandProperty ProcessId`
      ],
      { encoding: 'utf8' }
    );
    for (const line of csv.split(/\r?\n/)) {
      const pid = Number(line.trim());
      if (Number.isFinite(pid) && pid > 0 && killTree(pid)) stopped += 1;
    }
  } catch {
    // No matching process, or PowerShell unavailable; nothing more to do.
  }
}

console.log(stopped > 0 ? `stopped ${stopped} process tree(s)` : 'nothing was running');
