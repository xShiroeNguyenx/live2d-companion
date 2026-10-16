import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { IpcChannels, type RendererApi, type WriteJsonRequest } from '@shared/ipc-contract';
import type { StorageMoveProgress } from '@shared/types/workspace';

/**
 * The renderer's only route to the filesystem. Everything is a narrow, named
 * call — no generic `invoke(channel, ...)` escape hatch.
 */
const api: RendererApi = {
  probeImport: (folderOrFile) => ipcRenderer.invoke(IpcChannels.probeImport, folderOrFile),
  importModel: (modelSettingPath) =>
    ipcRenderer.invoke(IpcChannels.importModel, modelSettingPath),
  scanLibrary: (rootDir) => ipcRenderer.invoke(IpcChannels.scanLibrary, rootDir),
  openOrImport: (modelSettingPath) =>
    ipcRenderer.invoke(IpcChannels.openOrImport, modelSettingPath),
  libraryThumbnail: (modelSettingPath) =>
    ipcRenderer.invoke(IpcChannels.libraryThumbnail, modelSettingPath),
  listWorkspaces: () => ipcRenderer.invoke(IpcChannels.listWorkspaces),
  openWorkspace: (workspaceId) => ipcRenderer.invoke(IpcChannels.openWorkspace, workspaceId),
  readWorkspaceFile: (workspaceId, relativePath) =>
    ipcRenderer.invoke(IpcChannels.readWorkspaceFile, workspaceId, relativePath),
  writeJsonFile: (request: WriteJsonRequest) =>
    ipcRenderer.invoke(IpcChannels.writeJsonFile, request),
  revealInExplorer: (workspaceId) =>
    ipcRenderer.invoke(IpcChannels.revealInExplorer, workspaceId),
  pickModelFolder: () => ipcRenderer.invoke(IpcChannels.pickModelFolder),
  sampleModelPath: () => ipcRenderer.invoke(IpcChannels.sampleModelPath),
  pickExportFolder: () => ipcRenderer.invoke(IpcChannels.pickExportFolder),
  exportModel: (request) => ipcRenderer.invoke(IpcChannels.exportModel, request),
  writeTexture: (request) => ipcRenderer.invoke(IpcChannels.writeTexture, request),
  deleteWorkspace: (workspaceId) => ipcRenderer.invoke(IpcChannels.deleteWorkspace, workspaceId),
  storageUsage: () => ipcRenderer.invoke(IpcChannels.storageUsage),
  pickStorageFolder: () => ipcRenderer.invoke(IpcChannels.pickStorageFolder),
  changeStorageRoot: (rootDir, moveExisting) =>
    ipcRenderer.invoke(IpcChannels.changeStorageRoot, rootDir, moveExisting),
  revealStorageRoot: () => ipcRenderer.invoke(IpcChannels.revealStorageRoot),
  onStorageMoveProgress: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: StorageMoveProgress): void =>
      listener(progress);
    ipcRenderer.on(IpcChannels.storageMoveProgress, handler);
    return () => ipcRenderer.removeListener(IpcChannels.storageMoveProgress, handler);
  },
  // `File.path` was removed from Electron's renderer; this is the supported way
  // to turn a dropped File back into a filesystem path.
  getPathForFile: (file: File) => webUtils.getPathForFile(file),


  secretSet: (name, value) => ipcRenderer.invoke(IpcChannels.secretSet, name, value),
  secretHas: (name) => ipcRenderer.invoke(IpcChannels.secretHas, name),
  secretClear: (name) => ipcRenderer.invoke(IpcChannels.secretClear, name),
  pickImage: () => ipcRenderer.invoke(IpcChannels.pickImage),
  openExternal: (url) => ipcRenderer.invoke(IpcChannels.openExternal, url),
  cubismEditorStatus: () => ipcRenderer.invoke(IpcChannels.cubismEditorStatus)
};

contextBridge.exposeInMainWorld('api', api);
