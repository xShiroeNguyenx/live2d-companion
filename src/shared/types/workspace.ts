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
