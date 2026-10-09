const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('myUnrar', {
  getDroppedPaths: (files) => Array.from(files, (file) => webUtils.getPathForFile(file)).filter(Boolean),
  chooseArchive: () => ipcRenderer.invoke('myunrar:choose-archive'),
  compressDropped: (files, format) => ipcRenderer.invoke('myunrar:compress-dropped', files, format),
  openArchive: (archive) => ipcRenderer.invoke('myunrar:open-archive', archive),
  closeArchive: () => ipcRenderer.send('myunrar:close-archive'),
  extractArchive: (archive) => ipcRenderer.invoke('myunrar:extract-archive', archive),
  testArchive: (archive) => ipcRenderer.invoke('myunrar:test-archive', archive),
  openLocation: (location) => ipcRenderer.invoke('myunrar:open-location', location),
  openDeveloperEmail: () => ipcRenderer.invoke('myunrar:open-developer-email'),
  providePassword: (operationId, password) => ipcRenderer.send('myunrar:provide-password', { operationId, password }),
  cancelPassword: (operationId) => ipcRenderer.send('myunrar:cancel-password', operationId),
  onOpenRar: (callback) => {
    const listener = (_event, archive) => callback(archive);
    ipcRenderer.on('myunrar:open-rar', listener);
    return () => ipcRenderer.removeListener('myunrar:open-rar', listener);
  },
  onPasswordRequired: (callback) => {
    const listener = (_event, request) => callback(request);
    ipcRenderer.on('myunrar:password-required', listener);
    return () => ipcRenderer.removeListener('myunrar:password-required', listener);
  },
  onProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('myunrar:progress', listener);
    return () => ipcRenderer.removeListener('myunrar:progress', listener);
  },
});
