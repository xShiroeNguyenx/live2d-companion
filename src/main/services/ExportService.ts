import fs from 'node:fs/promises';
import path from 'node:path';
import type { ExportRequest, ExportResult } from '@shared/types/export';
import type { WorkspaceService } from './WorkspaceService';

/** App-private entries that must never appear in an exported model. */
const PRIVATE_ENTRIES = new Set(['.l2dproj.json', '.backups', '.layers']);

/**
 * Copies a workspace's `working/` tree out as a plain Live2D model folder.
 *
 * Export is a copy rather than a move or an in-place write because the
 * workspace stays editable afterwards, and because the destination is the only
 * place outside the workspace this app ever writes.
 */
export class ExportService {
  constructor(private readonly workspaces: WorkspaceService) {}

  async export(request: ExportRequest): Promise<ExportResult> {
    try {
      const sourceDir = this.workspaces.getWorkingDir(request.workspaceId);
      const target = path.join(request.destinationDir, sanitiseFolderName(request.folderName));

      // Refuse to write inside the workspace itself, which would recurse.
      const workspaceRoot = path.dirname(sourceDir);
      if (isInside(workspaceRoot, target)) {
        return {
          ok: false,
          error: 'Không thể xuất vào bên trong workspace. Hãy chọn thư mục khác.'
        };
      }

      const exists = await pathExists(target);
      if (exists && !request.overwrite) {
        return {
          ok: false,
          error: `Thư mục đã tồn tại: ${target}`
        };
      }

      // Copy into a temporary sibling first, then swap. A failure part-way
      // through therefore cannot leave the user with a half-written model where
      // a complete one used to be.
      const staging = `${target}.exporting-${Date.now().toString(36)}`;
      await fs.mkdir(staging, { recursive: true });
      try {
        const fileCount = await copyFiltered(sourceDir, staging);

        if (exists) {
          const retired = `${target}.replaced-${Date.now().toString(36)}`;
          await fs.rename(target, retired);
          try {
            await fs.rename(staging, target);
          } catch (error) {
            // Put the original back rather than leaving nothing behind.
            await fs.rename(retired, target).catch(() => undefined);
            throw error;
          }
          await fs.rm(retired, { recursive: true, force: true });
        } else {
          await fs.rename(staging, target);
        }

        return { ok: true, exportedPath: target, fileCount };
      } catch (error) {
        await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
        throw error;
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

/** Copies a tree, skipping the app's own bookkeeping files. */
async function copyFiltered(sourceDir: string, targetDir: string): Promise<number> {
  let count = 0;
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    if (PRIVATE_ENTRIES.has(entry.name)) continue;
    // Skip leftovers from an interrupted atomic write.
    if (entry.isFile() && /\.tmp-[0-9a-f]{8}$/i.test(entry.name)) continue;

    const source = path.join(sourceDir, entry.name);
    const target = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      await fs.mkdir(target, { recursive: true });
      count += await copyFiltered(source, target);
    } else if (entry.isFile()) {
      await fs.copyFile(source, target);
      count += 1;
    }
  }
  return count;
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function isInside(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * Makes a user-supplied folder name safe for the filesystem.
 *
 * Only the characters Windows actually rejects are stripped: spaces, dashes and
 * non-ASCII letters are all legal, and a model named "Hiyori - ban sua" should
 * keep its name.
 */
export function sanitiseFolderName(name: string): string {
  // Spelled out as a set rather than a regex character class, because such a
  // class needs escaping that is easy to get subtly wrong, and a mistake here
  // either mangles legitimate names or lets through a character that makes the
  // folder unopenable.
  const forbidden = new Set(['<', '>', ':', '"', '/', '|', '?', '*', String.fromCharCode(92)]);

  const cleaned = [...name]
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      // Control codes are rejected by the filesystem as well.
      return !forbidden.has(character) && code > 31;
    })
    .join('')
    // Windows silently drops trailing dots and spaces, which would leave the
    // created folder named differently from what the user typed.
    .replace(/[. ]+$/, '')
    .trim();

  return cleaned || 'live2d-model';
}
