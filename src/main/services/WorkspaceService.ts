import { randomUUID } from 'node:crypto';
import { nativeImage } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  ChangeStorageRootResult,
  ImportProbe,
  ImportResult,
  LibraryScan,
  ProjectManifest,
  StorageMoveProgress,
  StorageRootCandidate,
  StorageUsage,
  WorkspaceFile,
  WorkspaceSummary
} from '@shared/types/workspace';
import type { Model3Json } from '@shared/types/live2d-files';
import type { OpenedWorkspace, WriteJsonRequest } from '@shared/ipc-contract';
import {
  displayNameFor,
  scanModelLibrary,
  thumbnailTextureFor,
  workspaceIdFor
} from './modelLibrary';
import {
  describeFolder,
  directorySize,
  freeBytesAt,
  moveFolder,
  newRootProblem,
  rootForPickedFolder
} from './workspaceStorage';

/** Edge of the square library thumbnails, sized for a 2x display. */
const THUMBNAIL_SIZE = 96;

const MANIFEST_NAME = '.l2dproj.json';
const ORIGINAL_DIR = 'original';
const WORKING_DIR = 'working';
const BACKUP_DIR = '.backups';
const BACKUPS_PER_FILE = 10;

/** moc3 files start with the ASCII magic "MOC3". */
const MOC3_MAGIC = Buffer.from('MOC3', 'ascii');

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * Owns every write this app performs.
 *
 * The guarantee it exists to provide: the folder the user imported from is
 * opened read-only, once, and never written to. All editing happens on a copy
 * inside the workspace, and `original/` keeps a pristine second copy so
 * "revert" is always possible even after autosave has overwritten `working/`.
 */
export class WorkspaceService {
  private rootDir: string;
  /** Set while workspaces are being moved; every write is refused until it clears. */
  private moving = false;

  /**
   * @param rootDir Folder holding every workspace.
   * @param persistRoot Saves a newly chosen root so the next start uses it.
   */
  constructor(
    rootDir: string,
    private readonly persistRoot: (rootDir: string) => Promise<void> = async () => undefined
  ) {
    this.rootDir = rootDir;
  }

  getStorageRoot(): string {
    return this.rootDir;
  }

  /** Bytes used per workspace and in total, plus the free space left on that drive. */
  async storageUsage(): Promise<StorageUsage> {
    const workspaces = await this.listWorkspaces();
    const workspaceBytes: Record<string, number> = {};
    let totalBytes = 0;
    for (const summary of workspaces) {
      const bytes = await directorySize(summary.workspacePath);
      workspaceBytes[summary.id] = bytes;
      totalBytes += bytes;
    }
    return {
      rootDir: this.rootDir,
      totalBytes,
      workspaceBytes,
      freeBytes: await freeBytesAt(this.rootDir)
    };
  }

  /** Turns a folder the user picked into the root that would be used, without applying it. */
  async resolveStorageCandidate(picked: string): Promise<StorageRootCandidate> {
    const rootDir = rootForPickedFolder(picked, await describeFolder(picked));
    const problem = newRootProblem(this.rootDir, rootDir);
    return problem ? { ok: false, error: problem } : { ok: true, rootDir };
  }

