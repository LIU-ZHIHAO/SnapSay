import { app, BrowserWindow, clipboard, globalShortcut, ipcMain, Menu, nativeImage, screen } from 'electron';
import { execFile, spawn } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { createFloatingWindow, updateFloatingState } from './floatingWindow.js';
import {
  parseTriggerLabelToAccelerator,
  parseTriggerLabelToBinding,
  pasteTextToCursor,
  resolveTriggerReleaseAction,
  type MouseTrigger,
  type TriggerBinding
} from './inputController.js';
import { cleanupText, createAsrDaemonProvider, createCloudAsrProvider, createCloudStreamingAsrProvider, createPythonAsrProvider, createWhisperCppAsrProvider, formatProviderTestDuration, resolveActiveCleanupProvider, testCleanupProvider, type FetchLike } from './providers.js';
import { runRecordingPipeline } from './recorderCoordinator.js';
import { createElectronStoreAdapter, createSettingsStore, type SettingsStore, type TranscriptionRecord } from './settingsStore.js';
import type { AsrProfileConfig, LlmProviderConfig } from './settingsStore.js';
import { applyWordbook, buildWordbookPrompt, extractWordPairCandidates } from './wordbook.js';
import type { WordbookEntry } from './wordbook.js';
import { DEFAULT_CLEANUP_PROMPT, shouldCleanupTranscript, resolvePromptText } from '../shared/cleanupPolicy.js';

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
  cleanupEnabled: boolean;
  provider: string;
  baseURL: string;
  model: string;
  apiKey: string;
  llmProviders: LlmProviderConfig[];
  activeLlmProviderKey: string;
  prompt: string;
  outputMode: string;
  dataDir: string;
  microphoneDeviceId: string;
  shortPressAction: string;
  longPressAction: string;
  smartMouseMode: boolean;
  mouseTrigger: string;
  cloudAsrType: string;
  cloudAsrBaseUrl: string;
  cloudAsrApiKey: string;
  cloudAsrModel: string;
  asrProfiles: AsrProfileConfig[];
  activeAsrProfileId: string;
};

const FLOATING_POS_FILE = join('D:\\Antigravity', 'tailkall', 'data', 'floating-pos.json');
let savePositionTimer: ReturnType<typeof setTimeout> | undefined;

function loadFloatingPosition(): { x: number; y: number } | undefined {
  try {
    const data = JSON.parse(readFileSync(FLOATING_POS_FILE, 'utf-8')) as unknown;
    if (data && typeof data === 'object' && 'x' in data && 'y' in data &&
        typeof (data as { x: unknown }).x === 'number' && typeof (data as { y: unknown }).y === 'number') {
      return data as { x: number; y: number };
    }
  } catch {
    // file doesn't exist or is invalid
  }
  return undefined;
}

function saveFloatingPosition(x: number, y: number): void {
  if (savePositionTimer) clearTimeout(savePositionTimer);
  savePositionTimer = setTimeout(() => {
    try {
      writeFileSync(FLOATING_POS_FILE, JSON.stringify({ x, y }));
    } catch {
      // ignore write errors
    }
  }, 500);
}


let mainWindow: BrowserWindow | undefined;
let settingsStore: SettingsStore | undefined;
let isRecording = false;
let activeTriggerAccelerator: string | undefined;
let stopLowLevelTrigger: (() => void) | undefined;
let asrDaemonPort: number | undefined;
let asrDaemonEngine: 'sensevoice' | 'faster-whisper' | undefined;
const execFileAsync = promisify(execFile);
const LONG_PRESS_MS = 350;
const ASR_PORT_FILE_SV = join('D:\\Antigravity', 'tailkall', 'data', 'asr-daemon.port');
const ASR_PORT_FILE_FW = join('D:\\Antigravity', 'tailkall', 'data', 'asr-daemon-fw.port');

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

