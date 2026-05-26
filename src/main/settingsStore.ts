import { DEFAULT_CLEANUP_PROMPT } from '../shared/cleanupPolicy.js';
import {
  createMemoryRecordStore,
  type ImportRecordsResult,
  type NewTranscriptionRecord,
  type RecordStore,
  type TranscriptionRecord,
  type TranscriptionRecordStatus
} from './recordStore.js';

export type {
  ImportRecordsResult,
  NewTranscriptionRecord,
  RecordStore,
  TranscriptionRecord,
  TranscriptionRecordStatus
} from './recordStore.js';

const PROJECT_ROOT = process.env.SNAPSAY_ROOT ?? process.cwd();

export type CleanupProviderConfig = {
  type: 'openai-compatible';
  name: string;
  baseUrl?: string;
  apiKey: string;
  model: string;
};

export type LlmProviderConfig = {
  key: string;
  displayName: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  enabled: boolean;
  isDefault: boolean;
};

export type CloudAsrProviderConfig = {
  type: 'openai-whisper' | 'openai-compatible';
  baseUrl: string;
  apiKey: string;
  model: string;
};

export type AsrProfileConfig = {
  id: string;
  kind: 'local' | 'cloud-upload' | 'cloud-streaming';
  displayName: string;
  engine: string;
  enabled: boolean;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
};

export type WordbookEntry = {
  id: string;
  target: string;
  variants: string[];
};

export type AppSettings = {
  cleanup: {
    enabled: boolean;
    provider?: CleanupProviderConfig;
    providers: LlmProviderConfig[];
    activeProviderKey: string;
    prompt: string;
  };
  input: {
    trigger: {
      key: string;
      modifiers: string[];
    };
    triggerLabel: string;
    recordMode: string;
    asr: string;
    asrAcceleration: string;
    localModelDir: string;
    senseVoiceModelPath: string;
    pythonPath: string;
    outputMode: string;
    dataDir: string;
    microphoneDeviceId: string;
    shortPressAction: string;
    longPressAction: string;
    smartMouseMode: boolean;
    wordbook: WordbookEntry[];
    wordbookLearnedAt?: string;
    cloudAsr?: CloudAsrProviderConfig;
    asrProfiles: AsrProfileConfig[];
    activeAsrProfileId: string;
    mouseTrigger?: string;
  };
};

export type KeyValueStore = {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T): void;
  delete?(key: string): void;
};

export type SettingsStore = {
  getSettings(): AppSettings;
  saveSettings(settings: AppSettingsPatch): AppSettings;
  listRecords(): TranscriptionRecord[];
  addRecord(record: NewTranscriptionRecord): TranscriptionRecord;
  updateRecord(
    id: string,
    patch: Partial<Omit<TranscriptionRecord, 'id' | 'createdAt'>>
  ): TranscriptionRecord | undefined;
  deleteRecord(id: string): boolean;
  clearDiagnosticLogs(): number;
  clearAllRecords(): void;
  importRecords(records: TranscriptionRecord[]): ImportRecordsResult;
};

export const defaultSettings: AppSettings = {
  cleanup: {
    enabled: false,
    provider: {
      type: 'openai-compatible',
      name: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: '',
      model: 'deepseek-chat'
    },
    providers: defaultLlmProviders(),
    activeProviderKey: 'deepseek',
    prompt: DEFAULT_CLEANUP_PROMPT
  },
  input: {
    trigger: {
      key: 'f9',
      modifiers: []
    },
    triggerLabel: 'F8',
    recordMode: '按住说话',
    asr: 'SenseVoice',
    asrAcceleration: 'GPU 优先',
    localModelDir: `${PROJECT_ROOT}\\models`,
    senseVoiceModelPath: `${PROJECT_ROOT}\\models\\sensevoice\\SenseVoiceSmall`,
    pythonPath: `${PROJECT_ROOT}\\.venv\\Scripts\\python.exe`,
    outputMode: '粘贴到当前光标',
    dataDir: `${PROJECT_ROOT}\\data`,
    microphoneDeviceId: '',
    shortPressAction: '语音输入',
    longPressAction: '语音助手',
    smartMouseMode: true,
    wordbook: [],
    asrProfiles: defaultAsrProfiles(),
    activeAsrProfileId: 'local-sensevoice',
    wordbookLearnedAt: undefined
  }
};