  /**
   * Switches to a new workspace root, optionally moving every workspace there.
   *
   * Workspaces are moved one at a time, so a failure part-way leaves each one
   * whole in exactly one place. The root switches even then, and the ones left
   * behind are reported by id so the user knows where they are.
   */
  async changeStorageRoot(
    newRoot: string,
    moveExisting: boolean,
    onProgress?: (progress: StorageMoveProgress) => void
  ): Promise<ChangeStorageRootResult> {
    const target = path.resolve(newRoot);
    const problem = newRootProblem(this.rootDir, target);
    if (problem) return { ok: false, rootDir: this.rootDir, moved: 0, failed: [], error: problem };
    if (this.moving) {
      return { ok: false, rootDir: this.rootDir, moved: 0, failed: [], error: 'Đang chuyển dữ liệu.' };
    }

    this.moving = true;
    const failed: Array<{ id: string; error: string }> = [];
    let moved = 0;
    try {
      await fs.mkdir(target, { recursive: true });
      if (moveExisting) {
        const workspaces = await this.listWorkspaces();
        for (const [index, summary] of workspaces.entries()) {
          onProgress?.({ done: index, total: workspaces.length, current: summary.displayName });
          try {
            await moveFolder(summary.workspacePath, path.join(target, path.basename(summary.workspacePath)));
            moved += 1;
          } catch (error) {
            failed.push({ id: summary.id, error: error instanceof Error ? error.message : String(error) });
          }
        }
        onProgress?.({ done: workspaces.length, total: workspaces.length, current: '' });
      }
      await this.persistRoot(target);
      this.rootDir = target;
      return { ok: true, rootDir: target, moved, failed };
    } catch (error) {
      return {
        ok: false,
        rootDir: this.rootDir,
        moved,
        failed,
        error: error instanceof Error ? error.message : String(error)
      };
    } finally {
      this.moving = false;
    }
  }