async function startAsrDaemon(settings: ReturnType<SettingsStore['getSettings']>): Promise<void> {
  const asrName = settings.input.asr;
  const isSenseVoice = /sensevoice|funasr/i.test(asrName);
  const isFasterWhisper = /faster-whisper/i.test(asrName);
  if (!isSenseVoice && !isFasterWhisper) return;

  const portFile = isSenseVoice ? ASR_PORT_FILE_SV : ASR_PORT_FILE_FW;
  const scriptPath = isSenseVoice
    ? join('D:\\Antigravity', 'tailkall', 'scripts', 'asr-daemon.py')
    : join('D:\\Antigravity', 'tailkall', 'scripts', 'asr-daemon-fw.py');
  const modelPath = isSenseVoice
    ? settings.input.senseVoiceModelPath
    : settings.input.fasterWhisperModelPath;
  const device = settings.input.asrAcceleration === 'CPU' ? 'cpu' : (isSenseVoice ? 'cuda:0' : 'cuda');

  try { unlinkSync(portFile); } catch { /* ignore */ }

  const daemon = spawn(settings.input.pythonPath, [scriptPath], {
    cwd: join('D:\\Antigravity', 'tailkall'),
    env: {
      ...process.env,
      ASR_MODEL_PATH: modelPath,
      ASR_DEVICE: device,
      ASR_PORT_FILE: portFile,
      MODELSCOPE_CACHE: join('D:\\Antigravity', 'tailkall', 'cache', 'modelscope'),
      HF_HOME: join('D:\\Antigravity', 'tailkall', 'cache', 'huggingface'),
      HUGGINGFACE_HUB_CACHE: join('D:\\Antigravity', 'tailkall', 'cache', 'huggingface', 'hub')
    },
    windowsHide: true,
    stdio: 'ignore',
    detached: false
  });

  daemon.unref();

  app.on('will-quit', () => {
    try { daemon.kill(); } catch { /* ignore */ }
    try { unlinkSync(portFile); } catch { /* ignore */ }
  });

  await new Promise<void>((resolve) => {
    const start = Date.now();
    const poll = setInterval(() => {
      try {
        const port = parseInt(readFileSync(portFile, 'utf-8').trim(), 10);
        if (port > 0) {
          asrDaemonPort = port;
          asrDaemonEngine = isSenseVoice ? 'sensevoice' : 'faster-whisper';
          clearInterval(poll);
          resolve();
        }
      } catch { /* not ready yet */ }
      if (Date.now() - start > 30_000) {
        clearInterval(poll);
        resolve();
      }
    }, 100);
  });
}

async function createMainWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 1040,
    minHeight: 680,
    title: 'SnapSay',
    frame: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
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
  const size = { width: 120, height: 30 };
  const savedPos = loadFloatingPosition();
  const x = savedPos?.x ?? Math.round(display.workArea.x + (display.workArea.width - size.width) / 2);
  const y = savedPos?.y ?? Math.round(display.workArea.y + display.workArea.height - size.height - 36);

  let floatingBrowserWindow: BrowserWindow | undefined;

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
    floatingBrowserWindow = floating;
    void floating.loadURL(rendererUrl('floating.html'));
    return floating;
  });

  floatingBrowserWindow?.on('moved', () => {
    const bounds = floatingBrowserWindow?.getBounds();
    if (bounds) saveFloatingPosition(bounds.x, bounds.y);
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
    ffmpegPath: settings?.input.ffmpegPath ?? 'ffmpeg',
    fasterWhisperModelPath:
      settings?.input.fasterWhisperModelPath ?? join('D:\\Antigravity', 'tailkall', 'models', 'faster-whisper', 'small'),
    senseVoiceModelPath:
      settings?.input.senseVoiceModelPath ?? join('D:\\Antigravity', 'tailkall', 'models', 'sensevoice', 'SenseVoiceSmall'),
    pythonPath: settings?.input.pythonPath ?? join('D:\\Antigravity', 'tailkall', '.venv', 'Scripts', 'python.exe'),
    cleanupEnabled: settings?.cleanup.enabled ?? false,
    provider: settings?.cleanup.provider?.name ?? 'DeepSeek',
    baseURL: settings?.cleanup.provider?.baseUrl ?? 'https://api.deepseek.com/v1',
    model: settings?.cleanup.provider?.model ?? 'deepseek-chat',
    apiKey: settings?.cleanup.provider?.apiKey ?? '',
    llmProviders: settings?.cleanup.providers ?? [],
    activeLlmProviderKey: settings?.cleanup.activeProviderKey ?? 'deepseek',
    prompt: settings?.cleanup.prompt ?? DEFAULT_CLEANUP_PROMPT,
    outputMode: settings?.input.outputMode ?? '粘贴到当前光标',
    dataDir: settings?.input.dataDir ?? defaultDataRoot(),
    microphoneDeviceId: settings?.input.microphoneDeviceId ?? '',
    shortPressAction: settings?.input.shortPressAction ?? '语音输入',
    longPressAction: settings?.input.longPressAction ?? '语音助手',
    smartMouseMode: settings?.input.smartMouseMode ?? true,
    mouseTrigger: settings?.input.mouseTrigger ?? 'Mouse Middle',
    cloudAsrType: settings?.input.cloudAsr?.type ?? 'openai-whisper',
    cloudAsrBaseUrl: settings?.input.cloudAsr?.baseUrl ?? '',
    cloudAsrApiKey: settings?.input.cloudAsr?.apiKey ?? '',
    cloudAsrModel: settings?.input.cloudAsr?.model ?? 'whisper-1',
    asrProfiles: settings?.input.asrProfiles ?? [],
    activeAsrProfileId: settings?.input.activeAsrProfileId ?? 'local-sensevoice'
  };
}

