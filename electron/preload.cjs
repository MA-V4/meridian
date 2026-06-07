const { contextBridge, ipcRenderer } = require('electron');

// ── Safe API bridge — renderer gets ONLY these methods ──────
contextBridge.exposeInMainWorld('electron', {
  platform: process.platform,

  // App info
  getVersion: () => ipcRenderer.invoke('get-version'),

  // ── Auto-updater ──────────────────────────────────────────
  updater: {
    check:     () => ipcRenderer.invoke('update-check'),
    download:  () => ipcRenderer.invoke('update-download'),
    install:   () => ipcRenderer.invoke('update-install'),
    // Listen for main-process events
    on: (event, cb) => {
      const valid = [
        'update-available', 'update-not-available',
        'update-download-progress', 'update-downloaded', 'update-error',
      ];
      if (!valid.includes(event)) return () => {};
      const handler = (_, data) => cb(data);
      ipcRenderer.on(event, handler);
      return () => ipcRenderer.removeListener(event, handler); // returns cleanup fn
    },
  },

  // ── safeStorage — OS-level secret encryption ──────────────
  secrets: {
    isAvailable: () => ipcRenderer.invoke('encryption-available'),
    encrypt: (plaintext) => ipcRenderer.invoke('secret-encrypt', plaintext),
    decrypt: (ciphertext) => ipcRenderer.invoke('secret-decrypt', ciphertext),
  },
});
