import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('snapsay', {
  getDashboard: () => ipcRenderer.invoke('snapsay:get-dashboard'),
  saveSettings: (settings: unknown) => ipcRenderer.invoke('snapsay:save-settings', settings),
  submitRecording: (audio: ArrayBuffer, durationMs: number) =>
    ipcRenderer.invoke('snapsay:submit-recording', audio, durationMs),
  copyText: (text: string) => ipcRenderer.invoke('snapsay:copy-text', text),
  rewriteRecord: (id: string) => ipcRenderer.invoke('snapsay:rewrite-record', id),
  pasteRecord: (id: string) => ipcRenderer.invoke('snapsay:paste-record', id),
  deleteRecord: (id: string) => ipcRenderer.invoke('snapsay:delete-record', id),
  clearAllRecords: () => ipcRenderer.invoke('snapsay:clear-all-records'),
  clearDiagnosticLogs: () => ipcRenderer.invoke('snapsay:clear-diagnostic-logs'),
  exportRecords: () => ipcRenderer.invoke('snapsay:export-records'),
  importRecords: () => ipcRenderer.invoke('snapsay:import-records'),
  testRewriteApi: (settings: unknown) => ipcRenderer.invoke('snapsay:test-rewrite-api', settings),
  saveCorrection: (id: string, text: string) => ipcRenderer.invoke('snapsay:save-correction', id, text),
  saveWordbook: (wordbook: unknown) => ipcRenderer.invoke('snapsay:save-wordbook', wordbook),
  extractWordPairs: (id: string) => ipcRenderer.invoke('snapsay:extract-word-pairs', id),
  windowControl: (action: 'minimize' | 'toggle-maximize' | 'close') =>
    ipcRenderer.invoke('snapsay:window-control', action),
  openExternal: (url: string) => ipcRenderer.invoke('snapsay:open-external', url),
  onRecordingStart: (callback: () => void) => {
    ipcRenderer.on('snapsay:recording-start', callback);
    return () => ipcRenderer.removeListener('snapsay:recording-start', callback);
  },
  onRecordingStop: (callback: () => void) => {
    ipcRenderer.on('snapsay:recording-stop', callback);
    return () => ipcRenderer.removeListener('snapsay:recording-stop', callback);
  },
  onRecordAdded: (callback: (record: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, record: unknown) => callback(record);
    ipcRenderer.on('snapsay:record-added', listener);
    return () => ipcRenderer.removeListener('snapsay:record-added', listener);
  },
  onRecordUpdated: (callback: (record: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, record: unknown) => callback(record);
    ipcRenderer.on('snapsay:record-updated', listener);
    return () => ipcRenderer.removeListener('snapsay:record-updated', listener);
  },
  onRecordDeleted: (callback: (id: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, id: string) => callback(id);
    ipcRenderer.on('snapsay:record-deleted', listener);
    return () => ipcRenderer.removeListener('snapsay:record-deleted', listener);
  },
  onRecordsCleared: (callback: () => void) => {
    ipcRenderer.on('snapsay:records-cleared', callback);
    return () => ipcRenderer.removeListener('snapsay:records-cleared', callback);
  },
  onRecordsSynced: (callback: (records: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, records: unknown) => callback(records);
    ipcRenderer.on('snapsay:records-synced', listener);
    return () => ipcRenderer.removeListener('snapsay:records-synced', listener);
  }
});

contextBridge.exposeInMainWorld('snapsayFloating', {
  onState: (callback: (state: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: unknown) => callback(state);
    ipcRenderer.on('floating-state:update', listener);
    return () => ipcRenderer.removeListener('floating-state:update', listener);
  }
});
