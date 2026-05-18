import type { TriggerBinding, VoiceRecord, VoiceRecordMetadata, VoiceRecordStatus } from './types';

const HIGH_CONFLICT_KEYS = new Set([
  'enter',
  'return',
  'space',
  'escape',
  'esc',
  'backspace',
  'tab',
  'delete'
]);

const HIGH_CONFLICT_SHORTCUTS = new Set(['ctrl+c', 'ctrl+v', 'ctrl+x', 'ctrl+z', 'ctrl+a', 'ctrl+s']);

export function isHighConflictTrigger(binding: TriggerBinding): boolean {
  if (binding.type === 'mouse') {
    return false;
  }

  const key = binding.key.trim().toLowerCase();
  if (/^[a-z0-9]$/.test(key) || HIGH_CONFLICT_KEYS.has(key)) {
    return true;
  }

  const shortcut = [...binding.modifiers.map((modifier) => modifier.toLowerCase()), key].join('+');
  return HIGH_CONFLICT_SHORTCUTS.has(shortcut);
}

export function sanitizeDigitInput(value: string): string {
  return value.replace(/\D/g, '');
}

export type StoragePathValidationResult = { valid: true } | { valid: false; reason: string };

export function validateStoragePath(path: string): StoragePathValidationResult {
  const normalized = path.trim();

  if (/^c:\\/i.test(normalized) || /^%userprofile%/i.test(normalized) || /^~[\\/]/.test(normalized)) {
    return {
      valid: false,
      reason: 'Storage paths must not default to the C drive or user profile.'
    };
  }

  if (!/^[a-z]:\\/i.test(normalized)) {
    return {
      valid: false,
      reason: 'Storage paths must be absolute Windows paths.'
    };
  }

  return { valid: true };
}

export function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 4) {
    return apiKey;
  }

  return `${'*'.repeat(apiKey.length - 4)}${apiKey.slice(-4)}`;
}

export interface MakeVoiceRecordInput {
  rawText: string;
  cleanedText?: string;
  status: VoiceRecordStatus;
  durationMs: number;
  asr: VoiceRecord['asr'];
  cleanup?: VoiceRecord['cleanup'];
  metadata?: VoiceRecordMetadata;
  now?: () => Date;
  idFactory?: () => string;
}

export function makeVoiceRecord(input: MakeVoiceRecordInput): VoiceRecord {
  const timestamp = (input.now ?? (() => new Date()))().toISOString();

  return {
    id: (input.idFactory ?? createRecordId)(),
    rawText: input.rawText,
    cleanedText: input.cleanedText,
    status: input.status,
    durationMs: input.durationMs,
    asr: input.asr,
    cleanup: input.cleanup,
    metadata: input.metadata ?? {},
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function createRecordId(): string {
  return `voice-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
