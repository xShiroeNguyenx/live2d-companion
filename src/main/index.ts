import path from 'node:path';
import { BrowserWindow, app, shell } from 'electron';
import { registerWorkspaceIpc } from './ipc/registerWorkspaceIpc';
import { ExportService } from './services/ExportService';
import { WorkspaceService } from './services/WorkspaceService';
import {
  defaultWorkspaceRoot,
  pathExists,
  readStorageSettings,
  writeStorageSettings
} from './services/workspaceStorage';

const isDev = !app.isPackaged;

/**
 * Sample models ship beside the app so a first run has something to open.
 *
 * In a packaged build they live in the resources directory. Unpackaged, they are
 * resolved relative to this bundle (`out/main/`) rather than via
 * `app.getAppPath()`, because that returns the directory of whatever entry
 * script Electron was given — which differs when the smoke-test driver boots
 * the app.
 */
function resolveSampleModelDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'sample-models')
    : path.resolve(__dirname, '..', '..', 'resources', 'sample-models');
}

/**
 * Packaged builds take their icon from the executable (electron-builder bakes
 * `build/icon.png` in); unpackaged runs would otherwise show Electron's default.
 */
function resolveWindowIcon(): string | undefined {
  return app.isPackaged ? undefined : path.resolve(__dirname, '..', '..', 'build', 'icon.png');
}

/**
 * The workspace root chosen by the user, or the default when there is none.
 *
 * Settings live in userData, never in the workspace root itself, because the
 * root is exactly the thing that can move.
 */
async function resolveWorkspaceRoot(): Promise<string> {
  const settings = await readStorageSettings(app.getPath('userData'));
  if (settings.workspaceRoot) return settings.workspaceRoot;
  const legacyRoot = path.join(app.getPath('documents'), 'Live2DCompanion', 'workspaces');
  return defaultWorkspaceRoot(legacyRoot, app.getPath('userData'), await pathExists(legacyRoot));
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    icon: resolveWindowIcon(),
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    backgroundColor: '#1b1d23',
    title: 'Live2D Companion Studio',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  window.once('ready-to-show', () => window.show());

  // Keep navigation inside the app; anything external opens in the real browser.
  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
  if (isDev && devServerUrl) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  return window;
}

void app.whenReady().then(async () => {
  const workspaces = new WorkspaceService(await resolveWorkspaceRoot(), (rootDir) =>
    writeStorageSettings(app.getPath('userData'), { workspaceRoot: rootDir })
  );
  registerWorkspaceIpc(workspaces, new ExportService(workspaces), resolveSampleModelDir());

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
