import { app, BrowserWindow, clipboard, globalShortcut, ipcMain, nativeImage, screen } from 'electron';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { createFloatingWindow, updateFloatingState } from './floatingWindow.js';
import { pasteTextToCursor } from './inputController.js';
import { cleanupText, testCleanupProvider, type FetchLike } from './providers.js';
import { runRecordingPipeline } from './recorderCoordinator.js';
import { createElectronStoreAdapter, createSettingsStore, type SettingsStore } from './settingsStore.js';

type RendererSettings = {
  triggerKey: string;
  recordMode: string;
  asr: string;
  localModelDir: string;
  provider: string;
  baseURL: string;
  model: string;
  apiKey: string;
  prompt: string;
  outputMode: string;
  dataDir: string;
};

let mainWindow: BrowserWindow | undefined;
let settingsStore: SettingsStore | undefined;
let isRecording = false;
const execFileAsync = promisify(execFile);

app.setPath('userData', join('D:\\Antigravity', 'tailkall', 'data', 'electron'));
app.setPath('logs', join('D:\\Antigravity', 'tailkall', 'logs'));
try {
  app.setPath('sessionData', join('D:\\Antigravity', 'tailkall', 'cache', 'electron-session'));
} catch {
  // Older Electron versions may not expose sessionData; userData/logs are still moved off C:.
}

function rendererUrl(page: 'index.html' | 'floating.html'): string {
  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    return `${devServerUrl.replace(/\/$/, '')}/${page}`;
  }
  return pathToFileURL(join(app.getAppPath(), 'dist', page)).toString();
}

function defaultDataRoot(): string {
  return join('D:\\Antigravity', 'tailkall', 'data');
}

async function createMainWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 1040,
    minHeight: 680,
    title: 'TailKall',
    icon: nativeImage.createEmpty(),
    webPreferences: {
      preload: join(app.getAppPath(), 'dist-electron', 'main', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  await mainWindow.loadURL(rendererUrl('index.html'));
}

async function createFloating(): Promise<void> {
  const display = screen.getPrimaryDisplay();
  const size = { width: 320, height: 96 };
  const x = Math.round(display.workArea.x + (display.workArea.width - size.width) / 2);
  const y = Math.round(display.workArea.y + display.workArea.height - size.height - 36);

  const window = createFloatingWindow((options) => {
    const floating = new BrowserWindow({
      ...options,
      width: size.width,
      height: size.height,
      x,
      y,
      webPreferences: {
        preload: join(app.getAppPath(), 'dist-electron', 'main', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false
      }
    });
    void floating.loadURL(rendererUrl('floating.html'));
    return floating;
  });

  window.hide();
}

function toRendererSettings(): RendererSettings {
  const settings = settingsStore?.getSettings();
  return {
    triggerKey:
      settings?.input.triggerLabel ??
      (settings?.input.trigger.modifiers.length
        ? `${settings.input.trigger.modifiers.join(' + ')} + ${settings.input.trigger.key}`
        : settings?.input.trigger.key ?? 'F8'),
    recordMode: settings?.input.recordMode ?? '按住说话',
    asr: settings?.input.asr ?? '未配置 ASR',
    localModelDir: settings?.input.localModelDir ?? join('D:\\Antigravity', 'tailkall', 'models'),
    provider: settings?.cleanup.provider?.name ?? 'DeepSeek',
    baseURL: settings?.cleanup.provider?.baseUrl ?? 'https://api.deepseek.com/v1',
    model: settings?.cleanup.provider?.model ?? 'deepseek-chat',
    apiKey: settings?.cleanup.provider?.apiKey ?? '',
    prompt: settings?.cleanup.prompt ?? '请在不改变原意的前提下整理语音输入文本，修正错别字和标点，直接返回整理后的文本。',
    outputMode: settings?.input.outputMode ?? '粘贴到当前光标',
    dataDir: settings?.input.dataDir ?? defaultDataRoot()
  };
}

function installIpcHandlers(): void {
  ipcMain.handle('tailkall:get-dashboard', () => {
    const records = settingsStore?.listRecords().map((record) => ({
      id: record.id,
      time: new Date(record.createdAt).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      }),
      original: record.transcript,
      refined: record.cleanedText ?? record.transcript,
      status: record.status === 'completed' ? '已输入' : '失败',
      asr: [record.asrProvider, record.asrModel].filter(Boolean).join(' / '),
      cleanup: [record.cleanupProvider, record.cleanupModel].filter(Boolean).join(' / '),
      durationMs: record.durationMs,
      pasteSucceeded: record.pasteSucceeded
    }));

    return {
      settings: toRendererSettings(),
      records: records?.length ? records : []
    };
  });

  ipcMain.handle('tailkall:save-settings', (_event, settings: RendererSettings) => {
    settingsStore?.saveSettings({
      cleanup: {
        enabled: Boolean(settings.apiKey && settings.model),
        provider: {
          type: 'openai-compatible',
          name: settings.provider || 'DeepSeek',
          baseUrl: settings.baseURL || 'https://api.deepseek.com/v1',
          apiKey: settings.apiKey,
          model: settings.model || 'deepseek-chat'
        },
        prompt: settings.prompt || '请在不改变原意的前提下整理语音输入文本，修正错别字和标点，直接返回整理后的文本。'
      },
      input: {
        trigger: { key: settings.triggerKey || 'F8', modifiers: [] },
        triggerLabel: settings.triggerKey || 'F8',
        recordMode: settings.recordMode,
        asr: settings.asr,
        localModelDir: settings.localModelDir,
        outputMode: settings.outputMode,
        dataDir: settings.dataDir
      }
    });
    return settings;
  });

  ipcMain.handle('tailkall:submit-recording', async (_event, audio: ArrayBuffer, durationMs: number) => {
    updateFloatingState({ visible: true, recording: false, status: 'recognizing' });
    const settings = settingsStore?.getSettings();
    if (!settingsStore || !settings) {
      return { ok: false, message: '设置存储不可用' };
    }

    const record = await runRecordingPipeline({
      audio,
      asrProvider: createConfiguredAsrProvider(settings.input.asr, settings.input.localModelDir, durationMs),
      cleanupText: async (transcript) => {
        if (!settings.cleanup.enabled || !settings.cleanup.provider) {
          return transcript;
        }
        updateFloatingState({ visible: true, recording: false, status: 'rewriting' });
        return cleanupText({
          provider: settings.cleanup.provider,
          transcript,
          prompt: settings.cleanup.prompt,
          fetch: fetch as FetchLike
        });
      },
      pasteText: async (text) => {
        if (settings.input.outputMode === '仅保存记录') {
          return { status: 'saved' };
        }
        await pasteTextToCursor(text, { clipboard, keyboard: { pressPasteShortcut: pressSystemPasteShortcut } });
        return { status: 'pasted' };
      },
      settingsStore
    });

    updateFloatingState({
      visible: true,
      recording: false,
      status: record.status === 'completed' ? 'done' : 'failed',
      error: record.error
    });
    setTimeout(() => updateFloatingState({ visible: false, recording: false }), 1200);
    return { ok: record.status === 'completed', record };
  });

  ipcMain.handle('tailkall:copy-text', (_event, text: string) => {
    clipboard.writeText(text);
  });

  ipcMain.handle('tailkall:paste-record', async (_event, id: string) => {
    const record = settingsStore?.listRecords().find((item) => item.id === id);
    const text = record?.cleanedText || record?.transcript;
    if (!text) return { ok: false, message: '记录不存在' };
    await pasteTextToCursor(text, {
      clipboard,
      keyboard: {
        pressPasteShortcut: pressSystemPasteShortcut
      }
    });
    return { ok: true };
  });

  ipcMain.handle('tailkall:delete-record', (_event, id: string) => {
    return settingsStore?.deleteRecord(id) ?? false;
  });

  ipcMain.handle('tailkall:test-rewrite-api', async (_event, settings: RendererSettings) => {
    const provider = {
      type: 'openai-compatible' as const,
      name: settings.provider || 'DeepSeek',
      baseUrl: settings.baseURL || 'https://api.deepseek.com/v1',
      apiKey: settings.apiKey,
      model: settings.model || 'deepseek-chat'
    };
    const result = await testCleanupProvider({
      provider,
      fetch: fetch as FetchLike
    });
    return result.ok ? { ok: true, message: '连接成功' } : { ok: false, message: result.error };
  });

  ipcMain.handle('tailkall:rewrite-record', async (_event, id: string) => {
    const record = settingsStore?.listRecords().find((item) => item.id === id);
    const settings = settingsStore?.getSettings();
    if (!record || !settings?.cleanup.provider) {
      return { ok: false, message: '记录或整理 API 未配置' };
    }
    const cleaned = await cleanupText({
      provider: settings.cleanup.provider,
      transcript: record.transcript,
      prompt: settings.cleanup.prompt,
      fetch: fetch as FetchLike
    });
    settingsStore?.updateRecord(id, { cleanedText: cleaned, status: 'completed' });
    return { ok: true, text: cleaned };
  });

  ipcMain.handle('tailkall:capture-trigger-key', () => 'F8');
}

