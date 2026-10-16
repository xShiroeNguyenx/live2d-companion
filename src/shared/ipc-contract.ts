import type { ExportRequest, ExportResult } from './types/export';
import type {
  ImportProbe,
  ChangeStorageRootResult,
  ImportResult,
  LibraryScan,
  ProjectManifest,
  StorageMoveProgress,
  StorageRootCandidate,
  StorageUsage,
  WorkspaceFile,
  WorkspaceSummary
} from './types/workspace';

/**
 * The single definition of what the renderer may ask the main process to do.
 * The renderer never touches `fs`; everything file-related goes through here.
 */
export const IpcChannels = {
  probeImport: 'workspace:probeImport',
  importModel: 'workspace:importModel',
  scanLibrary: 'workspace:scanLibrary',
  openOrImport: 'workspace:openOrImport',
  libraryThumbnail: 'workspace:libraryThumbnail',
  listWorkspaces: 'workspace:list',
  openWorkspace: 'workspace:open',
  readWorkspaceFile: 'workspace:readFile',
  writeJsonFile: 'workspace:writeJson',
  revealInExplorer: 'shell:reveal',
  pickModelFolder: 'dialog:pickModelFolder',
  sampleModelPath: 'app:sampleModelPath',
  pickExportFolder: 'dialog:pickExportFolder',
  exportModel: 'export:model',
  writeTexture: 'workspace:writeTexture',
  deleteWorkspace: 'workspace:delete',
  storageUsage: 'storage:usage',
  pickStorageFolder: 'storage:pickFolder',
  changeStorageRoot: 'storage:changeRoot',
  revealStorageRoot: 'storage:reveal',
  storageMoveProgress: 'storage:moveProgress',


  secretSet: 'secrets:set',
  secretHas: 'secrets:has',
  secretClear: 'secrets:clear',
  pickImage: 'dialog:pickImage',
  openExternal: 'shell:openExternal',
  cubismEditorStatus: 'app:cubismEditorStatus'
} as const;

export interface OpenedWorkspace {
  manifest: ProjectManifest;
  workspacePath: string;
  /** model3.json already parsed, plus every file the renderer needs to boot the model. */
  modelSettingJson: string;
}

export interface WriteTextureRequest {
  workspaceId: string;
  /** Path relative to the workspace working directory. */
  relativePath: string;
  /** Raw PNG bytes. */
  data: ArrayBuffer;
}

export interface WriteJsonRequest {
  workspaceId: string;
  /** Path relative to `working/`. */
  relativePath: string;
  /** Pretty-printed JSON text; the main process writes it atomically and rotates a backup. */
  contents: string;
}

/** Names of secrets the app stores. Kept as a closed list so a typo cannot create a new one. */
export type SecretName = 'geminiApiKey';

export interface CubismEditorStatus {
  installed: boolean;
  /** Where it was found, when it was. */
  path?: string;
}

/** Shape exposed on `window.api` by the preload bridge. */
export interface RendererApi {
  probeImport(folderOrFile: string): Promise<ImportProbe>;
  importModel(modelSettingPath: string): Promise<ImportResult>;
  /** Lists every model under a folder of many models, without copying any. */
  scanLibrary(rootDir: string): Promise<LibraryScan>;
  /** Reuses the workspace of an already-imported model, imports it otherwise. */
  openOrImport(modelSettingPath: string): Promise<ImportResult>;
  /** Small preview of a library model's first texture as a data URL, null if none. */
  libraryThumbnail(modelSettingPath: string): Promise<string | null>;
  listWorkspaces(): Promise<WorkspaceSummary[]>;
  openWorkspace(workspaceId: string): Promise<OpenedWorkspace>;
  readWorkspaceFile(workspaceId: string, relativePath: string): Promise<WorkspaceFile>;
  writeJsonFile(request: WriteJsonRequest): Promise<{ ok: boolean; error?: string }>;
  revealInExplorer(workspaceId: string): Promise<void>;
  pickModelFolder(): Promise<string | null>;
  sampleModelPath(): Promise<string>;
  pickExportFolder(): Promise<string | null>;
  exportModel(request: ExportRequest): Promise<ExportResult>;
  /** Writes a PNG into the workspace, atomically and with a backup. */
  writeTexture(request: WriteTextureRequest): Promise<{ ok: boolean; error?: string }>;
  /** Removes a workspace from disk. The folder it was imported from is untouched. */
  deleteWorkspace(workspaceId: string): Promise<{ ok: boolean; error?: string }>;
  /** Size of every workspace and the free space on their drive. Walks the files, so not instant. */
  storageUsage(): Promise<StorageUsage>;
  /** Asks for a folder to keep workspaces in; null when cancelled. Nothing changes yet. */
  pickStorageFolder(): Promise<StorageRootCandidate | null>;
  /** Switches the workspace folder, moving the existing workspaces there when asked. */
  changeStorageRoot(rootDir: string, moveExisting: boolean): Promise<ChangeStorageRootResult>;
  revealStorageRoot(): Promise<void>;
  /** Subscribes to move progress; returns the unsubscribe function. */
  onStorageMoveProgress(listener: (progress: StorageMoveProgress) => void): () => void;
  /** Resolves a dropped `File` to its real path (synchronous, preload-only API). */
  getPathForFile(file: File): string;


  secretSet(name: SecretName, value: string): Promise<void>;
  secretHas(name: SecretName): Promise<boolean>;
  secretClear(name: SecretName): Promise<void>;
  pickImage(): Promise<string | null>;
  openExternal(url: string): Promise<void>;
  cubismEditorStatus(): Promise<CubismEditorStatus>;
}
