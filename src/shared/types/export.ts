/** Types for the export flow, shared by the renderer's UI and the main process. */

export interface ExportRequest {
  workspaceId: string;
  /** Directory the model folder will be created in. */
  destinationDir: string;
  /** Name of the folder to create. */
  folderName: string;
  /** Replace an existing folder of the same name. */
  overwrite: boolean;
}

export interface ExportResult {
  ok: boolean;
  exportedPath?: string;
  fileCount?: number;
  error?: string;
}