function createConfiguredAsrProvider(asrName: string, localModelDir: string, durationMs: number) {
  return {
    name: asrName || '未配置 ASR',
    async transcribe(): Promise<{ text: string; provider: string }> {
      if (!asrName || /占位|未配置/.test(asrName)) {
        throw new Error('ASR 尚未配置，请在设置页选择本地或云端语音识别引擎。');
      }
      return {
        text: `已收到 ${Math.round(durationMs / 1000)} 秒录音。当前 ASR 适配器为 ${asrName}，模型目录 ${localModelDir}。请接入真实 ASR 后替换此占位文本。`,
        provider: asrName
      };
    }
  };
}

async function pressSystemPasteShortcut(): Promise<void> {
  if (process.platform !== 'win32') {
    mainWindow?.webContents.paste();
    return;
  }

  await execFileAsync('powershell.exe', [
    '-NoProfile',
    '-WindowStyle',
    'Hidden',
    '-Command',
    "$shell = New-Object -ComObject WScript.Shell; Start-Sleep -Milliseconds 80; $shell.SendKeys('^v')"
  ]);
}

app.whenReady().then(async () => {
  settingsStore = createSettingsStore({
    store: await createElectronStoreAdapter({
      cwd: defaultDataRoot()
    })
  });

  installIpcHandlers();
  await createMainWindow();
  await createFloating();
  updateFloatingState({ visible: false, recording: false });

  globalShortcut.register('F8', () => {
    isRecording = !isRecording;
    if (isRecording) {
      updateFloatingState({ visible: true, recording: true, status: 'recording' });
      mainWindow?.webContents.send('tailkall:recording-start');
    } else {
      updateFloatingState({ visible: true, recording: false, status: 'recognizing' });
      mainWindow?.webContents.send('tailkall:recording-stop');
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
