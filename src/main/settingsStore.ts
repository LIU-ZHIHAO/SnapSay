import { DEFAULT_CLEANUP_PROMPT } from '../shared/cleanupPolicy.js';

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
    localAsrExePath: string;
    localAsrModelPath: string;
    ffmpegPath: string;
    fasterWhisperModelPath: string;
    senseVoiceModelPath: string;
    pythonPath: string;
    outputMode: string;
    dataDir: string;
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

export type TranscriptionRecordStatus = 'completed' | 'failed';

export type TranscriptionRecord = {
  id: string;
  transcript: string;
  cleanedText?: string;
  userCorrection?: string;
  status: TranscriptionRecordStatus;
  error?: string;
  asrProvider?: string;
  asrModel?: string;
  cleanupProvider?: string;
  cleanupModel?: string;
  durationMs?: number;
  asrDurationMs?: number;
  cleanupDurationMs?: number;
  pasteSucceeded?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type NewTranscriptionRecord = Omit<
  TranscriptionRecord,
  'id' | 'createdAt' | 'updatedAt'
>;

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
  clearAllRecords(): void;
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
    asr: 'SenseVoice / FunASR',
    asrAcceleration: 'GPU 优先',
    localModelDir: 'D:\\Antigravity\\tailkall\\models',
    localAsrExePath: 'D:\\Antigravity\\tailkall\\models\\whisper\\Release\\whisper-cli.exe',
    localAsrModelPath: 'D:\\Antigravity\\tailkall\\models\\whisper\\ggml-small.bin',
    ffmpegPath: 'D:\\Antigravity\\tailkall\\models\\whisper\\ffmpeg.exe',
    fasterWhisperModelPath: 'D:\\Antigravity\\tailkall\\models\\faster-whisper\\small',
    senseVoiceModelPath: 'D:\\Antigravity\\tailkall\\models\\sensevoice\\SenseVoiceSmall',
    pythonPath: 'D:\\Antigravity\\tailkall\\.venv\\Scripts\\python.exe',
    outputMode: '粘贴到当前光标',
    dataDir: 'D:\\Antigravity\\tailkall\\data',
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
    { id: 'local-sensevoice', kind: 'local', displayName: '本地 SenseVoice / FunASR', engine: 'SenseVoice / FunASR', enabled: true },
    { id: 'local-faster-whisper', kind: 'local', displayName: '本地 faster-whisper', engine: 'faster-whisper', enabled: true },
    { id: 'local-whisper-cpp', kind: 'local', displayName: '本地 whisper.cpp', engine: 'whisper.cpp', enabled: true },
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

export function createSettingsStore(options: { store: KeyValueStore }): SettingsStore {
  const store = options.store;

  const readRecords = (): TranscriptionRecord[] => store.get<TranscriptionRecord[]>(RECORDS_KEY) ?? [];
  const writeRecords = (records: TranscriptionRecord[]) => store.set(RECORDS_KEY, records);

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
      return [...readRecords()].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    },
    addRecord(record: NewTranscriptionRecord): TranscriptionRecord {
      const now = new Date().toISOString();
      const saved: TranscriptionRecord = {
        ...record,
        id: createRecordId(),
        createdAt: now,
        updatedAt: now
      };
      writeRecords([saved, ...readRecords()]);
      return saved;
    },
    updateRecord(
      id: string,
      patch: Partial<Omit<TranscriptionRecord, 'id' | 'createdAt'>>
    ): TranscriptionRecord | undefined {
      let updated: TranscriptionRecord | undefined;
      const records = readRecords().map((record) => {
        if (record.id !== id) {
          return record;
        }
        updated = {
          ...record,
          ...patch,
          id: record.id,
          createdAt: record.createdAt,
          updatedAt: new Date().toISOString()
        };
        return updated;
      });
      writeRecords(records);
      return updated;
    },
    deleteRecord(id: string): boolean {
      const records = readRecords();
      const next = records.filter((record) => record.id !== id);
      if (next.length === records.length) {
        return false;
      }
      writeRecords(next);
      return true;
    },
    clearAllRecords(): void {
      writeRecords([]);
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
    ...settings,
    trigger: {
      ...defaultSettings.input.trigger,
      ...settings?.trigger
    },
    asrProfiles,
    activeAsrProfileId: activeProfile.id,
    asr: activeProfile.engine
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
  for (const profile of savedProfiles ?? []) {
    byId.set(profile.id, { ...byId.get(profile.id), ...profile });
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
  if (/faster-whisper/i.test(asr)) return 'local-faster-whisper';
  if (/whisper\.cpp|whisper|本地/i.test(asr)) return 'local-whisper-cpp';
  if (/云端|cloud|api/i.test(asr)) return 'cloud-upload-openai';
  if (/sensevoice|funasr/i.test(asr)) return 'local-sensevoice';
  return undefined;
}

function createRecordId(): string {
  return `rec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
