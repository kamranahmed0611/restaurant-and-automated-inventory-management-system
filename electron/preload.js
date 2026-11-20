const { contextBridge, ipcRenderer } = require('electron');

// Expose safe, isolated Electron APIs to the renderer window
contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  getPrinters: () => ipcRenderer.invoke('get-printers'),
  printSilent: (options) => ipcRenderer.invoke('print-silent', options),
  kickCashDrawer: (options) => ipcRenderer.invoke('kick-cash-drawer', options),
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  getServerUrl: () => ipcRenderer.invoke('get-server-url'),
  setServerUrl: (url) => ipcRenderer.invoke('set-server-url', url),
  saveTerminalCredentials: (creds) => ipcRenderer.invoke('save-terminal-credentials', creds),
  getTerminalCredentials: () => ipcRenderer.invoke('get-terminal-credentials'),
  lockoutGetStatus: () => ipcRenderer.invoke('lockout-get-status'),
  lockoutRecordFailure: () => ipcRenderer.invoke('lockout-record-failure'),
  lockoutReset: () => ipcRenderer.invoke('lockout-reset'),
  saveMasterPinRecord: (record) => ipcRenderer.invoke('save-master-pin-record', record),
  saveDailyBackup: (jsonContent) => ipcRenderer.invoke('save-daily-backup', jsonContent),
  getBackupDirectory: () => ipcRenderer.invoke('get-backup-directory'),
  selectBackupDirectory: () => ipcRenderer.invoke('select-backup-directory'),
  saveBackup: (params) => ipcRenderer.invoke('save-backup', params),
  listBackups: () => ipcRenderer.invoke('list-backups'),
  pickBackupFile: () => ipcRenderer.invoke('pick-backup-file'),
  loadBackupFile: (filePath) => ipcRenderer.invoke('load-backup-file', filePath),
  openAppWindow: (route) => ipcRenderer.invoke('open-app-window', route),
});

