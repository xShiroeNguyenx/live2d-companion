import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Where workspaces live, and the file operations that move them around.
 *
 * Kept free of Electron so it can be tested directly: every path it needs is
 * handed in by the caller.
 */

/** Subfolder created when the user picks a folder that already holds other things. */
export const WORKSPACES_SUBFOLDER = 'Live2DCompanion Workspaces';

const SETTINGS_NAME = 'storage-settings.json';
const MANIFEST_NAME = '.l2dproj.json';

interface StorageSettings {
  workspaceRoot?: string;
}

/**
 * The workspace root to use when the user has never chosen one.
 *
 * Early builds kept workspaces under Documents, which on many machines is
 * synced by OneDrive. New installs use the app's data folder instead, but an
 * existing Documents folder is kept so nobody's imported models vanish.
 */
export function defaultWorkspaceRoot(
  legacyRoot: string,
  userDataRoot: string,
  legacyExists: boolean
): string {
  return legacyExists ? legacyRoot : path.join(userDataRoot, 'workspaces');
}

/**
 * Why a folder cannot become the new workspace root, or null when it can.
 *
 * Nesting the new root inside the current one would move workspaces into a
 * folder that is itself being emptied.
 */
export function newRootProblem(currentRoot: string, candidate: string): string | null {
  const from = path.resolve(currentRoot);
  const to = path.resolve(candidate);
  if (samePath(from, to)) return 'Đây đã là thư mục lưu trữ hiện tại.';
  if (isInside(from, to)) return 'Không thể chọn thư mục nằm bên trong thư mục lưu trữ hiện tại.';
  return null;
}

/**
 * The root a picked folder turns into.
 *
 * A folder that is empty or already holds workspaces is used as is; anything
 * else gets a dedicated subfolder, so picking `D:\` does not scatter hundreds
 * of workspace folders across the drive root.
 */
export function rootForPickedFolder(
  picked: string,
  entries: Array<{ name: string; isWorkspace: boolean }>
): string {
  if (entries.length === 0 || entries.some((entry) => entry.isWorkspace)) return picked;
  return path.join(picked, WORKSPACES_SUBFOLDER);
}

export async function readStorageSettings(settingsDir: string): Promise<StorageSettings> {
  try {
    const raw = await fs.readFile(path.join(settingsDir, SETTINGS_NAME), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object') {
      const root = (parsed as StorageSettings).workspaceRoot;
      return typeof root === 'string' && root.length > 0 ? { workspaceRoot: root } : {};
    }
    return {};
  } catch {
    return {};
  }
}

export async function writeStorageSettings(
  settingsDir: string,
  settings: StorageSettings
): Promise<void> {
  await fs.mkdir(settingsDir, { recursive: true });
  const target = path.join(settingsDir, SETTINGS_NAME);
  const temporary = `${target}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(settings, null, 2), 'utf8');
  await fs.rename(temporary, target);
}

/** Lists a folder's entries, marking the ones that are workspaces. Missing folder → empty. */
export async function describeFolder(
  dir: string
): Promise<Array<{ name: string; isWorkspace: boolean }>> {
  let entries: Array<import('node:fs').Dirent>;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const described: Array<{ name: string; isWorkspace: boolean }> = [];
  for (const entry of entries) {
    const isWorkspace =
      entry.isDirectory() && (await pathExists(path.join(dir, entry.name, MANIFEST_NAME)));
    described.push({ name: entry.name, isWorkspace });
  }
  return described;
}

/** Total size in bytes of every file under a folder. Unreadable entries count as zero. */
export async function directorySize(dir: string): Promise<number> {
  let entries: Array<import('node:fs').Dirent>;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let total = 0;
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await directorySize(full);
    } else if (entry.isFile()) {
      try {
        total += (await fs.stat(full)).size;
      } catch {
        // A file removed mid-walk simply does not count.
      }
    }
  }
  return total;
}

/** Free bytes on the drive holding `dir` (or its nearest existing parent), null if unknown. */
export async function freeBytesAt(dir: string): Promise<number | null> {
  let probe = path.resolve(dir);
  for (;;) {
    try {
      const stats = await fs.statfs(probe);
      return Number(stats.bavail) * Number(stats.bsize);
    } catch {
      const parent = path.dirname(probe);
      if (parent === probe) return null;
      probe = parent;
    }
  }
}

/**
 * Moves one workspace folder to a new parent.
 *
 * A rename is instant on the same drive. Across drives it fails with EXDEV, so
 * the folder is copied and the original removed only once the copy finished;
 * a failed copy is cleaned up and the original left untouched.
 */
export async function moveFolder(source: string, target: string): Promise<void> {
  if (await pathExists(target)) throw new Error('Thư mục đích đã có workspace cùng tên.');
  await fs.mkdir(path.dirname(target), { recursive: true });
  try {
    await fs.rename(source, target);
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
  }
  try {
    await fs.cp(source, target, { recursive: true, errorOnExist: true, force: false });
  } catch (error) {
    await fs.rm(target, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
  await fs.rm(source, { recursive: true, force: true });
}

export async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function samePath(a: string, b: string): boolean {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}
