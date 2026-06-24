import { app, BrowserWindow, clipboard, dialog, globalShortcut, ipcMain, Menu, nativeImage, screen, shell, systemPreferences, type MessageBoxOptions } from 'electron';
import { execFile, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, delimiter, dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { createFloatingWindow, updateFloatingState } from './floatingWindow.js';
import {
  parseTriggerLabelToAccelerator,
  parseTriggerLabelToBinding,
  pasteTextToCursor,
  resolveTriggerDownAction,
  resolveTriggerReleaseAction,
  shouldUseLowLevelKeyboardHook,
  type MouseTrigger,
  type TriggerBinding
} from './inputController.js';
import { downloadSenseVoiceOnnxModel, getLocalModelStatus, openLocalModelDir } from './localModelManager.js';
import { cleanupText, createAsrDaemonProvider, createCloudAsrProvider, createCloudStreamingAsrProvider, createPythonAsrProvider, formatProviderTestDuration, resolveConfiguredCleanupProvider, resolvePythonExecutable, testCleanupProvider, type FetchLike } from './providers.js';
import { runRecordingPipeline } from './recorderCoordinator.js';
import { createSqliteRecordStore, normalizeImportedRecord } from './recordStore.js';
import { createElectronStoreAdapter, createSettingsStore, migrateLegacyRecordsToRecordStore, type SettingsStore, type TranscriptionRecord } from './settingsStore.js';
import type { AsrProfileConfig, LlmProviderConfig } from './settingsStore.js';
import { createTransferPayload, createWordbookTransferPayload, mergeWordbookEntries, parseTransferPayload, parseWordbookTransferPayload } from './transfer.js';
import { applyWordbook, buildWordbookPrompt, extractWordPairCandidates, mergeWordbookPairs } from './wordbook.js';
import type { WordbookEntry } from './wordbook.js';
import { DEFAULT_CLEANUP_PROMPT, shouldCleanupTranscript, resolvePromptText } from '../shared/cleanupPolicy.js';

const APP_ROOT = app.getAppPath();
const INSTALL_ROOT = app.isPackaged ? dirname(process.execPath) : APP_ROOT;
const HAS_CUSTOM_RUNTIME_ROOT = Boolean(process.env.SNAPSAY_ROOT);
const RUNTIME_ROOT = process.env.SNAPSAY_ROOT ?? defaultRuntimeRoot();
process.env.SNAPSAY_ROOT = RUNTIME_ROOT;
const PROJECT_ROOT = APP_ROOT;
const DATA_DIR = join(RUNTIME_ROOT, 'data');
const LOGS_DIR = join(RUNTIME_ROOT, 'logs');
const CACHE_DIR = join(RUNTIME_ROOT, 'cache');
const MODELS_DIR = join(RUNTIME_ROOT, 'models');
const TMP_DIR = join(RUNTIME_ROOT, 'tmp');

function defaultRuntimeRoot(): string {
  if (!app.isPackaged) {
    return APP_ROOT;
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'SnapSay');
  }
  return join(dirname(INSTALL_ROOT), `${basename(INSTALL_ROOT)}Data`);
}

function migrateInstallLocalRuntimeData(): void {
  if (!app.isPackaged || HAS_CUSTOM_RUNTIME_ROOT) {
    return;
  }
  for (const name of ['data', 'models', 'logs', 'cache', 'tmp']) {
    const newPath = join(RUNTIME_ROOT, name);
    for (const oldPath of legacyRuntimeRoots().map((root) => join(root, name))) {
      if (!existsSync(oldPath) || oldPath === newPath) {
        continue;
      }
      try {
        mkdirSync(dirname(newPath), { recursive: true });
        if (!existsSync(newPath)) {
          moveOrCopyRuntimeDir(oldPath, newPath);
        } else {
          cpSync(oldPath, newPath, { recursive: true, force: false, errorOnExist: false });
          rmSync(oldPath, { recursive: true, force: true });
        }
      } catch (error) {
        console.warn(`Failed to migrate runtime directory ${oldPath} to ${newPath}:`, error);
      }
    }
  }
}

function moveOrCopyRuntimeDir(oldPath: string, newPath: string): void {
  try {
    renameSync(oldPath, newPath);
  } catch {
    cpSync(oldPath, newPath, { recursive: true, force: false, errorOnExist: false });
    rmSync(oldPath, { recursive: true, force: true });
  }
}

function legacyRuntimeRoots(): string[] {
  const roots = new Set<string>();
  roots.add(join(INSTALL_ROOT, '..', `${basename(INSTALL_ROOT)}Data`));
  roots.add(join(INSTALL_ROOT, 'data', '..'));
  if (process.platform === 'darwin') {
    roots.add(join(dirname(INSTALL_ROOT), `${basename(INSTALL_ROOT)}Data`));
  }
  return [...roots].filter((root) => root !== RUNTIME_ROOT);
}

type RendererSettings = {
  triggerKey: string;
  recordMode: string;
  asr: string;
  asrAcceleration: string;
  localModelDir: string;
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
  wordbook: WordbookEntry[];
};

const FLOATING_POS_FILE = join(DATA_DIR, 'floating-pos.json');
let savePositionTimer: ReturnType<typeof setTimeout> | undefined;
const FLOATING_SIZE = { width: 120, height: 30 };
let floatingBrowserWindow: BrowserWindow | undefined;

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

function clampFloatingPosition(
  position: { x: number; y: number } | undefined,
  workArea: { x: number; y: number; width: number; height: number },
  size: { width: number; height: number }
): { x: number; y: number } {
  const fallback = {
    x: Math.round(workArea.x + (workArea.width - size.width) / 2),
    y: Math.round(workArea.y + workArea.height - size.height - 36)
  };
  const candidate = position ?? fallback;
  const maxX = workArea.x + Math.max(0, workArea.width - size.width);
  const maxY = workArea.y + Math.max(0, workArea.height - size.height);
  return {
    x: Math.min(Math.max(candidate.x, workArea.x), maxX),
    y: Math.min(Math.max(candidate.y, workArea.y), maxY)
  };
}

function preferredFloatingPosition(): { x: number; y: number } {
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  return clampFloatingPosition(undefined, display.workArea, FLOATING_SIZE);
}

function prepareFloatingForCurrentSpace(): void {
  if (!floatingBrowserWindow || floatingBrowserWindow.isDestroyed()) {
    return;
  }
  const position = preferredFloatingPosition();
  floatingBrowserWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  floatingBrowserWindow.setAlwaysOnTop(true, 'screen-saver');
  floatingBrowserWindow.setBounds({ ...position, ...FLOATING_SIZE });
}


let mainWindow: BrowserWindow | undefined;
let settingsStore: SettingsStore | undefined;
let isRecording = false;
let recordingGeneration = 0;
let activeTriggerAccelerators: string[] = [];
let stopLowLevelTrigger: (() => void) | undefined;
let asrDaemonPort: number | undefined;
let asrDaemonEngine: 'sensevoice' | 'sensevoice-onnx' | undefined;
let asrDaemonStartupPromise: Promise<void> | undefined;
let asrDaemonProcessPid: number | undefined;
let localModelDownloadPromise: Promise<unknown> | undefined;
let pendingLocalAsrNotice: { message: string; createdAt: number } | undefined;
const execFileAsync = promisify(execFile);
const nodeRequire = createRequire(__filename);
const LONG_PRESS_MS = 350;
const CG_KEY_V = 0x09;
const CG_EVENT_SOURCE_STATE_COMBINED_SESSION = 0;
const CG_HID_EVENT_TAP = 0;
const CG_EVENT_FLAG_MASK_COMMAND = 1 << 20;
const ASR_PORT_FILE_SV = join(DATA_DIR, 'asr-daemon.port');
const ASR_LOCK_FILE_SV = join(DATA_DIR, 'asr-daemon.lock');
const SYSTEM_FFMPEG_COMMAND = 'ffmpeg';
const RECORDS_DB_FILE = join(DATA_DIR, 'snapsay.db');
const LAST_RECORDING_FILE = join(TMP_DIR, 'last-recording.wav');
const MACOS_PASTE_HELPER = app.isPackaged
  ? join(process.resourcesPath, 'macos-paste-helper', 'SnapSayPasteHelper')
  : join(PROJECT_ROOT, 'release', 'macos-paste-helper', 'SnapSayPasteHelper');

