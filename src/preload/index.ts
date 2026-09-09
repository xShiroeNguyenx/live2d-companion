import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { IpcChannels, type RendererApi, type WriteJsonRequest } from '@shared/ipc-contract';

/**
 * The renderer's only route to the filesystem. Everything is a narrow, named
 * call — no generic `invoke(channel, ...)` escape hatch.
 */
const api: RendererApi = {
  probeImport: (folderOrFile) => ipcRenderer.invoke(IpcChannels.probeImport, folderOrFile),
  importModel: (modelSettingPath) =>
    ipcRenderer.invoke(IpcChannels.importModel, modelSettingPath),
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
