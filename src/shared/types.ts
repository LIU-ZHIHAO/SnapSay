export type TriggerBinding =
  | {
      type: 'keyboard';
      key: string;
      modifiers: Array<'Ctrl' | 'Alt' | 'Shift' | 'Meta'>;
    }
  | {
      type: 'mouse';
      button: 'middle' | 'mouse4' | 'mouse5';
    };

export type RecordingMode = 'toggle' | 'pressToTalk';

export type ProviderType = 'local' | 'cloud' | 'openai-compatible';

export interface AsrProviderConfig {
  id: string;
  enabled: boolean;
  type: Extract<ProviderType, 'local' | 'cloud'>;
  displayName: string;
  model: string;
  baseUrl?: string;
  apiKey?: string;
  localModelPath?: string;
  timeoutMs: number;
}

export interface CleanupProviderConfig {
  id: string;
  enabled: boolean;
  type: 'openai-compatible';
  displayName: string;
  model: string;
  baseUrl: string;
  apiKey?: string;
  promptTemplate: string;
  timeoutMs: number;
}

export type OutputMode = 'paste' | 'clipboard' | 'historyOnly';

export interface StoragePaths {
  dataDir: string;
  logsDir: string;
  cacheDir: string;
  modelsDir: string;
  tmpDir: string;
}

export interface AppSettings {
  trigger: TriggerBinding;
  recordingMode: RecordingMode;
  asrProvider: AsrProviderConfig;
  cleanupProvider: CleanupProviderConfig;
  cleanupEnabled: boolean;
  outputMode: OutputMode;
  paths: StoragePaths;
  maxRecordingSeconds: number;
  historyLimit: number;
}

export type VoiceRecordStatus =
  | 'recorded'
  | 'transcribing'
  | 'cleaning'
  | 'ready'
  | 'pasted'
  | 'failed';

export interface VoiceProviderMetadata {
  providerId: string;
  providerType: ProviderType;
  model: string;
}

export interface VoiceRecordMetadata {
  audioPath?: string;
  outputMode?: OutputMode;
  pasteSucceeded?: boolean;
  error?: string;
  [key: string]: string | number | boolean | undefined;
}

export interface VoiceRecord {
  id: string;
  rawText: string;
  cleanedText?: string;
  status: VoiceRecordStatus;
  durationMs: number;
  asr: VoiceProviderMetadata;
  cleanup?: VoiceProviderMetadata;
  metadata: VoiceRecordMetadata;
  createdAt: string;
  updatedAt: string;
}

export interface FloatingState {
  visible: boolean;
  status: Extract<PipelineStatus, 'recording' | 'transcribing' | 'cleaning' | 'error'>;
  level: number;
  message?: string;
}

export type PipelineStatus =
  | 'idle'
  | 'recording'
  | 'transcribing'
  | 'cleaning'
  | 'pasting'
  | 'saved'
  | 'error';
