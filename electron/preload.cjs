const { contextBridge, ipcRenderer } = require('electron');

// Expose a safe subset of Electron APIs to the renderer
contextBridge.exposeInMainWorld('electron', {
  platform: process.platform,
  version: process.env.npm_package_version || '1.0.0',
});
