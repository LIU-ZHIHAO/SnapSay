import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('tailkall', {
  getDashboard: () => ipcRenderer.invoke('tailkall:get-dashboard'),
  saveSettings: (settings: unknown) => ipcRenderer.invoke('tailkall:save-settings', settings),
  submitRecording: (audio: ArrayBuffer, durationMs: number) =>
    ipcRenderer.invoke('tailkall:submit-recording', audio, durationMs),
  copyText: (text: string) => ipcRenderer.invoke('tailkall:copy-text', text),
  rewriteRecord: (id: string) => ipcRenderer.invoke('tailkall:rewrite-record', id),
  pasteRecord: (id: string) => ipcRenderer.invoke('tailkall:paste-record', id),
  deleteRecord: (id: string) => ipcRenderer.invoke('tailkall:delete-record', id),
  testRewriteApi: (settings: unknown) => ipcRenderer.invoke('tailkall:test-rewrite-api', settings),
  saveCorrection: (id: string, text: string) => ipcRenderer.invoke('tailkall:save-correction', id, text),
  learnWordbook: () => ipcRenderer.invoke('tailkall:learn-wordbook'),
  windowControl: (action: 'minimize' | 'toggle-maximize' | 'close') =>
    ipcRenderer.invoke('tailkall:window-control', action),
  onRecordingStart: (callback: () => void) => {
    ipcRenderer.on('tailkall:recording-start', callback);
    return () => ipcRenderer.removeListener('tailkall:recording-start', callback);
  },
  onRecordingStop: (callback: () => void) => {
    ipcRenderer.on('tailkall:recording-stop', callback);
    return () => ipcRenderer.removeListener('tailkall:recording-stop', callback);
  },
  onRecordAdded: (callback: (record: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, record: unknown) => callback(record);
    ipcRenderer.on('tailkall:record-added', listener);
    return () => ipcRenderer.removeListener('tailkall:record-added', listener);
  },
  onRecordUpdated: (callback: (record: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, record: unknown) => callback(record);
    ipcRenderer.on('tailkall:record-updated', listener);
    return () => ipcRenderer.removeListener('tailkall:record-updated', listener);
  },
  onRecordDeleted: (callback: (id: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, id: string) => callback(id);
    ipcRenderer.on('tailkall:record-deleted', listener);
    return () => ipcRenderer.removeListener('tailkall:record-deleted', listener);
  }
});

contextBridge.exposeInMainWorld('tailkallFloating', {
  onState: (callback: (state: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: unknown) => callback(state);
    ipcRenderer.on('floating-state:update', listener);
    return () => ipcRenderer.removeListener('floating-state:update', listener);
  }
});
