import type { ExportRequest, ExportResult } from './types/export';
import type {
  ImportProbe,
  ImportResult,
  ProjectManifest,
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
  /** Resolves a dropped `File` to its real path (synchronous, preload-only API). */
  getPathForFile(file: File): string;


  secretSet(name: SecretName, value: string): Promise<void>;
  secretHas(name: SecretName): Promise<boolean>;
  secretClear(name: SecretName): Promise<void>;
  pickImage(): Promise<string | null>;
  openExternal(url: string): Promise<void>;
  cubismEditorStatus(): Promise<CubismEditorStatus>;
}