function defaultPythonPath(): string {
  return process.platform === 'win32'
    ? join(PROJECT_ROOT, '.venv', 'Scripts', 'python.exe')
    : join(RUNTIME_ROOT, '.venv', 'bin', 'python');
}

function onnxDaemonScriptPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'asr-daemon-onnx', 'asr-daemon-onnx.py')
    : join(PROJECT_ROOT, 'scripts', 'asr-daemon-onnx.py');
}

migrateInstallLocalRuntimeData();
mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(LOGS_DIR, { recursive: true });
mkdirSync(CACHE_DIR, { recursive: true });
mkdirSync(TMP_DIR, { recursive: true });
cleanupStaleTempFiles(TMP_DIR);

app.setPath('userData', join(DATA_DIR, 'electron'));
app.setPath('logs', LOGS_DIR);
try {
  app.setPath('sessionData', join(CACHE_DIR, 'electron-session'));
} catch {
  // Older Electron versions may not expose sessionData; userData/logs are still moved off C:.
}

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      mainWindow = undefined;
      void createMainWindow();
      return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
}

function rendererUrl(page: 'index.html' | 'floating.html'): string {
  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    return `${devServerUrl.replace(/\/$/, '')}/${page}`;
  }
  return pathToFileURL(join(app.getAppPath(), 'dist', page)).toString();
}

function defaultDataRoot(): string {
  return DATA_DIR;
}

function cleanupStaleTempFiles(tmpDir: string, maxAgeMs = 24 * 60 * 60 * 1000): number {
  let removed = 0;
  try {
    const now = Date.now();
    for (const name of readdirSync(tmpDir)) {
      if (!/^(voice-|asr-).*\.(wav|webm|mp3|m4a|txt)$/i.test(name)) {
        continue;
      }
      const path = join(tmpDir, name);
      const stat = statSync(path);
      if (!stat.isFile() || now - stat.mtimeMs < maxAgeMs) {
        continue;
      }
      rmSync(path, { force: true });
      removed += 1;
    }
  } catch (error) {
    console.warn('Failed to clean stale temp files:', error);
  }
  return removed;
}

function exportPayload(records: TranscriptionRecord[]) {
  return {
    app: 'SnapSay',
    version: 1,
    exportedAt: new Date().toISOString(),
    records
  };
}

function readImportRecordsPayload(filePath: string): TranscriptionRecord[] {
  const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as unknown;
  const rawRecords = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { records?: unknown }).records)
      ? (parsed as { records: unknown[] }).records
      : [];
  return rawRecords
    .map((record) => normalizeImportedRecord(record))
    .filter((record): record is TranscriptionRecord => Boolean(record));
}

function isOnnxExperimentMode(): boolean {
  return process.env.SNAPSAY_ASR_ENGINE !== 'sensevoice-funasr';
}

function activeAsrProfile(settings: ReturnType<SettingsStore['getSettings']>): AsrProfileConfig | undefined {
  return settings.input.asrProfiles.find((profile) => profile.id === settings.input.activeAsrProfileId);
}

function isLocalSenseVoiceAsr(settings: ReturnType<SettingsStore['getSettings']>): boolean {
  const profile = activeAsrProfile(settings);
  const asrName = profile?.kind === 'local' ? profile.engine : settings.input.asr;
  return profile?.kind !== 'cloud-upload' &&
    profile?.kind !== 'cloud-streaming' &&
    /sensevoice|funasr/i.test(asrName);
}

function localAsrReadiness(settings: ReturnType<SettingsStore['getSettings']>): { ok: boolean; loading?: boolean; message?: string } {
  if (!isLocalSenseVoiceAsr(settings)) {
    return { ok: true };
  }

  const modelPath = settings.input.senseVoiceModelPath;
  if (isOnnxExperimentMode()) {
    const modelStatus = getLocalModelStatus(modelPath);
    if (!modelStatus.installed) {
      return {
        ok: false,
        message: `本地语音模型未安装。请打开「模型」页面，点击「下载模型」后再录音。缺少文件：${modelStatus.missingFiles.join('、')}`
      };
    }
    if (!asrDaemonPort) {
      void warmupLocalAsr(settings);
      return {
        ok: false,
        loading: true,
        message: '本地语音识别模型正在加载，请稍等几秒后再录音'
      };
    }
  } else if (!existsSync(modelPath)) {
    return {
      ok: false,
      message: `本地语音模型目录不存在。请打开「模型」页面配置 SenseVoice 模型路径：${modelPath}`
    };
  }
  return { ok: true };
}

function notifyLocalAsrRequired(message: string): void {
  isRecording = false;
  pendingLocalAsrNotice = { message, createdAt: Date.now() };
  mainWindow?.webContents.send('snapsay:local-asr-required', { message });
  prepareFloatingForCurrentSpace();
  updateFloatingState({
    visible: true,
    recording: false,
    status: 'failed',
    error: message
  });
  const generation = recordingGeneration;
  setTimeout(() => {
    if (!isRecording && recordingGeneration === generation) {
      updateFloatingState({ visible: false, recording: false });
    }
  }, 1800);
}

function showTransientRecordingFailure(message: string): void {
  isRecording = false;
  prepareFloatingForCurrentSpace();
  updateFloatingState({
    visible: true,
    recording: false,
    status: 'failed',
    error: message
  });
  scheduleFloatingHide(recordingGeneration);
}

function appendMacPermissionLog(message: string): void {
  if (process.platform !== 'darwin') {
    return;
  }
  try {
    mkdirSync(LOGS_DIR, { recursive: true });
    writeFileSync(join(LOGS_DIR, 'mac-permissions.log'), `[${new Date().toISOString()}] ${message}\n`, { flag: 'a' });
  } catch {
    // Permission diagnostics must never block startup or recording.
  }
}

async function requestMacMicrophoneAccess(): Promise<void> {
  if (process.platform !== 'darwin') {
    return;
  }
  try {
    const before = systemPreferences.getMediaAccessStatus('microphone');
    appendMacPermissionLog(`main microphone status before request=${before}`);
    if (before === 'not-determined') {
      const granted = await systemPreferences.askForMediaAccess('microphone');
      appendMacPermissionLog(`main askForMediaAccess granted=${granted} after=${systemPreferences.getMediaAccessStatus('microphone')}`);
      return;
    }
    appendMacPermissionLog(`main microphone request skipped status=${before}`);
  } catch (error) {
    appendMacPermissionLog(`main microphone request error=${error instanceof Error ? error.message : String(error)}`);
  }
}

async function ensureMacSystemPermissions(options: { prompt: boolean }): Promise<{ ok: boolean; message?: string }> {
  if (process.platform !== 'darwin') {
    return { ok: true };
  }

  let microphoneStatus = systemPreferences.getMediaAccessStatus('microphone');
  if (microphoneStatus === 'not-determined' && options.prompt) {
    await requestMacMicrophoneAccess();
    microphoneStatus = systemPreferences.getMediaAccessStatus('microphone');
  }
  if (microphoneStatus === 'not-determined' && options.prompt) {
    mainWindow?.webContents.send('snapsay:request-microphone-access');
    return {
      ok: false,
      message: '请在系统弹窗中允许 SnapSay 使用麦克风。授权后再按一次快捷键开始录音。'
    };
  }
  if (microphoneStatus !== 'granted') {
    const message = 'SnapSay 还没有麦克风权限。请在系统弹窗中允许，或到「系统设置 > 隐私与安全性 > 麦克风」开启 SnapSay。';
    if (options.prompt) {
      await showMacPermissionDialog('需要麦克风权限', message, 'microphone');
    }
    return { ok: false, message };
  }

  return { ok: true };
}

async function showMacPermissionDialog(title: string, message: string, pane: 'microphone' | 'accessibility'): Promise<void> {
  const options: MessageBoxOptions = {
    type: 'warning',
    title,
    message,
    buttons: ['打开系统设置', '稍后处理'],
    defaultId: 0,
    cancelId: 1
  };
  const result = mainWindow
    ? await dialog.showMessageBox(mainWindow, options)
    : await dialog.showMessageBox(options);
  if (result.response === 0) {
    await openMacPrivacyPane(pane);
  }
}

