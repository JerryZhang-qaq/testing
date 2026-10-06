const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lanread', {
  list: () => ipcRenderer.invoke('library:list'),
  importBooks: () => ipcRenderer.invoke('library:import'),
  readBook: id => ipcRenderer.invoke('library:read', id),
  updateBook: (id, patch) => ipcRenderer.invoke('library:update', id, patch),
  deleteBook: id => ipcRenderer.invoke('library:delete', id),
  saveSettings: settings => ipcRenderer.invoke('settings:save', settings),
  saveBookmark: (id, bookmark) => ipcRenderer.invoke('bookmark:save', id, bookmark),
  deleteBookmark: (id, bookmarkId) => ipcRenderer.invoke('bookmark:delete', id, bookmarkId),
  dataPath: () => ipcRenderer.invoke('app:data-path'),
});
