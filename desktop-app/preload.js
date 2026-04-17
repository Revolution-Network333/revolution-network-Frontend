const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getStatus: () => ipcRenderer.invoke('get-status'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getLogoPath: () => ipcRenderer.invoke('get-logo-path'),
  startMining: (token) => ipcRenderer.send('start-mining', token),
  stopMining: () => ipcRenderer.send('stop-mining'),
  logout: () => ipcRenderer.send('logout'),
  openLoginWindow: () => ipcRenderer.send('open-login-window'),
  getStoreValue: (key) => ipcRenderer.invoke('get-store-value', key),
  setStoreValue: (key, value) => ipcRenderer.send('set-store-value', key, value),
  removeStoreValue: (key) => ipcRenderer.send('remove-store-value', key),
  openExternal: (url) => ipcRenderer.send('open-external', url),
  onLogUpdate: (callback) => ipcRenderer.on('log-update', (event, logs) => callback(logs)),
  onStatusUpdate: (callback) => ipcRenderer.on('status-update', (event, status) => callback(status)),
  onAuthSuccess: (callback) => ipcRenderer.on('auth-success', (event, token) => callback(token)),
});
