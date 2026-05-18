export type CleanupProviderConfig = {
  type: 'openai-compatible';
  name: string;
  baseUrl?: string;
  apiKey: string;
  model: string;
};

export type AppSettings = {
  cleanup: {
    enabled: boolean;
    provider?: CleanupProviderConfig;
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
    outputMode: string;
    dataDir: string;
  };
};

export type TranscriptionRecordStatus = 'completed' | 'failed';

export type TranscriptionRecord = {
  id: string;
  transcript: string;
  cleanedText?: string;
  status: TranscriptionRecordStatus;
  error?: string;
  asrProvider?: string;
  asrModel?: string;
  cleanupProvider?: string;
  cleanupModel?: string;
  durationMs?: number;
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
  saveSettings(settings: Partial<AppSettings>): AppSettings;
  listRecords(): TranscriptionRecord[];
  addRecord(record: NewTranscriptionRecord): TranscriptionRecord;
  updateRecord(
    id: string,
    patch: Partial<Omit<TranscriptionRecord, 'id' | 'createdAt'>>
  ): TranscriptionRecord | undefined;
  deleteRecord(id: string): boolean;
};

export const defaultSettings: AppSettings = {
  cleanup: {
    enabled: false,
    prompt: 'Clean up this voice transcript. Preserve meaning and return only the cleaned text.'
  },
  input: {
    trigger: {
      key: 'f9',
      modifiers: []
    },
    triggerLabel: 'F8',
    recordMode: '按住说话',
    asr: 'whisper.cpp',
    asrAcceleration: 'GPU 优先',
    localModelDir: 'D:\\Antigravity\\tailkall\\models',
    localAsrExePath: 'D:\\Antigravity\\tailkall\\models\\whisper\\Release\\whisper-cli.exe',
    localAsrModelPath: 'D:\\Antigravity\\tailkall\\models\\whisper\\ggml-small.bin',
    ffmpegPath: 'D:\\Antigravity\\tailkall\\models\\whisper\\ffmpeg.exe',
    outputMode: '粘贴到当前光标',
    dataDir: 'D:\\Antigravity\\tailkall\\data'
  }
};

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
    saveSettings(settings: Partial<AppSettings>): AppSettings {
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
    }
  };
}

function mergeSettings(settings?: Partial<AppSettings>): AppSettings {
  return {
    cleanup: {
      ...defaultSettings.cleanup,
      ...settings?.cleanup
    },
      input: {
        ...defaultSettings.input,
        ...settings?.input,
        trigger: {
        ...defaultSettings.input.trigger,
        ...settings?.input?.trigger
      }
    }
  };
}

function createRecordId(): string {
  return `rec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
