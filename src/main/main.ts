import { app, BrowserWindow, clipboard, globalShortcut, ipcMain, nativeImage, screen } from 'electron';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { createFloatingWindow, updateFloatingState } from './floatingWindow.js';
import {
  classifyPressDuration,
  parseTriggerLabelToAccelerator,
  parseTriggerLabelToBinding,
  pasteTextToCursor,
  type MouseTrigger,
  type TriggerBinding
} from './inputController.js';
import { cleanupText, createPythonAsrProvider, createWhisperCppAsrProvider, testCleanupProvider, type FetchLike } from './providers.js';
import { runRecordingPipeline } from './recorderCoordinator.js';
import { createElectronStoreAdapter, createSettingsStore, type SettingsStore } from './settingsStore.js';

type RendererSettings = {
  triggerKey: string;
  recordMode: string;
  asr: string;
  asrAcceleration: string;
  localModelDir: string;
  localAsrExePath: string;
  localAsrModelPath: string;
  ffmpegPath: string;
  fasterWhisperModelPath: string;
  senseVoiceModelPath: string;
  pythonPath: string;
  provider: string;
  baseURL: string;
  model: string;
  apiKey: string;
  prompt: string;
  outputMode: string;
  dataDir: string;
  shortPressAction: string;
  longPressAction: string;
  smartMouseMode: boolean;
};

let mainWindow: BrowserWindow | undefined;
let settingsStore: SettingsStore | undefined;
let isRecording = false;
let activeTriggerAccelerator: string | undefined;
let stopLowLevelTrigger: (() => void) | undefined;
const execFileAsync = promisify(execFile);
const LONG_PRESS_MS = 350;

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
    asr: settings?.input.asr ?? 'whisper.cpp',
    asrAcceleration: settings?.input.asrAcceleration ?? 'GPU 优先',
    localModelDir: settings?.input.localModelDir ?? join('D:\\Antigravity', 'tailkall', 'models'),
    localAsrExePath:
      settings?.input.localAsrExePath ?? join('D:\\Antigravity', 'tailkall', 'models', 'whisper', 'Release', 'whisper-cli.exe'),
    localAsrModelPath:
      settings?.input.localAsrModelPath ?? join('D:\\Antigravity', 'tailkall', 'models', 'whisper', 'ggml-small.bin'),
    ffmpegPath: settings?.input.ffmpegPath ?? join('D:\\Antigravity', 'tailkall', 'models', 'whisper', 'ffmpeg.exe'),
    fasterWhisperModelPath:
      settings?.input.fasterWhisperModelPath ?? join('D:\\Antigravity', 'tailkall', 'models', 'faster-whisper', 'small'),
    senseVoiceModelPath:
      settings?.input.senseVoiceModelPath ?? join('D:\\Antigravity', 'tailkall', 'models', 'sensevoice', 'SenseVoiceSmall'),
    pythonPath: settings?.input.pythonPath ?? join('D:\\Antigravity', 'tailkall', '.venv', 'Scripts', 'python.exe'),
    provider: settings?.cleanup.provider?.name ?? 'DeepSeek',
    baseURL: settings?.cleanup.provider?.baseUrl ?? 'https://api.deepseek.com/v1',
    model: settings?.cleanup.provider?.model ?? 'deepseek-chat',
    apiKey: settings?.cleanup.provider?.apiKey ?? '',
    prompt: settings?.cleanup.prompt ?? '请在不改变原意的前提下整理语音输入文本，修正错别字和标点，直接返回整理后的文本。',
    outputMode: settings?.input.outputMode ?? '粘贴到当前光标',
    dataDir: settings?.input.dataDir ?? defaultDataRoot(),
    shortPressAction: settings?.input.shortPressAction ?? '语音输入',
    longPressAction: settings?.input.longPressAction ?? '语音助手',
    smartMouseMode: settings?.input.smartMouseMode ?? true
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
    const saved = settingsStore?.saveSettings({
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
        asrAcceleration: settings.asrAcceleration,
        localModelDir: settings.localModelDir,
        localAsrExePath: settings.localAsrExePath,
        localAsrModelPath: settings.localAsrModelPath,
        ffmpegPath: settings.ffmpegPath,
        fasterWhisperModelPath: settings.fasterWhisperModelPath,
        senseVoiceModelPath: settings.senseVoiceModelPath,
        pythonPath: settings.pythonPath,
        outputMode: settings.outputMode,
        dataDir: settings.dataDir,
        shortPressAction: settings.shortPressAction,
        longPressAction: settings.longPressAction,
        smartMouseMode: settings.smartMouseMode
      }
    });
    void registerConfiguredTrigger(saved?.input.triggerLabel ?? settings.triggerKey, saved?.input.smartMouseMode);
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
      asrProvider: createConfiguredAsrProvider(settings, durationMs),
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

}