export type AppSettingsPatch = Omit<Partial<AppSettings>, 'cleanup' | 'input'> & {
  cleanup?: Partial<AppSettings['cleanup']>;
  input?: Partial<AppSettings['input']>;
};

export function defaultLlmProviders(): LlmProviderConfig[] {
  return [
    { key: 'openai', displayName: 'OpenAI', baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-4.1-mini', enabled: false, isDefault: false },
    { key: 'deepseek', displayName: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', apiKey: '', model: 'deepseek-chat', enabled: false, isDefault: true },
    { key: 'openrouter', displayName: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', apiKey: '', model: '', enabled: false, isDefault: false },
    { key: 'siliconflow', displayName: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1', apiKey: '', model: '', enabled: false, isDefault: false },
    { key: 'volcengine-ark', displayName: '火山方舟', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', apiKey: '', model: '', enabled: false, isDefault: false },
    { key: 'dashscope', displayName: '阿里云百炼', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', apiKey: '', model: '', enabled: false, isDefault: false },
    { key: 'moonshot', displayName: '月之暗面 Kimi', baseUrl: 'https://api.moonshot.cn/v1', apiKey: '', model: '', enabled: false, isDefault: false },
    { key: 'zhipu', displayName: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', apiKey: '', model: '', enabled: false, isDefault: false },
    { key: 'tencent-hunyuan', displayName: '腾讯混元', baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1', apiKey: '', model: '', enabled: false, isDefault: false },
    { key: 'gemini-compatible', displayName: 'Gemini Compatible', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', apiKey: '', model: '', enabled: false, isDefault: false },
    { key: 'ollama', displayName: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1', apiKey: '', model: 'qwen2.5', enabled: false, isDefault: false },
    { key: 'custom-openai', displayName: '自定义 OpenAI-compatible', baseUrl: '', apiKey: '', model: '', enabled: false, isDefault: false }
  ];
}

export function defaultAsrProfiles(): AsrProfileConfig[] {
  return [
    { id: 'local-sensevoice', kind: 'local', displayName: '本地 SenseVoice', engine: 'SenseVoice', enabled: true },
    { id: 'cloud-upload-openai', kind: 'cloud-upload', displayName: '云端上传转写 API', engine: 'openai-whisper', enabled: false, baseUrl: 'https://api.openai.com', apiKey: '', model: 'whisper-1' },
    { id: 'cloud-streaming-custom', kind: 'cloud-streaming', displayName: '云端流式转写 API', engine: 'streaming-compatible', enabled: false, baseUrl: '', apiKey: '', model: '' }
  ];
}

const SETTINGS_KEY = 'settings';
const RECORDS_KEY = 'records';

export function createMemoryStore(initial: Record<string, unknown> = {}): KeyValueStore {
  const values = new Map<string, unknown>(Object.entries(initial));

  return {
    get<T>(key: string): T | undefined {
      return values.get(key) as T | undefined;
    },
    set<T>(key: string, value: T): void {
      values.set(key, value);
    },
    delete(key: string): void {
      values.delete(key);
    }
  };
}

export async function createElectronStoreAdapter(options?: {
  cwd?: string;
  name?: string;
}): Promise<KeyValueStore> {
  const ElectronStore = (await import('electron-store')).default;
  const store = new ElectronStore({
    cwd: options?.cwd,
    name: options?.name ?? 'tailkall-settings'
  });

  return {
    get<T>(key: string): T | undefined {
      return store.get(key) as T | undefined;
    },
    set<T>(key: string, value: T): void {
      store.set(key, value);
    },
    delete(key: string): void {
      store.delete(key);
    }
  };
}

export function migrateLegacyRecordsToRecordStore(store: KeyValueStore, recordStore: RecordStore): ImportRecordsResult | undefined {
  const legacyRecords = store.get<TranscriptionRecord[]>(RECORDS_KEY);
  if (!Array.isArray(legacyRecords) || legacyRecords.length === 0) {
    return undefined;
  }
  const result = recordStore.importRecords(legacyRecords);
  store.delete?.(RECORDS_KEY);
  return result;
}

export function createSettingsStore(options: { store: KeyValueStore; recordStore?: RecordStore }): SettingsStore {
  const store = options.store;
  const recordStore = options.recordStore ?? createMemoryRecordStore(store.get<TranscriptionRecord[]>(RECORDS_KEY) ?? []);

  return {
    getSettings(): AppSettings {
      return mergeSettings(store.get<Partial<AppSettings>>(SETTINGS_KEY));
    },
    saveSettings(settings: AppSettingsPatch): AppSettings {
      const next = mergeSettings({
        ...this.getSettings(),
        ...settings,
        cleanup: {
          ...this.getSettings().cleanup,
          ...settings.cleanup
        },
        input: {
          ...this.getSettings().input,
          ...settings.input
        }
      });
      store.set(SETTINGS_KEY, next);
      return next;
    },
    listRecords(): TranscriptionRecord[] {
      return recordStore.listRecords();
    },
    addRecord(record: NewTranscriptionRecord): TranscriptionRecord {
      return recordStore.addRecord(record);
    },
    updateRecord(
      id: string,
      patch: Partial<Omit<TranscriptionRecord, 'id' | 'createdAt'>>
    ): TranscriptionRecord | undefined {
      return recordStore.updateRecord(id, patch);
    },
    deleteRecord(id: string): boolean {
      return recordStore.deleteRecord(id);
    },
    clearDiagnosticLogs(): number {
      return recordStore.clearDiagnosticLogs();
    },
    clearAllRecords(): void {
      recordStore.clearAllRecords();
    },
    importRecords(records: TranscriptionRecord[]): ImportRecordsResult {
      return recordStore.importRecords(records);
    }
  };
}

function mergeSettings(settings?: Partial<AppSettings>): AppSettings {
  const cleanup = mergeCleanupSettings(settings?.cleanup);
  const input = mergeInputSettings(settings?.input);
  return {
    cleanup,
    input
  };
}

function mergeCleanupSettings(settings?: Partial<AppSettings['cleanup']>): AppSettings['cleanup'] {
  const providers = mergeLlmProviders(settings?.providers, settings?.provider);
  const activeProviderKey = settings?.activeProviderKey ?? providerKeyFromLegacy(settings?.provider) ?? defaultSettings.cleanup.activeProviderKey;
  const activeProvider = providers.find((provider) => provider.key === activeProviderKey) ?? providers.find((provider) => provider.isDefault) ?? providers[0];
  return {
    ...defaultSettings.cleanup,
    ...settings,
    providers,
    activeProviderKey: activeProvider.key,
    provider: activeProviderToCleanupProvider(activeProvider),
    prompt: settings?.prompt ?? defaultSettings.cleanup.prompt
  };
}

function mergeInputSettings(settings?: Partial<AppSettings['input']>): AppSettings['input'] {
  const asrProfiles = mergeAsrProfiles(settings?.asrProfiles);
  const activeAsrProfileId = settings?.activeAsrProfileId && settings.activeAsrProfileId !== defaultSettings.input.activeAsrProfileId
    ? settings.activeAsrProfileId
    : activeAsrProfileFromLegacy(settings?.asr) ?? settings?.activeAsrProfileId ?? defaultSettings.input.activeAsrProfileId;
  const activeProfile = asrProfiles.find((profile) => profile.id === activeAsrProfileId) ?? asrProfiles[0];
  return {
    ...defaultSettings.input,
    ...migrateInputPaths(settings),
    trigger: {
      ...defaultSettings.input.trigger,
      ...settings?.trigger
    },
    asrProfiles,
    activeAsrProfileId: activeProfile.id,
    asr: activeProfile.engine
  };
}

function migrateInputPaths(settings?: Partial<AppSettings['input']>): Partial<AppSettings['input']> | undefined {
  if (!settings) {
    return settings;
  }
  const migrate = (value: string | undefined) =>
    value?.replace(/^D:\\Antigravity\\tailkall(?=\\|$)/i, PROJECT_ROOT);
  return {
    ...settings,
    localModelDir: migrate(settings.localModelDir),
    senseVoiceModelPath: migrate(settings.senseVoiceModelPath),
    pythonPath: migrate(settings.pythonPath),
    dataDir: migrate(settings.dataDir)
  };
}

function mergeLlmProviders(
  savedProviders: LlmProviderConfig[] | undefined,
  legacyProvider: CleanupProviderConfig | undefined
): LlmProviderConfig[] {
  const byKey = new Map(defaultLlmProviders().map((provider) => [provider.key, provider]));
  for (const provider of savedProviders ?? []) {
    byKey.set(provider.key, { ...byKey.get(provider.key), ...provider });
  }
  if (legacyProvider) {
    const key = providerKeyFromLegacy(legacyProvider) ?? 'custom-openai';
    const current = byKey.get(key) ?? byKey.get('custom-openai');
    byKey.set(key, {
      ...current,
      key,
      displayName: legacyProvider.name || current?.displayName || '自定义 OpenAI-compatible',
      baseUrl: legacyProvider.baseUrl || current?.baseUrl || '',
      apiKey: legacyProvider.apiKey,
      model: legacyProvider.model,
      enabled: true,
      isDefault: current?.isDefault ?? false
    });
  }
  return [...byKey.values()];
}

function mergeAsrProfiles(savedProfiles: AsrProfileConfig[] | undefined): AsrProfileConfig[] {
  const byId = new Map(defaultAsrProfiles().map((profile) => [profile.id, profile]));
  const allowedIds = new Set(byId.keys());
  for (const profile of savedProfiles ?? []) {
    if (allowedIds.has(profile.id)) {
      byId.set(profile.id, { ...byId.get(profile.id), ...profile });
    }
  }
  return [...byId.values()];
}

function providerKeyFromLegacy(provider: CleanupProviderConfig | undefined): string | undefined {
  if (!provider) {
    return undefined;
  }
  const label = `${provider.name} ${provider.baseUrl ?? ''}`.toLowerCase();
  if (label.includes('deepseek')) return 'deepseek';
  if (label.includes('openrouter')) return 'openrouter';
  if (label.includes('siliconflow') || label.includes('硅基')) return 'siliconflow';
  if (label.includes('volces') || label.includes('火山') || label.includes('ark')) return 'volcengine-ark';
  if (label.includes('dashscope') || label.includes('阿里')) return 'dashscope';
  if (label.includes('moonshot') || label.includes('kimi')) return 'moonshot';
  if (label.includes('bigmodel') || label.includes('智谱')) return 'zhipu';
  if (label.includes('hunyuan') || label.includes('腾讯')) return 'tencent-hunyuan';
  if (label.includes('generativelanguage') || label.includes('gemini')) return 'gemini-compatible';
  if (label.includes('ollama')) return 'ollama';
  if (label.includes('openai')) return 'openai';
  return 'custom-openai';
}

function activeProviderToCleanupProvider(provider: LlmProviderConfig): CleanupProviderConfig {
  return {
    type: 'openai-compatible',
    name: provider.displayName,
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    model: provider.model
  };
}

function activeAsrProfileFromLegacy(asr: string | undefined): string | undefined {
  if (!asr) {
    return undefined;
  }
  if (/云端|cloud|api/i.test(asr)) return 'cloud-upload-openai';
  if (/sensevoice|funasr/i.test(asr)) return 'local-sensevoice';
  return undefined;
}

