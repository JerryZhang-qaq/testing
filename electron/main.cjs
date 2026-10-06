const { app, BrowserWindow, dialog, ipcMain, session } = require('electron');
const path = require('node:path');
const { Library } = require('./library.cjs');

if (process.env.LANREAD_DATA_DIR) app.setPath('userData', path.resolve(process.env.LANREAD_DATA_DIR));
let library;
let window;
const devUrl = process.env.LANREAD_DEV_URL;
if (devUrl && devUrl !== 'http://127.0.0.1:5173') throw new Error('Unsupported development URL.');

function registerIpc() {
  const handle = (name, action) => ipcMain.handle(name, (event, ...args) => {
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
      throw new Error('不允许的窗口请求。');
    }
    return action(...args);
  });
  handle('library:list', () => library.snapshot());
  handle('library:import', async () => {
    const selection = await dialog.showOpenDialog(window, {
      title: '导入 EPUB 到书库', filters: [{ name: 'EPUB 电子书', extensions: ['epub'] }],
      properties: ['openFile', 'multiSelections'],
    });
    return library.importFiles(selection.canceled ? [] : selection.filePaths);
  });
  handle('library:read', async id => {
    const buffer = await library.readBook(id);
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  });
  handle('library:update', (id, patch) => library.updateBook(id, patch));
  handle('library:delete', id => library.deleteBook(id));
  handle('settings:save', settings => library.saveSettings(settings));
  handle('bookmark:save', (id, bookmark) => library.saveBookmark(id, bookmark));
  handle('bookmark:delete', (id, bookmarkId) => library.deleteBookmark(id, bookmarkId));
  handle('app:data-path', () => app.getPath('userData'));
}

function createWindow() {
  window = new BrowserWindow({
    width: 1240, height: 840, minWidth: 900, minHeight: 600,
    title: '岚读', backgroundColor: '#f4f8fc', autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  const ownedWindow = window;
  let closing = false;
  ownedWindow.on('close', event => {
    if (!closing) {
      event.preventDefault();
      closing = true;
      // Complete notes/settings/progress already accepted by IPC before closing the process.
      library.queue.then(() => { if (!ownedWindow.isDestroyed()) ownedWindow.close(); });
    }
  });
  window.on('closed', () => { window = null; });
  if (devUrl) window.loadURL(devUrl);
  else window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (window) { if (window.isMinimized()) window.restore(); window.focus(); }
  });
  app.whenReady().then(async () => {
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (details, callback) => {
      const allowed = devUrl && (details.url.startsWith(`${devUrl}/`) || details.url.startsWith('ws://127.0.0.1:5173/'));
      callback({ cancel: !allowed });
    });
    library = await new Library(app.getPath('userData')).init();
    registerIpc();
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  }).catch(error => {
    dialog.showErrorBox('岚读无法启动', error.message);
    app.quit();
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
