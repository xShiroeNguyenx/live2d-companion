import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ScannedModel } from '@shared/types/workspace';

/**
 * Folder-of-models scanning, kept free of Electron so it can be tested directly.
 *
 * A "library" is any folder the user points at that holds many models, usually
 * one per subfolder but often nested a few levels deep (`Name/runtime/x.model3.json`
 * is how Cubism Editor exports). Scanning only lists files; nothing is copied
 * until the user clicks a model.
 */

/** How deep below the chosen folder a model3.json may sit. */
export const LIBRARY_MAX_DEPTH = 5;
/** Stops a mis-click on a drive root from walking the whole disk. */
export const LIBRARY_MAX_MODELS = 2000;
/** Folders that never hold a model but can hold a great many files. */
const SKIPPED_DIRS = new Set(['node_modules', '$recycle.bin', 'system volume information']);

export interface LibraryWalk {
  models: ScannedModel[];
  /** True when the scan stopped at LIBRARY_MAX_MODELS. */
  truncated: boolean;
}

export function displayNameFor(modelSettingPath: string): string {
  return path.basename(modelSettingPath).replace(/\.model3\.json$/i, '');
}

export function slugify(value: string): string {
  return (
    value
      .normalize('NFKD')
      .replace(/[^\w.-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'model'
  );
}

/**
 * The workspace a model imports into. Deterministic, so a library entry can be
 * matched against an earlier import of the same folder without copying again.
 */
export function workspaceIdFor(modelSettingPath: string): string {
  const sourceDir = path.dirname(modelSettingPath);
  const hash = createHash('sha1').update(sourceDir).digest('hex').slice(0, 8);
  return `${slugify(displayNameFor(modelSettingPath))}-${hash}`;
}

export async function scanModelLibrary(
  rootDir: string,
  maxDepth = LIBRARY_MAX_DEPTH,
  maxModels = LIBRARY_MAX_MODELS
): Promise<LibraryWalk> {
  const models: ScannedModel[] = [];
  let truncated = false;

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (truncated) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      // An unreadable subfolder (permissions, a broken junction) should not
      // hide every other model in the library.
      return;
    }
    // Sorted so the list order is stable between scans and machines.
    entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.model3.json')) continue;
      if (models.length >= maxModels) {
        truncated = true;
        return;
      }
      const full = path.join(dir, entry.name);
      models.push({
        modelSettingPath: full,
        displayName: displayNameFor(full),
        relativeDir: path.relative(rootDir, dir).split(path.sep).join('/')
      });
    }

    if (depth >= maxDepth) return;
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      if (SKIPPED_DIRS.has(entry.name.toLowerCase())) continue;
      await walk(path.join(dir, entry.name), depth + 1);
      if (truncated) return;
    }
  };

  await walk(rootDir, 0);
  return { models, truncated };
}

/**
 * The texture to preview a library model by: the first one its model3.json
 * lists, resolved against the model's folder.
 *
 * Returns null when the setting file is unreadable, lists no texture, or points
 * outside the model's folder: the path comes from a file on disk, and a preview
 * has no business reading anything beyond the model it belongs to.
 */
export async function thumbnailTextureFor(modelSettingPath: string): Promise<string | null> {
  let texture: unknown;
  try {
    const setting = JSON.parse(await fs.readFile(modelSettingPath, 'utf8')) as {
      FileReferences?: { Textures?: unknown[] };
    };
    texture = setting.FileReferences?.Textures?.[0];
  } catch {
    return null;
  }
  if (typeof texture !== 'string' || texture.length === 0) return null;

  const modelDir = path.dirname(modelSettingPath);
  const full = path.resolve(modelDir, texture);
  const relative = path.relative(modelDir, full);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return full;
}
