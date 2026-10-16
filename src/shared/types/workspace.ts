/**
 * Workspace types. A workspace is the editor's private copy of a model, so the
 * folder the user imported from is never written to.
 */

/** `.l2dproj.json` at the workspace root. */
export interface ProjectManifest {
  formatVersion: 1;
  id: string;
  displayName: string;
  /** Where the model was imported from, kept for "reveal in explorer" only. */
  sourcePath: string;
  importedAt: string;
  lastOpenedAt: string;
  /** Relative path of the model3.json inside `working/`. */
  modelSettingFile: string;
  mocVersion: number;
  /** User-facing group names for pose3 groups, which the format itself has no room for. */
  poseGroupNames?: Record<number, string>;
}

export interface WorkspaceSummary {
  id: string;
  displayName: string;
  workspacePath: string;
  modelSettingFile: string;
  lastOpenedAt: string;
  thumbnailDataUrl?: string;
}

/** Result of scanning a folder the user dropped, before any copying happens. */
export interface ImportProbe {
  ok: boolean;
  /** Absolute paths of every `*.model3.json` found. */
  candidates: string[];
  /** Set when the folder holds a Cubism 2 model, which this editor cannot open. */
  cubism2Detected: boolean;
  error?: string;
}

/** One `*.model3.json` found while scanning a folder of many models. */
export interface ScannedModel {
  modelSettingPath: string;
  displayName: string;
  /** Folder of the model relative to the library root, with `/` separators. */
  relativeDir: string;
}

export interface LibraryModel extends ScannedModel {
  /** Set when this model was imported before, so opening it reuses that copy. */
  workspace?: WorkspaceSummary;
}

/** Result of scanning a folder that holds many models. Nothing is copied. */
export interface LibraryScan {
  ok: boolean;
  rootDir: string;
  models: LibraryModel[];
  /** True when the scan stopped early because the folder holds too many models. */
  truncated: boolean;
  error?: string;
}

export interface ImportResult {
  ok: boolean;
  workspace?: WorkspaceSummary;
  error?: string;
  /** Referenced files listed in model3.json that were missing on disk. */
  missingFiles?: string[];
}

/** A file read out of a workspace, handed to the renderer for parsing. */
export interface WorkspaceFile {
  /** Path relative to `working/`. */
  relativePath: string;
  data: ArrayBuffer;
}

/** Where workspaces are stored and how much room they take. */
export interface StorageUsage {
  rootDir: string;
  /** Bytes used by every workspace together. */
  totalBytes: number;
  /** Bytes per workspace id. */
  workspaceBytes: Record<string, number>;
  /** Free bytes on the drive holding `rootDir`; null when the OS would not say. */
  freeBytes: number | null;
}

/** A folder the user picked as the new workspace root, resolved but not yet applied. */
export interface StorageRootCandidate {
  ok: boolean;
  /** The root that would be used; a subfolder of the pick when the pick holds other files. */
  rootDir?: string;
  error?: string;
}

export interface ChangeStorageRootResult {
  ok: boolean;
  rootDir: string;
  /** Workspaces moved into the new root. */
  moved: number;
  /** Workspaces left in the old root, with the reason. */
  failed: Array<{ id: string; error: string }>;
  error?: string;
}

/** Progress of moving workspaces to a new root, pushed from the main process. */
export interface StorageMoveProgress {
  done: number;
  total: number;
  current: string;
}
