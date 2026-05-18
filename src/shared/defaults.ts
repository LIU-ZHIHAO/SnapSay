import type { AppSettings, StoragePaths } from './types';

export const PROJECT_ROOT = 'D:\\Antigravity\\tailkall';

export const DEFAULT_STORAGE_PATHS: StoragePaths = {
  dataDir: `${PROJECT_ROOT}\\data`,
  logsDir: `${PROJECT_ROOT}\\logs`,
  cacheDir: `${PROJECT_ROOT}\\cache`,
  modelsDir: `${PROJECT_ROOT}\\models`,
  tmpDir: `${PROJECT_ROOT}\\tmp`
};

export const DEFAULT_CLEANUP_PROMPT =
  '请在不改变原意的前提下整理语音输入文本，修正明显错别字和标点，直接返回整理后的文本。';

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