async function openMacPrivacyPane(pane: 'microphone' | 'accessibility'): Promise<void> {
  const anchor = pane === 'microphone' ? 'Privacy_Microphone' : 'Privacy_Accessibility';
  const urls = [
    `x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?${anchor}`,
    `x-apple.systempreferences:com.apple.preference.security?${anchor}`
  ];
  for (const url of urls) {
    try {
      await shell.openExternal(url);
      return;
    } catch {
      try {
        await execFileAsync('open', [url]);
        return;
      } catch {
        // Try the next known System Settings URL format.
      }
    }
  }
  try {
    await execFileAsync('open', ['-b', 'com.apple.systempreferences']);
  } catch (error) {
    console.error('Failed to open macOS System Settings:', error);
  }
}

function warmupLocalAsr(settings: ReturnType<SettingsStore['getSettings']>): Promise<void> | undefined {
  if (!isLocalSenseVoiceAsr(settings)) {
    return undefined;
  }
  const readiness = isOnnxExperimentMode()
    ? getLocalModelStatus(settings.input.senseVoiceModelPath).installed
    : existsSync(settings.input.senseVoiceModelPath);
  if (!readiness) {
    return undefined;
  }
  if (!asrDaemonStartupPromise) {
    asrDaemonStartupPromise = startAsrDaemon(settings)
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[ASR daemon] Startup failed:', message);
        pendingLocalAsrNotice = { message: `本地语音识别运行时启动失败：${message}`, createdAt: Date.now() };
      })
      .finally(() => {
        asrDaemonStartupPromise = undefined;
      });
  }
  return asrDaemonStartupPromise;
}

async function waitForLocalAsrReadiness(
  settings: ReturnType<SettingsStore['getSettings']>
): Promise<{ ok: boolean; loading?: boolean; message?: string }> {
  const readiness = localAsrReadiness(settings);
  if (!readiness.loading) {
    return readiness;
  }
  await warmupLocalAsr(settings);
  if (pendingLocalAsrNotice?.message) {
    return { ok: false, message: pendingLocalAsrNotice.message };
  }
  return localAsrReadiness(settings);
}

async function stopExistingLocalAsrDaemons(): Promise<void> {
  if (process.platform !== 'win32') return;

  const command = `
$projectRoot = $env:SNAPSAY_KILL_PROJECT_ROOT
$runtimeRoot = $env:SNAPSAY_KILL_RUNTIME_ROOT
Get-CimInstance Win32_Process |
  Where-Object {
    ($_.Name -eq "python.exe" -and (
      $_.CommandLine -like "*$projectRoot*asr-daemon-onnx.py*" -or
      $_.CommandLine -like "*$projectRoot*asr-daemon.py*"
    )) -or
    ($_.Name -eq "asr-daemon-onnx.exe" -and $_.ExecutablePath -like "$runtimeRoot*")
  } |
  ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }
`;

  try {
    await execFileAsync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], {
      env: {
        ...process.env,
        SNAPSAY_KILL_PROJECT_ROOT: PROJECT_ROOT,
        SNAPSAY_KILL_RUNTIME_ROOT: RUNTIME_ROOT
      }
    });
  } catch (error) {
    console.warn('[ASR daemon] Failed to clean existing daemon processes:', error instanceof Error ? error.message : String(error));
  }
}

async function resolveListeningPortOwner(port: number): Promise<number | undefined> {
  if (process.platform !== 'win32') return undefined;
  const command = `
$port = [int]$env:SNAPSAY_PORT_OWNER_PORT
$conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($conn) { Write-Output $conn.OwningProcess }
`;
  try {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], {
      env: {
        ...process.env,
        SNAPSAY_PORT_OWNER_PORT: String(port)
      }
    });
    const owner = parseInt(stdout.trim(), 10);
    return Number.isFinite(owner) && owner > 0 ? owner : undefined;
  } catch {
    return undefined;
  }
}

async function resolveProcessCommandLine(pid: number): Promise<string | undefined> {
  if (process.platform !== 'win32') return undefined;
  const command = `
$processId = [int]$env:SNAPSAY_PROCESS_COMMAND_PID
$process = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
if ($process) { Write-Output $process.CommandLine }
`;
  try {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], {
      env: {
        ...process.env,
        SNAPSAY_PROCESS_COMMAND_PID: String(pid)
      }
    });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

function isCurrentProjectAsrDaemonCommand(commandLine: string | undefined): boolean {
  if (!commandLine) return false;
  return commandLine.includes(PROJECT_ROOT) &&
    (commandLine.includes('asr-daemon-onnx.py') || commandLine.includes('asr-daemon.py'));
}

async function stopProcessByPid(pid: number): Promise<void> {
  if (process.platform !== 'win32') return;
  try {
    await execFileAsync('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      'Stop-Process -Id ([int]$env:SNAPSAY_STOP_PID) -Force -ErrorAction SilentlyContinue'
    ], {
      env: {
        ...process.env,
        SNAPSAY_STOP_PID: String(pid)
      }
    });
  } catch {
    // Best-effort cleanup for stale daemon processes.
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveOnnxDaemonPython(settings: ReturnType<SettingsStore['getSettings']>): { executable: string; pythonPath?: string } | undefined {
  const venvRoots = process.platform === 'win32'
    ? [join(PROJECT_ROOT, '.venv'), join(RUNTIME_ROOT, '.venv')]
    : [join(RUNTIME_ROOT, '.venv'), join(PROJECT_ROOT, '.venv')];
  for (const venvRoot of venvRoots) {
    const resolved = resolveVenvPython(venvRoot);
    if (resolved) {
      return resolved;
    }
  }
  const fallback = resolvePythonExecutable({
    configuredPath: settings.input.pythonPath,
    projectRoot: PROJECT_ROOT,
    exists: existsSync
  });
  return fallback ? { executable: fallback } : resolveSystemPython();
}

function resolveVenvPython(venvRoot: string): { executable: string; pythonPath?: string } | undefined {
  const venvPython = process.platform === 'win32'
    ? join(venvRoot, 'Scripts', 'python.exe')
    : join(venvRoot, 'bin', 'python');
  const venvSitePackages = process.platform === 'win32'
    ? join(venvRoot, 'Lib', 'site-packages')
    : undefined;
  const pyvenvConfig = join(venvRoot, 'pyvenv.cfg');
  if (process.platform === 'win32' && venvSitePackages && existsSync(pyvenvConfig) && existsSync(venvSitePackages)) {
    const home = readFileSync(pyvenvConfig, 'utf-8')
      .split(/\r?\n/)
      .map((line) => line.match(/^home\s*=\s*(.+)$/i)?.[1]?.trim())
      .find((value): value is string => Boolean(value));
    if (home) {
      const basePython = join(home, 'python.exe');
      if (existsSync(basePython)) {
        return { executable: basePython, pythonPath: venvSitePackages };
      }
    }
  }
  if (existsSync(venvPython)) {
    return { executable: venvPython };
  }
  return undefined;
}

function resolveSystemPython(): { executable: string } | undefined {
  if (process.platform === 'win32') {
    return undefined;
  }
  for (const executable of ['/opt/homebrew/bin/python3', '/usr/local/bin/python3', '/usr/bin/python3', 'python3']) {
    if (executable === 'python3' || existsSync(executable)) {
      return { executable };
    }
  }
  return undefined;
}

async function ensureMacOnnxRuntime(settings: ReturnType<SettingsStore['getSettings']>): Promise<ReturnType<typeof resolveOnnxDaemonPython>> {
  const resolved = resolveOnnxDaemonPython(settings);
  if (process.platform !== 'darwin') {
    return resolved;
  }
  const runtimePython = join(RUNTIME_ROOT, '.venv', 'bin', 'python');
  if (existsSync(runtimePython) && await pythonHasOnnxDependencies(runtimePython)) {
    return { executable: runtimePython };
  }

  mkdirSync(CACHE_DIR, { recursive: true });
  const pythonForVenv = resolved?.executable ?? 'python3';
  const env = localAsrPythonEnv();
  console.log('[ASR daemon] Preparing macOS local ONNX ASR runtime.');
  await runLocalAsrPythonCommand(pythonForVenv, ['-m', 'venv', join(RUNTIME_ROOT, '.venv')], env);
  await runLocalAsrPythonCommand(runtimePython, ['-m', 'pip', 'install', '--upgrade', 'pip'], env);
  await runLocalAsrPythonCommand(runtimePython, [
    '-m',
    'pip',
    'install',
    '--upgrade',
    'numpy',
    'av',
    'kaldi-native-fbank',
    'onnxruntime'
  ], env);
  if (!await pythonHasOnnxDependencies(runtimePython)) {
    throw new Error('macOS 本地语音识别运行时安装后仍不可用，请检查 Python 与 pip 日志。');
  }
  return { executable: runtimePython };
}

async function runLocalAsrPythonCommand(file: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  await execFileAsync(file, args, {
    env,
    maxBuffer: 10 * 1024 * 1024
  });
}

async function pythonHasOnnxDependencies(python: string): Promise<boolean> {
  try {
    await execFileAsync(python, [
      '-c',
      'import onnxruntime as ort; import av; import kaldi_native_fbank; print(",".join(ort.get_available_providers()))'
    ], { env: localAsrPythonEnv() });
    return true;
  } catch {
    return false;
  }
}

function localAsrPythonEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    SNAPSAY_ROOT: RUNTIME_ROOT,
    XDG_CACHE_HOME: CACHE_DIR,
    PIP_CACHE_DIR: join(CACHE_DIR, 'pip'),
    HF_HOME: join(CACHE_DIR, 'huggingface'),
    HUGGINGFACE_HUB_CACHE: join(CACHE_DIR, 'huggingface', 'hub'),
    MODELSCOPE_CACHE: join(CACHE_DIR, 'modelscope'),
    TORCH_HOME: join(CACHE_DIR, 'torch')
  };
}