function setRecording(next: boolean): void {
  if (isRecording === next) {
    return;
  }
  isRecording = next;
  if (isRecording) {
    updateFloatingState({ visible: true, recording: true, status: 'recording' });
    mainWindow?.webContents.send('tailkall:recording-start');
  } else {
    updateFloatingState({ visible: true, recording: false, status: 'recognizing' });
    mainWindow?.webContents.send('tailkall:recording-stop');
  }
}

function toggleRecording(): void {
  setRecording(!isRecording);
}

async function registerConfiguredTrigger(label: string | undefined, smartMouseMode = true): Promise<void> {
  stopLowLevelTrigger?.();
  stopLowLevelTrigger = undefined;

  if (activeTriggerAccelerator) {
    globalShortcut.unregister(activeTriggerAccelerator);
    activeTriggerAccelerator = undefined;
  }

  const triggerLabels = smartMouseMode ? [label || 'F8', 'Mouse Middle'] : [label || 'F8'];
  const hookRegistered = await registerLowLevelTriggers(triggerLabels);
  if (hookRegistered) {
    return;
  }

  const accelerator = parseTriggerLabelToAccelerator(label || 'F8') ?? 'F8';
  if (globalShortcut.register(accelerator, toggleRecording)) {
    activeTriggerAccelerator = accelerator;
  }
}

async function registerLowLevelTriggers(labels: string[]): Promise<boolean> {
  const bindings = uniqueBindings(labels.map((label) => parseTriggerLabelToBinding(label)).filter(Boolean) as TriggerBinding[]);
  if (!bindings.length) {
    return false;
  }

  try {
    const { uIOhook } = await import('uiohook-napi');
    const downStartedAt = new Map<string, number>();
    const longPressTimers = new Map<string, NodeJS.Timeout>();
    let longPressActive = false;

    const clearLongPressTimer = (bindingId: string) => {
      const timer = longPressTimers.get(bindingId);
      if (timer) {
        clearTimeout(timer);
        longPressTimers.delete(bindingId);
      }
    };
    const onDown = (event: unknown) => {
      const binding = bindings.find((candidate) => matchesTriggerEvent(candidate, event));
      if (!binding) {
        return;
      }
      const bindingId = bindingToId(binding);
      if (downStartedAt.has(bindingId)) {
        return;
      }
      downStartedAt.set(bindingId, Date.now());
      longPressActive = false;
      longPressTimers.set(bindingId, setTimeout(() => {
        longPressActive = true;
        setRecording(true);
      }, LONG_PRESS_MS));
    };
    const onUp = (event: unknown) => {
      const binding = bindings.find((candidate) => matchesTriggerEvent(candidate, event));
      if (!binding) {
        return;
      }
      const bindingId = bindingToId(binding);
      const startedAt = downStartedAt.get(bindingId);
      downStartedAt.delete(bindingId);
      clearLongPressTimer(bindingId);
      if (startedAt === undefined) {
        return;
      }
      if (longPressActive || classifyPressDuration(startedAt, Date.now(), LONG_PRESS_MS) === 'long') {
        setRecording(false);
        longPressActive = false;
        return;
      }
      toggleRecording();
    };

    uIOhook.on('mousedown', onDown);
    uIOhook.on('mouseup', onUp);
    uIOhook.on('keydown', onDown);
    uIOhook.on('keyup', onUp);
    uIOhook.start();
    stopLowLevelTrigger = () => {
      for (const bindingId of longPressTimers.keys()) {
        clearLongPressTimer(bindingId);
      }
      uIOhook.off('mousedown', onDown);
      uIOhook.off('mouseup', onUp);
      uIOhook.off('keydown', onDown);
      uIOhook.off('keyup', onUp);
    };
    return true;
  } catch (error) {
    console.warn('Low-level trigger hook unavailable, falling back to Electron globalShortcut.', error);
    return false;
  }
}

function uniqueBindings(bindings: TriggerBinding[]): TriggerBinding[] {
  const unique = new Map<string, TriggerBinding>();
  for (const binding of bindings) {
    unique.set(bindingToId(binding), binding);
  }
  return [...unique.values()];
}

function bindingToId(binding: TriggerBinding): string {
  if (binding.type === 'mouse') {
    return `mouse:${binding.button}`;
  }
  return `keyboard:${binding.modifiers.join('+')}:${binding.key}`;
}

function matchesTriggerEvent(binding: TriggerBinding, event: unknown): boolean {
  if (!event || typeof event !== 'object') {
    return false;
  }
  const candidate = event as {
    altKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
    shiftKey?: boolean;
    keycode?: number;
    button?: unknown;
  };
  if (!modifiersMatch(binding, candidate)) {
    return false;
  }
  if (binding.type === 'mouse') {
    return mouseButtonCode(binding.button) === Number(candidate.button);
  }
  return keyCodeForLabel(binding.key) === candidate.keycode;
}

