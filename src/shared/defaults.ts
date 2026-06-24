import type { AppSettings, StoragePaths } from './types';
import { DEFAULT_CLEANUP_PROMPT } from './cleanupPolicy';
export { DEFAULT_CLEANUP_PROMPT } from './cleanupPolicy';

const isWindows = typeof process === 'undefined' || process.platform === 'win32';
const separator = isWindows ? '\\' : '/';

export const PROJECT_ROOT = isWindows
  ? 'D:\\Antigravity\\SnapSay'
  : (typeof process !== 'undefined' && (process.env.SNAPSAY_ROOT || process.cwd?.())) || '/Users/Admin/Data/AiCode/SnapSay';

function projectPath(...parts: string[]): string {
  return [PROJECT_ROOT, ...parts].join(separator);
}

export const DEFAULT_STORAGE_PATHS: StoragePaths = {
  dataDir: projectPath('data'),
  logsDir: projectPath('logs'),
  cacheDir: projectPath('cache'),
  modelsDir: projectPath('models'),
  tmpDir: projectPath('tmp')
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  trigger: { type: 'keyboard', key: 'F8', modifiers: [] },
  recordingMode: 'pressToTalk',
  asrProvider: {
    id: 'local-sensevoice',
    enabled: true,
    type: 'local',
    displayName: 'Local SenseVoice',
    model: 'SenseVoiceSmall',
    localModelPath: projectPath('models', 'sensevoice'),
    timeoutMs: 60_000
  },
  cleanupProvider: {
    id: 'openai-compatible-cleanup',
    enabled: false,
    type: 'openai-compatible',
    displayName: 'OpenAI Compatible Cleanup',
    model: '',
    baseUrl: '',
    promptTemplate: DEFAULT_CLEANUP_PROMPT,
    timeoutMs: 30_000
  },
  cleanupEnabled: false,
  outputMode: 'paste',
  paths: DEFAULT_STORAGE_PATHS,
  maxRecordingSeconds: 120,
  historyLimit: 500
};