function toRendererRecord(record: TranscriptionRecord) {
  return {
    id: record.id,
    time: new Date(record.createdAt).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }),
    original: record.transcript,
    refined: record.cleanedText ?? record.transcript,
    userCorrection: record.userCorrection,
    status: record.status === 'completed' ? '已输入' : '失败',
    asr: [record.asrProvider, record.asrModel].filter(Boolean).join(' / '),
    cleanup: [record.cleanupProvider, record.cleanupModel].filter(Boolean).join(' / '),
    cleanupStatus: record.cleanedText ? 'success' : record.cleanupDurationMs != null && record.error ? 'failed' : undefined,
    durationMs: record.durationMs,
    asrDurationMs: record.asrDurationMs,
    cleanupDurationMs: record.cleanupDurationMs,
    pasteSucceeded: record.pasteSucceeded,
    error: record.error
  };
}

function installIpcHandlers(): void {
  ipcMain.handle('tailkall:get-dashboard', () => {
    const records = settingsStore?.listRecords().map(toRendererRecord);

    return {
      settings: toRendererSettings(),
      records: records?.length ? records : []
    };
  });

  ipcMain.handle('tailkall:save-settings', (_event, settings: RendererSettings) => {
    const saved = settingsStore?.saveSettings({
      cleanup: {
        enabled: settings.cleanupEnabled,
        provider: {
          type: 'openai-compatible',
          name: settings.provider || 'DeepSeek',
          baseUrl: settings.baseURL || 'https://api.deepseek.com/v1',
          apiKey: settings.apiKey,
          model: settings.model || 'deepseek-chat'
        },
        providers: settings.llmProviders,
        activeProviderKey: settings.activeLlmProviderKey,
        prompt: settings.prompt || DEFAULT_CLEANUP_PROMPT
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
        microphoneDeviceId: settings.microphoneDeviceId || '',
        shortPressAction: settings.shortPressAction,
        longPressAction: settings.longPressAction,
        smartMouseMode: true,
        mouseTrigger: settings.mouseTrigger || 'Mouse Middle',
        // BUG FIX: preserve wordbook; wordbook is saved independently via tailkall:save-wordbook
        wordbook: settingsStore?.getSettings().input.wordbook ?? [],
        asrProfiles: settings.asrProfiles,
        activeAsrProfileId: settings.activeAsrProfileId,
        cloudAsr: settings.cloudAsrBaseUrl ? {
          type: (settings.cloudAsrType as 'openai-whisper' | 'openai-compatible') || 'openai-whisper',
          baseUrl: settings.cloudAsrBaseUrl,
          apiKey: settings.cloudAsrApiKey,
          model: settings.cloudAsrModel || 'whisper-1'
        } : undefined
      }
    });
    void registerConfiguredTrigger(saved?.input.triggerLabel ?? settings.triggerKey, saved?.input.mouseTrigger);
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
      durationMs,
      applyWordbook: (text) => applyWordbook(text, settings.input.wordbook ?? []),
      shouldCleanupText: (transcript) =>
        Boolean(settings.cleanup.enabled && settings.cleanup.provider && shouldCleanupTranscript(transcript)),
      cleanupText: async (transcript) => {
        const provider = resolveActiveCleanupProvider(settings);
        if (!settings.cleanup.enabled || !provider) {
          return transcript;
        }
        updateFloatingState({ visible: true, recording: false, status: 'rewriting' });
        const basePrompt = resolvePromptText(settings.cleanup.prompt);
        const wordbookSuffix = buildWordbookPrompt(settings.input.wordbook ?? []);
        return cleanupText({
          provider,
          transcript,
          prompt: basePrompt + wordbookSuffix,
          fetch: fetch as FetchLike,
          timeoutMs: 15_000
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

    // Auto-delete short accidental recordings (< 5 chars)
    const transcript = record.transcript ?? '';
    if (transcript.length < 5) {
      settingsStore?.deleteRecord(record.id);
    } else {
      // Send full records list to avoid race condition with getDashboard
      const allRecords = settingsStore?.listRecords() ?? [];
      mainWindow?.webContents.send('tailkall:records-synced', allRecords.map(toRendererRecord));
    }

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
    const success = settingsStore?.deleteRecord(id) ?? false;
    if (success) {
      mainWindow?.webContents.send('tailkall:record-deleted', id);
    }
    return success;
  });

  ipcMain.handle('tailkall:clear-all-records', () => {
    settingsStore?.clearAllRecords();
    mainWindow?.webContents.send('tailkall:records-cleared');
    return { ok: true };
  });

  ipcMain.handle('tailkall:clear-diagnostic-logs', () => {
    const cleared = settingsStore?.clearDiagnosticLogs() ?? 0;
    const records = settingsStore?.listRecords().map(toRendererRecord) ?? [];
    mainWindow?.webContents.send('tailkall:records-synced', records);
    return { ok: true, cleared, records };
  });

  ipcMain.handle('tailkall:test-rewrite-api', async (_event, settings: RendererSettings) => {
    const provider = {
      type: 'openai-compatible' as const,
      name: settings.provider || '文案整理模型',
      baseUrl: settings.baseURL,
      apiKey: settings.apiKey,
      model: settings.model
    };
    const result = await testCleanupProvider({
      provider,
      fetch: fetch as FetchLike
    });
    return result.ok
      ? { ok: true, message: `连接成功（${formatProviderTestDuration(result.durationMs)}）`, durationMs: result.durationMs }
      : { ok: false, message: result.error };
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
      prompt: resolvePromptText(settings.cleanup.prompt),
      fetch: fetch as FetchLike
    });
    const updated = settingsStore?.updateRecord(id, { cleanedText: cleaned, status: 'completed' });
    if (updated) {
      mainWindow?.webContents.send('tailkall:record-updated', updated);
    }
    return { ok: true, text: cleaned };
  });

  ipcMain.handle('tailkall:save-correction', (_event, id: string, correctionText: string) => {
    settingsStore?.updateRecord(id, { userCorrection: correctionText });
    return { ok: true };
  });

  // Independently save wordbook without touching other settings
  ipcMain.handle('tailkall:save-wordbook', (_event, wordbook: WordbookEntry[]) => {
    if (!settingsStore) return { ok: false };
    const settings = settingsStore.getSettings();
    settingsStore.saveSettings({ input: { ...settings.input, wordbook } });
    return { ok: true };
  });

  // Extract candidate word pairs from a correction record (for quick-add-to-wordbook)
  ipcMain.handle('tailkall:extract-word-pairs', (_event, id: string) => {
    if (!settingsStore) return { ok: false, pairs: [] };
    const record = settingsStore.listRecords().find((r) => r.id === id);
    if (!record?.userCorrection) return { ok: false, pairs: [] };
    const pairs = extractWordPairCandidates(record.transcript, record.userCorrection);
    return { ok: true, pairs };
  });

  ipcMain.handle('tailkall:window-control', (_event, action: 'minimize' | 'toggle-maximize' | 'close') => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return false;
    }
    if (action === 'minimize') {
      mainWindow.minimize();
      return true;
    }
    if (action === 'toggle-maximize') {
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
      } else {
        mainWindow.maximize();
      }
      return true;
    }
    if (action === 'close') {
      mainWindow.close();
      return true;
    }
    return false;
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

async function registerConfiguredTrigger(keyboardLabel: string | undefined, mouseLabel: string | undefined): Promise<void> {
  stopLowLevelTrigger?.();
  stopLowLevelTrigger = undefined;

  if (activeTriggerAccelerator) {
    globalShortcut.unregister(activeTriggerAccelerator);
    activeTriggerAccelerator = undefined;
  }

  const triggerLabels = [keyboardLabel || 'F8', mouseLabel || 'Mouse Middle'].filter(Boolean);
  const hookRegistered = await registerLowLevelTriggers(triggerLabels);
  if (hookRegistered) {
    return;
  }

  const accelerator = parseTriggerLabelToAccelerator(keyboardLabel || 'F8') ?? 'F8';
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
    const recordingStateAtDown = new Map<string, boolean>();
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
      recordingStateAtDown.set(bindingId, isRecording);
      setRecording(true);
    };
    const onUp = (event: unknown) => {
      const binding = bindings.find((candidate) => matchesTriggerEvent(candidate, event));
      if (!binding) {
        return;
      }
      const bindingId = bindingToId(binding);
      const startedAt = downStartedAt.get(bindingId);
      downStartedAt.delete(bindingId);
      const wasRecordingAtDown = recordingStateAtDown.get(bindingId) ?? false;
      recordingStateAtDown.delete(bindingId);
      if (startedAt === undefined) {
        return;
      }
      const releaseAction = resolveTriggerReleaseAction({
        wasRecordingAtDown,
        startedAt,
        endedAt: Date.now(),
        longPressMs: LONG_PRESS_MS
      });
      if (releaseAction === 'stop-recording') {
        setRecording(false);
      }
    };

    uIOhook.on('mousedown', onDown);
    uIOhook.on('mouseup', onUp);
    uIOhook.on('keydown', onDown);
    uIOhook.on('keyup', onUp);
    uIOhook.start();
    stopLowLevelTrigger = () => {
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
  const activeProfile = settings.input.asrProfiles.find((profile) => profile.id === settings.input.activeAsrProfileId);
  const asrName = activeProfile?.kind === 'local' ? activeProfile.engine : settings.input.asr;
  const wordbookPrompt = (settings.input.wordbook ?? [])
    .map((e) => e.target)
    .filter(Boolean)
    .join(', ');
  const commonPythonOptions = {
    pythonPath: settings.input.pythonPath,
    tmpDir: join('D:\\Antigravity', 'tailkall', 'tmp'),
    ffmpegPath: settings.input.ffmpegPath || undefined,
    acceleration: settings.input.asrAcceleration === 'CPU' ? ('cpu' as const) : ('auto-gpu' as const)
  };
  if (/sensevoice|funasr/i.test(asrName)) {
    if (asrDaemonPort && asrDaemonEngine === 'sensevoice') {
      return createAsrDaemonProvider(asrDaemonPort);
    }
    return createPythonAsrProvider({
      ...commonPythonOptions,
      engine: 'sensevoice-funasr',
      scriptPath: join('D:\\Antigravity', 'tailkall', 'scripts', 'asr-sensevoice.py'),
      modelPath: settings.input.senseVoiceModelPath
      // SenseVoice does not support prompt injection
    });
  }
  if (/faster-whisper/i.test(asrName)) {
    if (asrDaemonPort && asrDaemonEngine === 'faster-whisper') {
      return createAsrDaemonProvider(asrDaemonPort);
    }
    return createPythonAsrProvider({
      ...commonPythonOptions,
      engine: 'faster-whisper',
      scriptPath: join('D:\\Antigravity', 'tailkall', 'scripts', 'asr-faster-whisper.py'),
      modelPath: settings.input.fasterWhisperModelPath,
      prompt: wordbookPrompt || undefined
    });
  }
  if (/whisper|本地/i.test(asrName)) {
    return createWhisperCppAsrProvider({
      executablePath: settings.input.localAsrExePath,
      modelPath: settings.input.localAsrModelPath,
      tmpDir: join('D:\\Antigravity', 'tailkall', 'tmp'),
      ffmpegPath: settings.input.ffmpegPath || undefined,
      acceleration: settings.input.asrAcceleration === 'CPU' ? 'cpu' : 'auto-gpu',
      prompt: wordbookPrompt || undefined
    });
  }
  if (activeProfile?.kind === 'cloud-upload') {
    return createCloudAsrProvider({
      provider: {
        type: 'openai-whisper',
        baseUrl: activeProfile.baseUrl || 'https://api.openai.com',
        apiKey: activeProfile.apiKey || '',
        model: activeProfile.model || 'whisper-1'
      },
      fetch: fetch as FetchLike
    });
  }
  if (activeProfile?.kind === 'cloud-streaming') {
    return createCloudStreamingAsrProvider({ provider: activeProfile });
  }
  if (/云端|cloud|api/i.test(asrName) && settings.input.cloudAsr) {
    return createCloudAsrProvider({
      provider: settings.input.cloudAsr,
      fetch: fetch as FetchLike
    });
  }

  return {
    name: asrName || '未配置 ASR',
    async transcribe(): Promise<{ text: string; provider: string }> {
      if (!asrName || /占位|未配置/.test(asrName)) {
        throw new Error('ASR 尚未配置，请在模型页选择本地或云端语音识别引擎。');
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
  Menu.setApplicationMenu(null);
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
  // Start ASR daemon in background — don't await, it loads while user interacts with the app
  void startAsrDaemon(startupSettings);
  await registerConfiguredTrigger(startupSettings.input.triggerLabel, startupSettings.input.mouseTrigger);

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