  /**
   * Deletes a workspace: its edited copy, the pristine copy and the backups.
   * The folder the model was imported from is not touched.
   */
  async deleteWorkspace(workspaceId: string): Promise<{ ok: boolean; error?: string }> {
    try {
      this.assertNotMoving();
      const workspacePath = this.resolveWorkspace(workspaceId);
      // Only ever remove a folder this app created; the manifest is the proof.
      if (!(await this.readManifest(workspacePath))) {
        return { ok: false, error: `Không phải workspace hợp lệ: ${workspaceId}` };
      }
      await fs.rm(workspacePath, { recursive: true, force: true });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private assertNotMoving(): void {
    if (this.moving) throw new Error('Đang chuyển thư mục lưu trữ, hãy thử lại sau khi xong.');
  }

  /** Inspect a dropped folder or file without copying anything yet. */
  async probeImport(target: string): Promise<ImportProbe> {
    try {
      const stat = await fs.stat(target);
      if (stat.isFile()) {
        if (target.toLowerCase().endsWith('.model3.json')) {
          return { ok: true, candidates: [target], cubism2Detected: false };
        }
        return {
          ok: false,
          candidates: [],
          cubism2Detected: false,
          error: 'Hãy chọn file .model3.json hoặc thư mục chứa model.'
        };
      }

      const candidates = await this.findModelSettings(target, 0);
      if (candidates.length > 0) {
        return { ok: true, candidates, cubism2Detected: false };
      }

      // No model3.json: check whether this is a Cubism 2 model, which uses a
      // different core we are not licensed to bundle.
      const cubism2 = await this.hasCubism2Model(target);
      return {
        ok: false,
        candidates: [],
        cubism2Detected: cubism2,
        error: cubism2
          ? 'Đây là model Cubism 2 (.moc). App chỉ hỗ trợ Cubism 3/4/5 (.moc3).'
          : 'Không tìm thấy file .model3.json trong thư mục này.'
      };
    } catch (error) {
      return {
        ok: false,
        candidates: [],
        cubism2Detected: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /** Copy a model into a fresh workspace. The source is only read. */
  async importModel(modelSettingPath: string): Promise<ImportResult> {
    try {
      this.assertNotMoving();
      const sourceDir = path.dirname(modelSettingPath);
      const settingRaw = await fs.readFile(modelSettingPath, 'utf8');
      const setting = JSON.parse(settingRaw) as Model3Json;

      const referenced = this.collectReferencedFiles(setting);
      const missingFiles: string[] = [];
      for (const relative of referenced) {
        if (!(await exists(path.join(sourceDir, relative)))) missingFiles.push(relative);
      }

      const mocPath = path.join(sourceDir, setting.FileReferences.Moc);
      if (!(await exists(mocPath))) {
        return { ok: false, error: `Thiếu file moc: ${setting.FileReferences.Moc}` };
      }
      const mocVersion = await this.readMocVersion(mocPath);
      if (mocVersion === null) {
        return { ok: false, error: 'File .moc3 không hợp lệ (sai magic header).' };
      }

      const displayName = displayNameFor(modelSettingPath);
      const workspaceId = workspaceIdFor(modelSettingPath);
      const workspacePath = path.join(this.rootDir, workspaceId);

      await fs.mkdir(workspacePath, { recursive: true });
      // Two copies on purpose: `working/` is edited, `original/` is the escape hatch.
      await fs.cp(sourceDir, path.join(workspacePath, WORKING_DIR), { recursive: true });
      await fs.cp(sourceDir, path.join(workspacePath, ORIGINAL_DIR), { recursive: true });
      await fs.mkdir(path.join(workspacePath, BACKUP_DIR), { recursive: true });

      const now = new Date().toISOString();
      const manifest: ProjectManifest = {
        formatVersion: 1,
        id: workspaceId,
        displayName,
        sourcePath: sourceDir,
        importedAt: now,
        lastOpenedAt: now,
        modelSettingFile: path.basename(modelSettingPath),
        mocVersion
      };
      await this.writeManifest(workspacePath, manifest);

      return {
        ok: true,
        workspace: {
          id: workspaceId,
          displayName,
          workspacePath,
          modelSettingFile: manifest.modelSettingFile,
          lastOpenedAt: now
        },
        missingFiles: missingFiles.length > 0 ? missingFiles : undefined
      };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Lists every model under a folder of many models, marking the ones already
   * imported. Only reads directory listings, so a library of hundreds is quick.
   */
  async scanLibrary(rootDir: string): Promise<LibraryScan> {
    try {
      const stat = await fs.stat(rootDir);
      if (!stat.isDirectory()) {
        return { ok: false, rootDir, models: [], truncated: false, error: 'Hãy chọn một thư mục.' };
      }
      const [walk, imported] = await Promise.all([
        scanModelLibrary(rootDir),
        this.listWorkspaces()
      ]);
      const byId = new Map(imported.map((summary) => [summary.id, summary]));
      return {
        ok: true,
        rootDir,
        truncated: walk.truncated,
        models: walk.models.map((model) => ({
          ...model,
          workspace: byId.get(workspaceIdFor(model.modelSettingPath))
        }))
      };
    } catch (error) {
      return {
        ok: false,
        rootDir,
        models: [],
        truncated: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Opens a library model: reuses its workspace when it was imported before,
   * imports it otherwise.
   *
   * Reuse matters because `importModel` copies over `working/`, so clicking a
   * model twice in the library would otherwise throw away the edits made to it.
   */
  async openOrImport(modelSettingPath: string): Promise<ImportResult> {
    const workspacePath = this.resolveWorkspace(workspaceIdFor(modelSettingPath));
    const manifest = await this.readManifest(workspacePath);
    if (manifest && (await exists(path.join(workspacePath, WORKING_DIR, manifest.modelSettingFile)))) {
      return {
        ok: true,
        workspace: {
          id: manifest.id,
          displayName: manifest.displayName,
          workspacePath,
          modelSettingFile: manifest.modelSettingFile,
          lastOpenedAt: manifest.lastOpenedAt
        }
      };
    }
    return this.importModel(modelSettingPath);
  }

  /**
   * A small preview of a library model's first texture, as a PNG data URL, or
   * null when it has none.
   *
   * Uses the OS thumbnailer where there is one: it decodes off the main thread,
   * where a full decode of a 4096px atlas would freeze the window for every row
   * scrolled into view. Linux has no thumbnailer, so it falls back to a decode.
   */
  async libraryThumbnail(modelSettingPath: string): Promise<string | null> {
    const texture = await thumbnailTextureFor(modelSettingPath);
    if (!texture || !(await exists(texture))) return null;
    const size = { width: THUMBNAIL_SIZE, height: THUMBNAIL_SIZE };
    let image: Electron.NativeImage;
    try {
      image = await nativeImage.createThumbnailFromPath(texture, size);
    } catch {
      image = nativeImage.createFromPath(texture);
      if (!image.isEmpty()) image = image.resize({ width: THUMBNAIL_SIZE, quality: 'good' });
    }
    return image.isEmpty() ? null : image.toDataURL();
  }

  async listWorkspaces(): Promise<WorkspaceSummary[]> {
    await fs.mkdir(this.rootDir, { recursive: true });
    const entries = await fs.readdir(this.rootDir, { withFileTypes: true });
    const summaries: WorkspaceSummary[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const workspacePath = path.join(this.rootDir, entry.name);
      const manifest = await this.readManifest(workspacePath);
      if (!manifest) continue;
      summaries.push({
        id: manifest.id,
        displayName: manifest.displayName,
        workspacePath,
        modelSettingFile: manifest.modelSettingFile,
        lastOpenedAt: manifest.lastOpenedAt
      });
    }

    return summaries.sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt));
  }

  async openWorkspace(workspaceId: string): Promise<OpenedWorkspace> {
    const workspacePath = this.resolveWorkspace(workspaceId);
    const manifest = await this.readManifest(workspacePath);
    if (!manifest) throw new Error(`Workspace không hợp lệ: ${workspaceId}`);

    manifest.lastOpenedAt = new Date().toISOString();
    await this.writeManifest(workspacePath, manifest);

    const modelSettingJson = await fs.readFile(
      path.join(workspacePath, WORKING_DIR, manifest.modelSettingFile),
      'utf8'
    );
    return { manifest, workspacePath, modelSettingJson };
  }

  async readWorkspaceFile(workspaceId: string, relativePath: string): Promise<WorkspaceFile> {
    const absolute = this.resolveWorkingFile(workspaceId, relativePath);
    const buffer = await fs.readFile(absolute);
    // Copy into a standalone ArrayBuffer so the value survives IPC structured cloning.
    const data = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength
    ) as ArrayBuffer;
    return { relativePath, data };
  }

  /** Atomic write plus a rotating backup of the version being replaced. */
  async writeJsonFile(request: WriteJsonRequest): Promise<{ ok: boolean; error?: string }> {
    try {
      this.assertNotMoving();
      const absolute = this.resolveWorkingFile(request.workspaceId, request.relativePath);
      // The app writes its own documents into subdirectories the imported model
      // has no reason to contain, so the path may not exist yet.
      await fs.mkdir(path.dirname(absolute), { recursive: true });
      await this.backupExisting(request.workspaceId, request.relativePath, absolute);

      const temporary = `${absolute}.tmp-${randomUUID().slice(0, 8)}`;
      const handle = await fs.open(temporary, 'w');
      try {
        await handle.writeFile(request.contents, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.rename(temporary, absolute);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Writes a texture PNG, atomically and with a rotating backup.
   *
   * Same guarantees as a JSON write, and for the same reason: a half-written
   * texture is a corrupt model, and the workspace is the only copy the user has
   * been editing.
   */
  async writeTexture(request: {
    workspaceId: string;
    relativePath: string;
    data: ArrayBuffer;
  }): Promise<{ ok: boolean; error?: string }> {
    try {
      this.assertNotMoving();
      const absolute = this.resolveWorkingFile(request.workspaceId, request.relativePath);
      await fs.mkdir(path.dirname(absolute), { recursive: true });
      await this.backupExisting(request.workspaceId, request.relativePath, absolute, '.png');

      const temporary = `${absolute}.tmp-${randomUUID().slice(0, 8)}`;
      const handle = await fs.open(temporary, 'w');
      try {
        await handle.writeFile(Buffer.from(request.data));
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.rename(temporary, absolute);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  getWorkingDir(workspaceId: string): string {
    return path.join(this.resolveWorkspace(workspaceId), WORKING_DIR);
  }

  private async backupExisting(
    workspaceId: string,
    relativePath: string,
    absolute: string,
    extension = '.json'
  ): Promise<void> {
    if (!(await exists(absolute))) return;

    const backupDir = path.join(
      this.resolveWorkspace(workspaceId),
      BACKUP_DIR,
      relativePath.replace(/[\\/]/g, '__')
    );
    await fs.mkdir(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await fs.copyFile(absolute, path.join(backupDir, `${stamp}${extension}`));

    // Textures are megabytes each, so keep fewer of them than of JSON files.
    const keepCount = extension === '.png' ? 3 : BACKUPS_PER_FILE;
    const kept = (await fs.readdir(backupDir)).sort();
    for (const stale of kept.slice(0, Math.max(0, kept.length - keepCount))) {
      await fs.rm(path.join(backupDir, stale), { force: true });
    }
  }

  /** Guards against a relative path escaping the workspace via `..`. */
  private resolveWorkingFile(workspaceId: string, relativePath: string): string {
    const workingDir = this.getWorkingDir(workspaceId);
    const absolute = path.resolve(workingDir, relativePath);
    const boundary = workingDir.endsWith(path.sep) ? workingDir : workingDir + path.sep;
    if (absolute !== workingDir && !absolute.startsWith(boundary)) {
      throw new Error(`Đường dẫn nằm ngoài workspace: ${relativePath}`);
    }
    return absolute;
  }

  private resolveWorkspace(workspaceId: string): string {
    // An empty or `.` id would resolve to the root itself, which delete must never reach.
    if (
      !workspaceId ||
      workspaceId === '.' ||
      workspaceId.includes('/') ||
      workspaceId.includes('\\') ||
      workspaceId.includes('..')
    ) {
      throw new Error(`Workspace id không hợp lệ: ${workspaceId}`);
    }
    return path.join(this.rootDir, workspaceId);
  }

  private async readManifest(workspacePath: string): Promise<ProjectManifest | null> {
    try {
      const raw = await fs.readFile(path.join(workspacePath, MANIFEST_NAME), 'utf8');
      return JSON.parse(raw) as ProjectManifest;
    } catch {
      return null;
    }
  }

  private async writeManifest(workspacePath: string, manifest: ProjectManifest): Promise<void> {
    await fs.writeFile(
      path.join(workspacePath, MANIFEST_NAME),
      JSON.stringify(manifest, null, 2),
      'utf8'
    );
  }

  /** Every path referenced by model3.json, relative to the model folder. */
  private collectReferencedFiles(setting: Model3Json): string[] {
    const refs = setting.FileReferences;
    const files = [refs.Moc, ...refs.Textures];
    if (refs.Physics) files.push(refs.Physics);
    if (refs.Pose) files.push(refs.Pose);
    if (refs.DisplayInfo) files.push(refs.DisplayInfo);
    if (refs.UserData) files.push(refs.UserData);
    for (const expression of refs.Expressions ?? []) files.push(expression.File);
    for (const entries of Object.values(refs.Motions ?? {})) {
      for (const entry of entries) {
        files.push(entry.File);
        if (entry.Sound) files.push(entry.Sound);
      }
    }
    return files;
  }

  private async findModelSettings(dir: string, depth: number): Promise<string[]> {
    if (depth > 2) return [];
    const found: string[] = [];
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.model3.json')) {
        found.push(full);
      } else if (entry.isDirectory() && !entry.name.startsWith('.')) {
        found.push(...(await this.findModelSettings(full, depth + 1)));
      }
    }
    return found;
  }

  private async hasCubism2Model(dir: string): Promise<boolean> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.some(
      (entry) => entry.isFile() && /\.moc$/i.test(entry.name) && !/\.moc3$/i.test(entry.name)
    );
  }

  /**
   * Reads the moc3 version byte from the header. The Core reports the same value
   * via csmGetMocVersion, but reading it here lets us reject a bad file before
   * copying hundreds of megabytes of textures.
   */
  private async readMocVersion(mocPath: string): Promise<number | null> {
    const handle = await fs.open(mocPath, 'r');
    try {
      const header = Buffer.alloc(8);
      await handle.read(header, 0, 8, 0);
      if (!header.subarray(0, 4).equals(MOC3_MAGIC)) return null;
      return header[4];
    } finally {
      await handle.close();
    }
  }
}
