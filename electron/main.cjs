const { app, BrowserWindow, shell, session, ipcMain, safeStorage } = require('electron');
const path = require('path');
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

let mainWindow;

// ── Auto-updater setup ──────────────────────────────────────
// Only runs in packaged builds — not during dev
let autoUpdater;
if (!isDev) {
  try {
    const { autoUpdater: au } = require('electron-updater');
    autoUpdater = au;
    autoUpdater.autoDownload = false;       // ask user before downloading
    autoUpdater.autoInstallOnAppQuit = true; // install on next quit after download
  } catch (e) {
    console.warn('[updater] electron-updater not available:', e.message);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#080808',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    frame: process.platform !== 'darwin',
    show: false,
    icon: path.join(__dirname, '../public/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      devTools: isDev,
    },
  });

  // ── Content Security Policy ─────────────────────────────────
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [[
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline'",
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
          "font-src 'self' https://fonts.gstatic.com data:",
          "connect-src 'self' http://localhost:11434 https://api.github.com",
          "img-src 'self' data: blob:",
          "object-src 'none'",
          "base-uri 'self'",
        ].join('; ')],
      },
    });
  });

  // ── Load app ────────────────────────────────────────────────
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
    // Check for updates ~5 seconds after launch
    if (autoUpdater) {
      setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 5000);
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── Auto-updater IPC ────────────────────────────────────────
// Renderer listens for these events and shows the update UI
function setupUpdaterIPC() {
  if (!autoUpdater) return;

  autoUpdater.on('update-available', (info) => {
    mainWindow?.webContents.send('update-available', {
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: info.releaseNotes,
    });
  });

  autoUpdater.on('update-not-available', () => {
    mainWindow?.webContents.send('update-not-available');
  });

  autoUpdater.on('download-progress', (progress) => {
    mainWindow?.webContents.send('update-download-progress', {
      percent: Math.round(progress.percent),
      transferred: progress.transferred,
      total: progress.total,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    mainWindow?.webContents.send('update-downloaded', { version: info.version });
  });

  autoUpdater.on('error', (err) => {
    mainWindow?.webContents.send('update-error', err.message);
  });

  // Renderer → main: user clicked "Download update"
  ipcMain.handle('update-download', async () => {
    try { await autoUpdater.downloadUpdate(); } catch (e) { return { error: e.message }; }
    return { ok: true };
  });

  // Renderer → main: user clicked "Restart and install"
  ipcMain.handle('update-install', () => {
    autoUpdater.quitAndInstall(false, true);
  });

  // Renderer → main: manual check
  ipcMain.handle('update-check', async () => {
    try { await autoUpdater.checkForUpdates(); } catch (e) { return { error: e.message }; }
    return { ok: true };
  });
}

// ── safeStorage IPC — OS keychain for secrets ───────────────
// Encrypts/decrypts using OS-level APIs (Keychain, DPAPI, libsecret)
ipcMain.handle('secret-encrypt', (_, plaintext) => {
  if (!safeStorage.isEncryptionAvailable()) return { error: 'Encryption not available on this system' };
  try {
    const buf = safeStorage.encryptString(plaintext);
    return { ciphertext: buf.toString('base64') };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('secret-decrypt', (_, ciphertext) => {
  if (!safeStorage.isEncryptionAvailable()) return { error: 'Encryption not available' };
  try {
    const buf = Buffer.from(ciphertext, 'base64');
    return { plaintext: safeStorage.decryptString(buf) };
  } catch (e) {
    return { error: 'Failed to decrypt — key may have changed' };
  }
});

ipcMain.handle('encryption-available', () => safeStorage.isEncryptionAvailable());

// ── App version IPC ─────────────────────────────────────────
ipcMain.handle('get-version', () => app.getVersion());

// ── Navigation lockdown ─────────────────────────────────────
app.on('web-contents-created', (_, contents) => {
  contents.on('will-navigate', (event, url) => {
    const allowed = isDev ? ['http://localhost:5173'] : ['file://'];
    if (!allowed.some(b => url.startsWith(b))) {
      event.preventDefault();
      if (url.startsWith('https://') || url.startsWith('http://')) shell.openExternal(url);
    }
  });
  contents.on('new-window', (event) => event.preventDefault());
});

app.whenReady().then(() => {
  setupUpdaterIPC();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
