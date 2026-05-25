import type { AppSettings, StoragePaths } from './types';
import { DEFAULT_CLEANUP_PROMPT } from './cleanupPolicy';
export { DEFAULT_CLEANUP_PROMPT } from './cleanupPolicy';

export const PROJECT_ROOT = 'D:\\Antigravity\\SnapSay';

export const DEFAULT_STORAGE_PATHS: StoragePaths = {
  dataDir: `${PROJECT_ROOT}\\data`,
  logsDir: `${PROJECT_ROOT}\\logs`,
  cacheDir: `${PROJECT_ROOT}\\cache`,
  modelsDir: `${PROJECT_ROOT}\\models`,
  tmpDir: `${PROJECT_ROOT}\\tmp`
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
    localModelPath: `${DEFAULT_STORAGE_PATHS.modelsDir}\\sensevoice`,
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
