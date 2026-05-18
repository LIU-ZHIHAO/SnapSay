import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('tailkall', {
  getDashboard: () => ipcRenderer.invoke('tailkall:get-dashboard'),
  saveSettings: (settings: unknown) => ipcRenderer.invoke('tailkall:save-settings', settings),
  copyText: (text: string) => ipcRenderer.invoke('tailkall:copy-text', text),
  rewriteRecord: (id: string) => ipcRenderer.invoke('tailkall:rewrite-record', id),
  pasteRecord: (id: string) => ipcRenderer.invoke('tailkall:paste-record', id),
  deleteRecord: (id: string) => ipcRenderer.invoke('tailkall:delete-record', id),
  testRewriteApi: (settings: unknown) => ipcRenderer.invoke('tailkall:test-rewrite-api', settings),
  captureTriggerKey: () => ipcRenderer.invoke('tailkall:capture-trigger-key')
});
