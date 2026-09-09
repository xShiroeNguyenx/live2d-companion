import path from 'node:path';
import { BrowserWindow, dialog, ipcMain, shell } from 'electron';
import {
  IpcChannels,
  type WriteJsonRequest,
  type WriteTextureRequest
} from '@shared/ipc-contract';
import type { ExportRequest } from '@shared/types/export';
import type { ExportService } from '../services/ExportService';
import type { WorkspaceService } from '../services/WorkspaceService';

export function registerWorkspaceIpc(
  service: WorkspaceService,
  exportService: ExportService,
  sampleModelDir: string
): void {
  ipcMain.handle(IpcChannels.probeImport, (_event, target: string) =>
    service.probeImport(target)
  );

  ipcMain.handle(IpcChannels.importModel, (_event, modelSettingPath: string) =>
    service.importModel(modelSettingPath)
  );

  ipcMain.handle(IpcChannels.listWorkspaces, () => service.listWorkspaces());

  ipcMain.handle(IpcChannels.openWorkspace, (_event, workspaceId: string) =>
    service.openWorkspace(workspaceId)
  );

  ipcMain.handle(
    IpcChannels.readWorkspaceFile,
    (_event, workspaceId: string, relativePath: string) =>
      service.readWorkspaceFile(workspaceId, relativePath)
  );

  ipcMain.handle(IpcChannels.writeJsonFile, (_event, request: WriteJsonRequest) =>
    service.writeJsonFile(request)
  );

  ipcMain.handle(IpcChannels.writeTexture, (_event, request: WriteTextureRequest) =>
    service.writeTexture(request)
  );

  ipcMain.handle(IpcChannels.revealInExplorer, async (_event, workspaceId: string) => {
    shell.openPath(service.getWorkingDir(workspaceId));
  });

  ipcMain.handle(IpcChannels.pickModelFolder, async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const result = window
      ? await dialog.showOpenDialog(window, {
          title: 'Chọn thư mục model Live2D',
          properties: ['openDirectory']
        })
      : await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
  });

  ipcMain.handle(IpcChannels.pickExportFolder, async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: 'Chọn thư mục để xuất model',
      // Creating a new folder here is the normal case for an export.
      properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'>
    };
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
  });

  ipcMain.handle(IpcChannels.exportModel, (_event, request: ExportRequest) =>
    exportService.export(request)
  );

  ipcMain.handle(IpcChannels.sampleModelPath, () =>
    path.join(sampleModelDir, 'Hiyori', 'Hiyori.model3.json')
  );
}