async function startAsrDaemon(settings: ReturnType<SettingsStore['getSettings']>): Promise<void> {
  if (!isLocalSenseVoiceAsr(settings)) return;
  const useOnnxDaemon = isOnnxExperimentMode();

  const portFile = ASR_PORT_FILE_SV;
  const modelPath = settings.input.senseVoiceModelPath;
  if (useOnnxDaemon && !getLocalModelStatus(modelPath).installed) {
    console.warn(`[ASR daemon] SenseVoice ONNX model is not installed at ${modelPath}.`);
    return;
  }

  asrDaemonPort = undefined;
  asrDaemonEngine = undefined;
  asrDaemonProcessPid = undefined;
  await stopExistingLocalAsrDaemons();
  try { unlinkSync(portFile); } catch { /* ignore */ }

  let daemon;
  if (app.isPackaged && process.platform === 'win32') {
    // Packaged: use ONNX daemon EXE from extraResources
    const daemonExe = join(process.resourcesPath, 'asr-daemon-onnx', 'asr-daemon-onnx.exe');
    daemon = spawn(daemonExe, [], {
      cwd: RUNTIME_ROOT,
      env: {
        ...process.env,
        SNAPSAY_ROOT: RUNTIME_ROOT,
        ASR_MODEL_PATH: modelPath,
        ASR_PORT_FILE: portFile,
        ASR_LOCK_FILE: ASR_LOCK_FILE_SV,
        ASR_TMP_DIR: TMP_DIR,
        ASR_ONNX_PROVIDER: 'auto',
        XDG_CACHE_HOME: CACHE_DIR,
        PIP_CACHE_DIR: join(CACHE_DIR, 'pip'),
        HF_HOME: join(CACHE_DIR, 'huggingface'),
        HUGGINGFACE_HUB_CACHE: join(CACHE_DIR, 'huggingface', 'hub'),
        MODELSCOPE_CACHE: join(CACHE_DIR, 'modelscope')
      },
      windowsHide: true,
      stdio: 'ignore',
      detached: false
    });
  } else if (useOnnxDaemon) {
    const scriptPath = onnxDaemonScriptPath();
    const pythonRuntime = process.platform === 'darwin'
      ? await ensureMacOnnxRuntime(settings)
      : resolveOnnxDaemonPython(settings);
    if (!pythonRuntime) {
      console.error(`[ASR daemon] Python not found at ${settings.input.pythonPath}, skipping ONNX ASR daemon startup.`);
      return;
    }
    console.log(`[ASR daemon] Starting SenseVoice ONNX daemon: ${scriptPath}`);
    daemon = spawn(pythonRuntime.executable, [scriptPath], {
      cwd: app.isPackaged ? RUNTIME_ROOT : PROJECT_ROOT,
      env: {
        ...localAsrPythonEnv(),
        ASR_MODEL_PATH: modelPath,
        ASR_PORT_FILE: portFile,
        ASR_LOCK_FILE: ASR_LOCK_FILE_SV,
        ASR_TMP_DIR: TMP_DIR,
        ASR_ONNX_PROVIDER: 'auto',
        PYTHONPATH: [pythonRuntime.pythonPath, process.env.PYTHONPATH].filter(Boolean).join(delimiter)
      },
      windowsHide: true,
      stdio: 'ignore',
      detached: false
    });
  } else {
    // Dev: use Python script with venv
    const scriptPath = join(PROJECT_ROOT, 'scripts', 'asr-daemon.py');
    const device = settings.input.asrAcceleration === 'CPU' ? 'cpu' : 'cuda:0';
    const pythonPath = resolvePythonExecutable({
      configuredPath: settings.input.pythonPath,
      projectRoot: PROJECT_ROOT,
      exists: existsSync
    });
    if (!pythonPath) {
      console.error(`[ASR daemon] Python not found at ${settings.input.pythonPath}, skipping ASR daemon startup.`);
      return;
    }
    daemon = spawn(pythonPath, [scriptPath], {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        ASR_MODEL_PATH: modelPath,
        ASR_DEVICE: device,
        ASR_PORT_FILE: portFile,
        MODELSCOPE_CACHE: join(CACHE_DIR, 'modelscope'),
        HF_HOME: join(CACHE_DIR, 'huggingface'),
        HUGGINGFACE_HUB_CACHE: join(CACHE_DIR, 'huggingface', 'hub')
      },
      windowsHide: true,
      stdio: 'ignore',
      detached: false
    });
  }

  let daemonExited: { code: number | null; signal: NodeJS.Signals | null } | undefined;
  daemon.on('error', (err) => {
    console.error('[ASR daemon] Failed to start:', err.message);
  });

  asrDaemonProcessPid = daemon.pid;
  daemon.on('exit', (code, signal) => {
    daemonExited = { code, signal };
    if (asrDaemonProcessPid === daemon.pid) {
      asrDaemonPort = undefined;
      asrDaemonEngine = undefined;
      asrDaemonProcessPid = undefined;
    }
  });

  daemon.unref();

  app.on('will-quit', () => {
    try { daemon.kill(); } catch { /* ignore */ }
    try { unlinkSync(portFile); } catch { /* ignore */ }
  });

  const start = Date.now();
  while (Date.now() - start <= 180_000) {
    if (daemonExited) {
      console.error(`[ASR daemon] Process exited before port file became ready. code=${daemonExited.code} signal=${daemonExited.signal ?? ''}`);
      return;
    }
    try {
      const port = parseInt(readFileSync(portFile, 'utf-8').trim(), 10);
      if (port > 0) {
        const owner = await resolveListeningPortOwner(port);
        const ownerCommandLine = owner && owner !== daemon.pid ? await resolveProcessCommandLine(owner) : undefined;
        if (!daemon.pid || !owner || owner === daemon.pid || isCurrentProjectAsrDaemonCommand(ownerCommandLine)) {
          asrDaemonPort = port;
          asrDaemonEngine = useOnnxDaemon ? 'sensevoice-onnx' : 'sensevoice';
          asrDaemonProcessPid = owner || daemon.pid;
          return;
        }
        console.warn(`[ASR daemon] Ignoring stale port ${port} owned by process ${owner}; expected ${daemon.pid}.`);
        await stopProcessByPid(owner);
        try { unlinkSync(portFile); } catch { /* ignore */ }
      }
    } catch { /* not ready yet */ }
    await delay(100);
  }
  console.error('[ASR daemon] Startup timed out before port file became ready.');
}