function modifiersMatch(
  binding: TriggerBinding,
  event: { altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }
): boolean {
  if (binding.type !== 'keyboard') {
    return true;
  }
  const modifiers = new Set(binding.modifiers.map((item) => item.toLowerCase()));
  return Boolean(event.ctrlKey) === (modifiers.has('ctrl') || modifiers.has('control')) &&
    Boolean(event.altKey) === (modifiers.has('alt') || modifiers.has('option')) &&
    Boolean(event.shiftKey) === modifiers.has('shift') &&
    Boolean(event.metaKey) === (modifiers.has('meta') || modifiers.has('cmd') || modifiers.has('command'));
}

function keyCodeForLabel(label: string): number | undefined {
  const upper = label.trim().toUpperCase();
  const fKey = /^F(\d{1,2})$/.exec(upper);
  if (fKey) {
    const index = Number(fKey[1]);
    if (index >= 1 && index <= 10) return 58 + index;
    if (index === 11) return 87;
    if (index === 12) return 88;
  }
  if (/^[A-Z]$/.test(upper)) {
    return {
      A: 30, B: 48, C: 46, D: 32, E: 18, F: 33, G: 34, H: 35, I: 23, J: 36, K: 37, L: 38, M: 50,
      N: 49, O: 24, P: 25, Q: 16, R: 19, S: 31, T: 20, U: 22, V: 47, W: 17, X: 45, Y: 21, Z: 44
    }[upper];
  }
  if (/^[0-9]$/.test(upper)) {
    return { '0': 11, '1': 2, '2': 3, '3': 4, '4': 5, '5': 6, '6': 7, '7': 8, '8': 9, '9': 10 }[upper];
  }
  if (upper === 'SPACE') return 57;
  if (upper === 'META') return 3675;
  if (upper === 'CTRL' || upper === 'CONTROL') return 29;
  if (upper === 'ALT') return 56;
  if (upper === 'SHIFT') return 42;
  return undefined;
}

function mouseButtonCode(button: MouseTrigger['button']): number {
  switch (button) {
    case 'middle':
      return 3;
    case 'x1':
      return 4;
    case 'x2':
      return 5;
    case 'left':
      return 1;
    case 'right':
      return 2;
    default:
      return 0;
  }
}

function createConfiguredAsrProvider(settings: ReturnType<SettingsStore['getSettings']>, durationMs: number) {
  const asrName = settings.input.asr;
  const commonPythonOptions = {
    pythonPath: settings.input.pythonPath,
    tmpDir: join('D:\\Antigravity', 'tailkall', 'tmp'),
    ffmpegPath: settings.input.ffmpegPath || undefined,
    acceleration: settings.input.asrAcceleration === 'CPU' ? ('cpu' as const) : ('auto-gpu' as const)
  };
  if (/sensevoice|funasr/i.test(asrName)) {
    return createPythonAsrProvider({
      ...commonPythonOptions,
      engine: 'sensevoice-funasr',
      scriptPath: join('D:\\Antigravity', 'tailkall', 'scripts', 'asr-sensevoice.py'),
      modelPath: settings.input.senseVoiceModelPath
    });
  }
  if (/faster-whisper/i.test(asrName)) {
    return createPythonAsrProvider({
      ...commonPythonOptions,
      engine: 'faster-whisper',
      scriptPath: join('D:\\Antigravity', 'tailkall', 'scripts', 'asr-faster-whisper.py'),
      modelPath: settings.input.fasterWhisperModelPath
    });
  }
  if (/whisper|本地/i.test(asrName)) {
    return createWhisperCppAsrProvider({
      executablePath: settings.input.localAsrExePath,
      modelPath: settings.input.localAsrModelPath,
      tmpDir: join('D:\\Antigravity', 'tailkall', 'tmp'),
      ffmpegPath: settings.input.ffmpegPath || undefined,
      acceleration: settings.input.asrAcceleration === 'CPU' ? 'cpu' : 'auto-gpu'
    });
  }

  return {
    name: asrName || '未配置 ASR',
    async transcribe(): Promise<{ text: string; provider: string }> {
      if (!asrName || /占位|未配置/.test(asrName)) {
        throw new Error('ASR 尚未配置，请在设置页选择本地或云端语音识别引擎。');
      }
      return {
        text: `已收到 ${Math.round(durationMs / 1000)} 秒录音。当前 ASR 适配器为 ${asrName}。请接入真实云端 ASR 后替换此占位文本。`,
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
  const startupSettings = settingsStore.getSettings();
  await registerConfiguredTrigger(startupSettings.input.triggerLabel, startupSettings.input.smartMouseMode);

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