async function createMainWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 1040,
    minHeight: 680,
    title: 'SnapSay',
    frame: false,
    show: true,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    icon: nativeImage.createEmpty(),
    webPreferences: {
      preload: join(app.getAppPath(), 'dist-electron', 'main', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const isAppPage = webContents === mainWindow?.webContents;
    const mediaTypes = 'mediaTypes' in details ? details.mediaTypes : undefined;
    if (isAppPage && permission === 'media' && mediaTypes?.includes('audio')) {
      callback(true);
      return;
    }
    callback(false);
  });

  await mainWindow.loadURL(rendererUrl('index.html'));
  mainWindow.show();
  mainWindow.focus();
  appendMacPermissionLog(`main window loaded visible=${mainWindow.isVisible()} minimized=${mainWindow.isMinimized()} bounds=${JSON.stringify(mainWindow.getBounds())}`);
}

async function createFloating(): Promise<void> {
  const display = screen.getPrimaryDisplay();
  const savedPos = clampFloatingPosition(loadFloatingPosition(), display.workArea, FLOATING_SIZE);
  const x = savedPos.x;
  const y = savedPos.y;

  const window = createFloatingWindow((options) => {
    const floating = new BrowserWindow({
      ...options,
      width: FLOATING_SIZE.width,
      height: FLOATING_SIZE.height,
      x,
      y,
      type: process.platform === 'darwin' ? 'panel' : undefined,
      webPreferences: {
        preload: join(app.getAppPath(), 'dist-electron', 'main', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false
      }
    });
    floating.setFullScreen(false);
    floating.setKiosk(false);
    floating.setResizable(false);
    floating.setMinimumSize(FLOATING_SIZE.width, FLOATING_SIZE.height);
    floating.setMaximumSize(FLOATING_SIZE.width, FLOATING_SIZE.height);
    floating.setContentSize(FLOATING_SIZE.width, FLOATING_SIZE.height);
    floating.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    floating.setAlwaysOnTop(true, 'screen-saver');
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
    recordMode: settings?.input.recordMode ?? '点击开始/停止',
    asr: settings?.input.asr ?? 'SenseVoice',
    asrAcceleration: settings?.input.asrAcceleration ?? 'GPU 优先',
    localModelDir: settings?.input.localModelDir ?? MODELS_DIR,
    senseVoiceModelPath:
      settings?.input.senseVoiceModelPath ?? join(MODELS_DIR, 'sensevoice', 'SenseVoiceSmall'),
    pythonPath: settings?.input.pythonPath ?? defaultPythonPath(),
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
    smartMouseMode: settings?.input.smartMouseMode ?? process.platform !== 'darwin',
    mouseTrigger: settings?.input.mouseTrigger ?? 'Mouse Middle',
    cloudAsrType: settings?.input.cloudAsr?.type ?? 'openai-whisper',
    cloudAsrBaseUrl: settings?.input.cloudAsr?.baseUrl ?? '',
    cloudAsrApiKey: settings?.input.cloudAsr?.apiKey ?? '',
    cloudAsrModel: settings?.input.cloudAsr?.model ?? 'whisper-1',
    asrProfiles: settings?.input.asrProfiles ?? [],
    activeAsrProfileId: settings?.input.activeAsrProfileId ?? 'local-sensevoice',
    wordbook: settings?.input.wordbook ?? []
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
    totalTokens: record.totalTokens,
    error: record.error
  };
}

function installIpcHandlers(): void {
  ipcMain.handle('snapsay:get-dashboard', () => {
    const records = settingsStore?.listRecords().map(toRendererRecord);

    return {
      settings: toRendererSettings(),
      records: records?.length ? records : []
    };
  });

  ipcMain.handle('snapsay:save-settings', (_event, settings: RendererSettings) => {
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
        senseVoiceModelPath: settings.senseVoiceModelPath,
        pythonPath: settings.pythonPath,
        outputMode: settings.outputMode,
        dataDir: settings.dataDir,
        microphoneDeviceId: settings.microphoneDeviceId || '',
        shortPressAction: settings.shortPressAction,
        longPressAction: settings.longPressAction,
        smartMouseMode: settings.smartMouseMode,
        mouseTrigger: settings.mouseTrigger || 'Mouse Middle',
        // BUG FIX: preserve wordbook; wordbook is saved independently via snapsay:save-wordbook
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

  ipcMain.handle('snapsay:submit-recording', async (_event, audio: ArrayBuffer, durationMs: number) => {
    const submittedGeneration = recordingGeneration;
    updateProcessingFloatingState({ status: 'recognizing' }, submittedGeneration);
    const settings = settingsStore?.getSettings();
    if (!settingsStore || !settings) {
      return { ok: false, message: '设置存储不可用' };
    }
    let readiness = localAsrReadiness(settings);
    if (readiness.loading) {
      readiness = await waitForLocalAsrReadiness(settings);
    }
    if (!readiness.ok) {
      updateProcessingFloatingState({ status: 'failed', error: readiness.message }, submittedGeneration);
      if (readiness.message) {
        notifyLocalAsrRequired(readiness.message);
      }
      return { ok: false, message: readiness.message };
    }

    const audioDiagnostics = saveSubmittedAudioForDiagnostics(audio);
    if (audioDiagnostics?.isProbablySilent) {
      const message = `麦克风没有采集到有效声音。请检查当前麦克风，或在「设置」里换一个输入设备。诊断音频：${LAST_RECORDING_FILE}`;
      updateProcessingFloatingState({ status: 'failed', error: message }, submittedGeneration);
      scheduleFloatingHide(submittedGeneration);
      const record = settingsStore.addRecord({
        transcript: '',
        status: 'failed',
        error: message,
        asrProvider: 'local-audio-diagnostics',
        asrModel: settings.input.asr,
        durationMs,
        pasteSucceeded: false
      });
      mainWindow?.webContents.send('snapsay:records-synced', settingsStore.listRecords().map(toRendererRecord));
      return { ok: false, message, record };
    }

    const record = await runRecordingPipeline({
      audio,
      asrProvider: createConfiguredAsrProvider(settings, durationMs),
      durationMs,
      applyWordbook: (text) => applyWordbook(text, settings.input.wordbook ?? []),
      shouldCleanupText: (transcript) =>
        Boolean(settings.cleanup.enabled && resolveConfiguredCleanupProvider(settings) && shouldCleanupTranscript(transcript)),
      cleanupText: async (transcript) => {
        const provider = resolveConfiguredCleanupProvider(settings);
        if (!settings.cleanup.enabled || !provider) {
          return { text: transcript };
        }
        updateProcessingFloatingState({ status: 'rewriting' }, submittedGeneration);
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

    updateProcessingFloatingState({
      status: record.status === 'completed' ? 'done' : 'failed',
      error: record.error
    }, submittedGeneration);
    scheduleFloatingHide(submittedGeneration, 1200);

    // Send full records list to avoid race condition with getDashboard.
    // Keep every completed recording, including single-word entries used to train the wordbook.
    const allRecords = settingsStore?.listRecords() ?? [];
    mainWindow?.webContents.send('snapsay:records-synced', allRecords.map(toRendererRecord));

    return { ok: record.status === 'completed', record };
  });

  ipcMain.handle('snapsay:recording-error', (_event, message: string) => {
    isRecording = false;
    updateFloatingState({
      visible: true,
      recording: false,
      status: 'failed',
      error: message || '录音启动失败'
    });
    const failedGeneration = recordingGeneration;
    scheduleFloatingHide(failedGeneration, 1200);
    return { ok: true };
  });

  ipcMain.handle('snapsay:copy-text', (_event, text: string) => {
    clipboard.writeText(text);
  });

  ipcMain.handle('snapsay:paste-record', async (_event, id: string) => {
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

  ipcMain.handle('snapsay:delete-record', (_event, id: string) => {
    const success = settingsStore?.deleteRecord(id) ?? false;
    if (success) {
      mainWindow?.webContents.send('snapsay:record-deleted', id);
    }
    return success;
  });

  ipcMain.handle('snapsay:clear-all-records', () => {
    settingsStore?.clearAllRecords();
    mainWindow?.webContents.send('snapsay:records-cleared');
    return { ok: true };
  });

  ipcMain.handle('snapsay:clear-diagnostic-logs', () => {
    const cleared = settingsStore?.clearDiagnosticLogs() ?? 0;
    const records = settingsStore?.listRecords().map(toRendererRecord) ?? [];
    mainWindow?.webContents.send('snapsay:records-synced', records);
    return { ok: true, cleared, records };
  });

  ipcMain.handle('snapsay:export-records', async () => {
    if (!mainWindow || !settingsStore) {
      return { ok: false, message: '窗口或记录存储不可用' };
    }
    const today = new Date().toISOString().slice(0, 10);
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '导出全部数据',
      defaultPath: join(DATA_DIR, `snapsay-records-${today}.json`),
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePath) {
      return { ok: false, canceled: true };
    }
    const records = settingsStore.listRecords();
    const wordbook = settingsStore.getSettings().input.wordbook ?? [];
    writeFileSync(result.filePath, JSON.stringify(createTransferPayload(records, wordbook), null, 2), 'utf-8');
    return { ok: true, count: records.length, wordbookCount: wordbook.length, filePath: result.filePath };
  });

  ipcMain.handle('snapsay:import-records', async () => {
    if (!mainWindow || !settingsStore) {
      return { ok: false, message: '窗口或记录存储不可用' };
    }
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '导入全部数据',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, canceled: true };
    }
    try {
      const payload = parseTransferPayload(readFileSync(result.filePaths[0], 'utf-8'));
      const imported = settingsStore.importRecords(payload.records);
      const settings = settingsStore.getSettings();
      const wordbook = mergeWordbookEntries(settings.input.wordbook ?? [], payload.wordbook);
      if (payload.wordbook.length > 0) {
        settingsStore.saveSettings({ input: { ...settings.input, wordbook } });
      }
      const rendererRecords = imported.records.map(toRendererRecord);
      mainWindow.webContents.send('snapsay:records-synced', rendererRecords);
      return {
        ok: true,
        imported: imported.imported,
        updated: imported.updated,
        skipped: imported.skipped,
        wordbookImported: payload.wordbook.length,
        wordbook,
        records: rendererRecords
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error)
      };
    }
  });

  ipcMain.handle('snapsay:export-wordbook', async () => {
    if (!mainWindow || !settingsStore) {
      return { ok: false, message: '窗口或词库存储不可用' };
    }
    const today = new Date().toISOString().slice(0, 10);
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '导出词库',
      defaultPath: join(DATA_DIR, `snapsay-wordbook-${today}.json`),
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePath) {
      return { ok: false, canceled: true };
    }
    const wordbook = settingsStore.getSettings().input.wordbook ?? [];
    writeFileSync(result.filePath, JSON.stringify(createWordbookTransferPayload(wordbook), null, 2), 'utf-8');
    return { ok: true, count: wordbook.length, filePath: result.filePath };
  });

  ipcMain.handle('snapsay:import-wordbook', async () => {
    if (!mainWindow || !settingsStore) {
      return { ok: false, message: '窗口或词库存储不可用' };
    }
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '导入词库',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, canceled: true };
    }
    try {
      const importedWordbook = parseWordbookTransferPayload(readFileSync(result.filePaths[0], 'utf-8'));
      const settings = settingsStore.getSettings();
      const wordbook = mergeWordbookEntries(settings.input.wordbook ?? [], importedWordbook);
      settingsStore.saveSettings({ input: { ...settings.input, wordbook } });
      return {
        ok: true,
        imported: importedWordbook.length,
        total: wordbook.length,
        wordbook
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error)
      };
    }
  });

  ipcMain.handle('snapsay:test-rewrite-api', async (_event, settings: RendererSettings) => {
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

  ipcMain.handle('snapsay:rewrite-record', async (_event, id: string) => {
    const record = settingsStore?.listRecords().find((item) => item.id === id);
    const settings = settingsStore?.getSettings();
    if (!record || !settings) {
      return { ok: false, message: '记录或整理 API 未配置' };
    }
    const provider = resolveConfiguredCleanupProvider(settings);
    if (!provider) {
      return { ok: false, message: '记录或整理 API 未配置' };
    }
    const cleaned = await cleanupText({
      provider,
      transcript: record.transcript,
      prompt: resolvePromptText(settings.cleanup.prompt) + buildWordbookPrompt(settings.input.wordbook ?? []),
      fetch: fetch as FetchLike
    });
    const updated = settingsStore?.updateRecord(id, { cleanedText: cleaned.text, totalTokens: cleaned.totalTokens, status: 'completed' });
    if (updated) {
      mainWindow?.webContents.send('snapsay:record-updated', toRendererRecord(updated));
    }
    return { ok: true, text: cleaned.text };
  });

  ipcMain.handle('snapsay:save-correction', (_event, id: string, correctionText: string) => {
    if (!settingsStore) return { ok: false, pairs: [], wordbook: [] };
    const record = settingsStore.listRecords().find((item) => item.id === id);
    if (!record) return { ok: false, pairs: [], wordbook: [] };

    const updated = settingsStore.updateRecord(id, { userCorrection: correctionText });
    if (updated) {
      mainWindow?.webContents.send('snapsay:record-updated', toRendererRecord(updated));
    }

    const settings = settingsStore.getSettings();
    const pairs = extractWordPairCandidates(record.cleanedText ?? record.transcript, correctionText);
    const mergeResult = mergeWordbookPairs(settings.input.wordbook ?? [], pairs);
    settingsStore.saveSettings({ input: { ...settings.input, wordbook: mergeResult.wordbook } });

    return { ok: true, pairs: mergeResult.addedPairs, wordbook: mergeResult.wordbook };
  });

  // Independently save wordbook without touching other settings
  ipcMain.handle('snapsay:save-wordbook', (_event, wordbook: WordbookEntry[]) => {
    if (!settingsStore) return { ok: false };
    const settings = settingsStore.getSettings();
    settingsStore.saveSettings({ input: { ...settings.input, wordbook } });
    return { ok: true };
  });

  // Extract candidate word pairs from a correction record (for quick-add-to-wordbook)
  ipcMain.handle('snapsay:extract-word-pairs', (_event, id: string) => {
    if (!settingsStore) return { ok: false, pairs: [] };
    const record = settingsStore.listRecords().find((r) => r.id === id);
    if (!record?.userCorrection) return { ok: false, pairs: [] };
    const pairs = extractWordPairCandidates(record.cleanedText ?? record.transcript, record.userCorrection);
    return { ok: true, pairs };
  });

  ipcMain.handle('snapsay:window-control', (_event, action: 'minimize' | 'toggle-maximize' | 'close') => {
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

  ipcMain.handle('snapsay:open-external', async (_event, url: string) => {
    try {
      await shell.openExternal(url);
      return { ok: true };
    } catch (err) {
      console.error('Failed to open external URL:', err);
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle('snapsay:microphone-permission-result', (_event, result: unknown) => {
    appendMacPermissionLog(`renderer microphone request result=${JSON.stringify(result)}`);
    return { ok: true };
  });

  ipcMain.handle('snapsay:get-local-model-status', () => {
    const settings = settingsStore?.getSettings();
    const modelDir = settings?.input.senseVoiceModelPath ?? join(MODELS_DIR, 'sensevoice', 'SenseVoiceSmall');
    return getLocalModelStatus(modelDir);
  });

  ipcMain.handle('snapsay:get-local-asr-notice', () => pendingLocalAsrNotice);

  ipcMain.handle('snapsay:clear-local-asr-notice', () => {
    pendingLocalAsrNotice = undefined;
    return { ok: true };
  });

  ipcMain.handle('snapsay:download-local-model', async () => {
    const settings = settingsStore?.getSettings();
    const modelDir = settings?.input.senseVoiceModelPath ?? join(MODELS_DIR, 'sensevoice', 'SenseVoiceSmall');
    const currentStatus = getLocalModelStatus(modelDir);
    if (currentStatus.installed) {
      return {
        ...currentStatus,
        ok: true,
        message: '模型已就绪，无需下载'
      };
    }
    if (!localModelDownloadPromise) {
      localModelDownloadPromise = downloadSenseVoiceOnnxModel(modelDir)
        .then(async (result) => {
          const settingsAfterDownload = settingsStore?.getSettings();
          if (settingsAfterDownload && isOnnxExperimentMode() && !asrDaemonPort) {
            pendingLocalAsrNotice = undefined;
            void warmupLocalAsr(settingsAfterDownload);
          }
          return result;
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          console.error('[Local model] Download failed:', error);
          return {
            ...getLocalModelStatus(modelDir),
            ok: false,
            message: `模型下载失败：${message}`
          };
        })
        .finally(() => {
          localModelDownloadPromise = undefined;
        });
    }
    return localModelDownloadPromise;
  });

  ipcMain.handle('snapsay:open-local-model-dir', async () => {
    const settings = settingsStore?.getSettings();
    const modelDir = settings?.input.senseVoiceModelPath ?? join(MODELS_DIR, 'sensevoice', 'SenseVoiceSmall');
    await openLocalModelDir(modelDir);
    return { ok: true };
  });
}

function setRecording(next: boolean): void {
  if (isRecording === next) {
    return;
  }
  if (next) {
    if (process.platform === 'darwin') {
      const microphoneStatus = systemPreferences.getMediaAccessStatus('microphone');
      if (microphoneStatus !== 'granted') {
        void ensureMacSystemPermissions({ prompt: true }).then((result) => {
          if (!result.ok && result.message) {
            showTransientRecordingFailure(result.message);
          }
        });
        return;
      }
    }
    const settings = settingsStore?.getSettings();
    if (settings) {
      const readiness = localAsrReadiness(settings);
      if (!readiness.ok && !readiness.loading) {
        if (readiness.message) {
          notifyLocalAsrRequired(readiness.message);
        }
        return;
      }
    }
  }
  isRecording = next;
  if (isRecording) {
    recordingGeneration += 1;
    prepareFloatingForCurrentSpace();
    updateFloatingState({ visible: true, recording: true, status: 'recording' });
    mainWindow?.webContents.send('snapsay:recording-start');
  } else {
    prepareFloatingForCurrentSpace();
    updateFloatingState({ visible: true, recording: false, status: 'recognizing' });
    mainWindow?.webContents.send('snapsay:recording-stop');
  }
}

function toggleRecording(): void {
  appendMacPermissionLog(`toggle recording requested isRecording=${isRecording}`);
  setRecording(!isRecording);
}

function updateProcessingFloatingState(
  state: { status: 'recognizing' | 'rewriting' | 'done' | 'failed'; error?: string },
  generation: number
): void {
  if (isRecording || recordingGeneration !== generation) {
    return;
  }
  prepareFloatingForCurrentSpace();
  updateFloatingState({
    visible: true,
    recording: false,
    ...state
  });
}

function scheduleFloatingHide(generation: number, delayMs = 1800): void {
  setTimeout(() => {
    if (!isRecording && recordingGeneration === generation) {
      updateFloatingState({ visible: false, recording: false });
    }
  }, delayMs);
}

async function registerConfiguredTrigger(keyboardLabel: string | undefined, mouseLabel: string | undefined): Promise<void> {
  stopLowLevelTrigger?.();
  stopLowLevelTrigger = undefined;

  if (activeTriggerAccelerators.length) {
    for (const accelerator of activeTriggerAccelerators) {
      globalShortcut.unregister(accelerator);
    }
    activeTriggerAccelerators = [];
  }

  const effectiveKeyboardLabel = keyboardLabel || 'F8';
  const inputSettings = settingsStore?.getSettings().input;
  const effectiveMouseLabel = inputSettings?.smartMouseMode === false ? undefined : (mouseLabel || 'Mouse Middle');
  const preferLowLevelKeyboard = shouldUseLowLevelKeyboardHook(settingsStore?.getSettings().input.recordMode);
  const accelerator = parseTriggerLabelToAccelerator(effectiveKeyboardLabel);
  let keyboardRegistered = false;
  if (preferLowLevelKeyboard) {
    appendMacPermissionLog(`skip global shortcut for press-to-talk keyboard trigger label=${effectiveKeyboardLabel}`);
  } else if (!accelerator) {
    console.warn(`Keyboard trigger ${effectiveKeyboardLabel} is not supported by Electron globalShortcut on this platform.`);
  } else {
    const candidates = acceleratorCandidates(accelerator);
    for (const candidate of candidates) {
      if (globalShortcut.register(candidate, toggleRecording)) {
        activeTriggerAccelerators.push(candidate);
        keyboardRegistered = true;
        appendMacPermissionLog(`registered global shortcut label=${effectiveKeyboardLabel} accelerator=${candidate}`);
      } else {
        appendMacPermissionLog(`failed global shortcut label=${effectiveKeyboardLabel} accelerator=${candidate}`);
      }
    }
    if (!keyboardRegistered) {
      console.warn(`Keyboard trigger ${effectiveKeyboardLabel} could not be registered as a system shortcut.`);
    }
  }

  const lowLevelLabels = effectiveMouseLabel ? [effectiveMouseLabel] : [];
  if (preferLowLevelKeyboard || !keyboardRegistered) {
    lowLevelLabels.push(effectiveKeyboardLabel);
  }
  await registerLowLevelTriggers(lowLevelLabels.filter(Boolean), settingsStore?.getSettings().input.recordMode);
}

function acceleratorCandidates(accelerator: string): string[] {
  const candidates = new Set<string>([accelerator]);
  if (process.platform === 'darwin') {
    if (/\bAlt\b/.test(accelerator)) {
      candidates.add(accelerator.replace(/\bAlt\b/g, 'Option'));
    }
    if (/\bOption\b/.test(accelerator)) {
      candidates.add(accelerator.replace(/\bOption\b/g, 'Alt'));
    }
  }
  return [...candidates];
}

async function registerLowLevelTriggers(labels: string[], recordMode?: string): Promise<boolean> {
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
      const action = resolveTriggerDownAction({ recordMode, isRecording });
      setRecording(action === 'start-recording');
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
        recordMode,
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
      try { uIOhook.off('mousedown', onDown); } catch { /* ignore hook cleanup errors */ }
      try { uIOhook.off('mouseup', onUp); } catch { /* ignore hook cleanup errors */ }
      try { uIOhook.off('keydown', onDown); } catch { /* ignore hook cleanup errors */ }
      try { uIOhook.off('keyup', onUp); } catch { /* ignore hook cleanup errors */ }
      try { uIOhook.stop(); } catch { /* ignore hook cleanup errors */ }
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
    fnKey?: boolean;
    keycode?: number;
    rawcode?: number;
    keychar?: string;
    key?: string;
    button?: unknown;
  };
  if (!modifiersMatch(binding, candidate)) {
    return false;
  }
  if (binding.type === 'mouse') {
    return mouseButtonCode(binding.button) === Number(candidate.button);
  }
  return keyMatchesLabel(binding.key, candidate);
}

function modifiersMatch(
  binding: TriggerBinding,
  event: { altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; fnKey?: boolean }
): boolean {
  if (binding.type !== 'keyboard') {
    return true;
  }
  const modifiers = new Set(binding.modifiers.map((item) => item.toLowerCase()));
  return Boolean(event.ctrlKey) === (modifiers.has('ctrl') || modifiers.has('control')) &&
    Boolean(event.altKey) === (modifiers.has('alt') || modifiers.has('option')) &&
    Boolean(event.shiftKey) === modifiers.has('shift') &&
    Boolean(event.metaKey) === (modifiers.has('meta') || modifiers.has('cmd') || modifiers.has('command')) &&
    Boolean(event.fnKey) === modifiers.has('fn');
}

function keyMatchesLabel(
  label: string,
  event: { keycode?: number; rawcode?: number; keychar?: string; key?: string }
): boolean {
  const upper = label.trim().toUpperCase();
  if (upper === 'FN' || upper === 'FUNCTION') {
    return event.key === 'Fn' || event.keychar === 'Fn' || event.rawcode === 63 || event.keycode === 464;
  }
  return keyCodeForLabel(label) === event.keycode;
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
  if (upper === 'FN' || upper === 'FUNCTION') return 464;
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
  const commonPythonOptions = {
    pythonPath: resolvePythonExecutable({
      configuredPath: settings.input.pythonPath,
      projectRoot: PROJECT_ROOT,
      exists: existsSync
    }) ?? settings.input.pythonPath,
    tmpDir: TMP_DIR,
    ffmpegPath: SYSTEM_FFMPEG_COMMAND,
    acceleration: settings.input.asrAcceleration === 'CPU' ? ('cpu' as const) : ('auto-gpu' as const)
  };
  if (/sensevoice|funasr/i.test(asrName)) {
    if (asrDaemonPort && (asrDaemonEngine === 'sensevoice' || asrDaemonEngine === 'sensevoice-onnx')) {
      return createAsrDaemonProvider(
        asrDaemonPort,
        asrDaemonEngine === 'sensevoice-onnx' ? 'sensevoice-onnx-daemon' : 'sensevoice-daemon'
      );
    }
    if (isOnnxExperimentMode()) {
      return {
        name: 'sensevoice-onnx',
        async transcribe(): Promise<{ text: string; provider: string }> {
          throw new Error(resolveOnnxDaemonNotReadyMessage(settings));
        }
      };
    }
    return createPythonAsrProvider({
      ...commonPythonOptions,
      engine: 'sensevoice-funasr',
      scriptPath: join(PROJECT_ROOT, 'scripts', 'asr-sensevoice.py'),
      modelPath: settings.input.senseVoiceModelPath
      // SenseVoice does not support prompt injection
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

function resolveOnnxDaemonNotReadyMessage(settings: ReturnType<SettingsStore['getSettings']>): string {
  const modelStatus = getLocalModelStatus(settings.input.senseVoiceModelPath);
  if (!modelStatus.installed) {
    return `本地语音模型未安装。请打开「模型」页面，点击「下载模型」后再录音。缺少文件：${modelStatus.missingFiles.join('、')}`;
  }
  if (app.isPackaged && process.platform === 'win32') {
    return '本地语音识别服务还没有启动成功。请重启 SnapSay；如果仍失败，请在「模型」页面重新下载模型。';
  }
  return 'SenseVoice ONNX daemon is not ready. Restart with npm run electron and wait for the ONNX port file.';
}

async function pressSystemPasteShortcut(): Promise<void> {
  if (process.platform === 'darwin') {
    try {
      pressDarwinPasteWithCoreGraphics();
      return;
    } catch (error) {
      appendMacPermissionLog(`coregraphics paste failed=${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      await execFileAsync('osascript', ['-e', 'tell application "System Events" to keystroke "v" using command down']);
    } catch (error) {
      const message = `macOS 阻止了自动粘贴。文本已复制到剪贴板，请在「系统设置 > 隐私与安全性 > 辅助功能」允许 SnapSay 后再试。原始错误：${error instanceof Error ? error.message : String(error)}`;
      void showMacPermissionDialog('需要辅助功能权限', message, 'accessibility');
      throw new Error(message);
    }
    return;
  }

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

function pressDarwinPasteWithCoreGraphics(): void {
  const koffi = nodeRequire('koffi') as {
    load(path: string): {
      func(signature: string): (...args: unknown[]) => unknown;
    };
  };
  const appServices = koffi.load('/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices');
  const axIsProcessTrusted = appServices.func('bool AXIsProcessTrusted(void)') as () => boolean;
  if (!axIsProcessTrusted()) {
    const message = 'SnapSay 需要「辅助功能」权限才能把转写文本自动粘贴到当前光标。文本已复制到剪贴板，请开启权限后再试。';
    void showMacPermissionDialog('需要辅助功能权限', message, 'accessibility');
    throw new Error(message);
  }

  const cgEventSourceCreate = appServices.func('void *CGEventSourceCreate(int)') as (stateId: number) => unknown;
  const cgEventCreateKeyboardEvent = appServices.func('void *CGEventCreateKeyboardEvent(void *, uint16_t, bool)') as (
    source: unknown,
    virtualKey: number,
    keyDown: boolean
  ) => unknown;
  const cgEventSetFlags = appServices.func('void CGEventSetFlags(void *, uint64_t)') as (event: unknown, flags: number) => void;
  const cgEventPost = appServices.func('void CGEventPost(uint32_t, void *)') as (tap: number, event: unknown) => void;
  const cfRelease = appServices.func('void CFRelease(void *)') as (value: unknown) => void;

  const source = cgEventSourceCreate(CG_EVENT_SOURCE_STATE_COMBINED_SESSION);
  const keyDown = cgEventCreateKeyboardEvent(source, CG_KEY_V, true);
  const keyUp = cgEventCreateKeyboardEvent(source, CG_KEY_V, false);
  if (!source || !keyDown || !keyUp) {
    throw new Error('无法创建 macOS 粘贴键盘事件');
  }
  try {
    cgEventSetFlags(keyDown, CG_EVENT_FLAG_MASK_COMMAND);
    cgEventSetFlags(keyUp, CG_EVENT_FLAG_MASK_COMMAND);
    cgEventPost(CG_HID_EVENT_TAP, keyDown);
    cgEventPost(CG_HID_EVENT_TAP, keyUp);
  } finally {
    cfRelease(keyDown);
    cfRelease(keyUp);
    cfRelease(source);
  }
}

if (singleInstanceLock) {
app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  const settingsAdapter = await createElectronStoreAdapter({
    cwd: defaultDataRoot()
  });
  const recordStore = createSqliteRecordStore({ dbPath: RECORDS_DB_FILE });
  migrateLegacyRecordsToRecordStore(settingsAdapter, recordStore);
  settingsStore = createSettingsStore({
    store: settingsAdapter,
    recordStore
  });

  installIpcHandlers();
  await createMainWindow();
  await createFloating();
  updateFloatingState({ visible: false, recording: false });
  if (process.platform === 'darwin') {
    setTimeout(() => {
      void requestMacMicrophoneAccess();
      mainWindow?.webContents.send('snapsay:request-microphone-access');
    }, 2000);
  }
  const startupSettings = settingsStore.getSettings();
  const startupReadiness = localAsrReadiness(startupSettings);
  if (!startupReadiness.ok && startupReadiness.message && !startupReadiness.loading) {
    notifyLocalAsrRequired(startupReadiness.message);
  } else {
    // Start ASR daemon in background so the first recording does not pay cold-start cost.
    void warmupLocalAsr(startupSettings);
  }
  await registerConfiguredTrigger(startupSettings.input.triggerLabel, startupSettings.input.mouseTrigger);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow();
    } else if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
});
}

function saveSubmittedAudioForDiagnostics(audio: ArrayBuffer): { isProbablySilent: boolean } | undefined {
  try {
    mkdirSync(TMP_DIR, { recursive: true });
    const buffer = Buffer.from(audio);
    writeFileSync(LAST_RECORDING_FILE, buffer);
    const analysis = analyzeWavPcm16(buffer);
    if (!analysis) {
      return undefined;
    }
    console.log(`[Audio] submitted wav duration=${analysis.durationMs}ms peak=${analysis.peak.toFixed(4)} rms=${analysis.rms.toFixed(4)} file=${LAST_RECORDING_FILE}`);
    return {
      isProbablySilent: analysis.durationMs >= 500 && analysis.peak < 0.01 && analysis.rms < 0.002
    };
  } catch (error) {
    console.warn('[Audio] Failed to save submitted audio diagnostics:', error);
    return undefined;
  }
}

function analyzeWavPcm16(buffer: Buffer): { durationMs: number; peak: number; rms: number } | undefined {
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    return undefined;
  }
  let offset = 12;
  let channels = 1;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let dataStart = 0;
  let dataSize = 0;
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkData = offset + 8;
    if (chunkId === 'fmt ' && chunkData + 16 <= buffer.length) {
      channels = buffer.readUInt16LE(chunkData + 2);
      sampleRate = buffer.readUInt32LE(chunkData + 4);
      bitsPerSample = buffer.readUInt16LE(chunkData + 14);
    } else if (chunkId === 'data') {
      dataStart = chunkData;
      dataSize = Math.min(chunkSize, buffer.length - chunkData);
      break;
    }
    offset = chunkData + chunkSize + (chunkSize % 2);
  }
  if (!sampleRate || bitsPerSample !== 16 || !dataStart || dataSize < 2) {
    return undefined;
  }
  let peak = 0;
  let sumSquares = 0;
  let samples = 0;
  for (let index = dataStart; index + 1 < dataStart + dataSize; index += 2) {
    const value = buffer.readInt16LE(index) / 32768;
    const abs = Math.abs(value);
    if (abs > peak) peak = abs;
    sumSquares += value * value;
    samples += 1;
  }
  const frames = samples / Math.max(1, channels);
  return {
    durationMs: Math.round((frames / sampleRate) * 1000),
    peak,
    rms: Math.sqrt(sumSquares / Math.max(1, samples))
  };
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  stopLowLevelTrigger?.();
  stopLowLevelTrigger = undefined;
  globalShortcut.unregisterAll();
});
