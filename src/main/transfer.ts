import { normalizeImportedRecord, type TranscriptionRecord } from './recordStore.js';
import type { WordbookEntry } from './settingsStore.js';

export type SnapSayTransferPayload = {
  app: 'SnapSay';
  version: 2;
  exportedAt: string;
  records: TranscriptionRecord[];
  wordbook: WordbookEntry[];
};

export type SnapSayWordbookPayload = {
  app: 'SnapSay';
  type: 'wordbook';
  version: 1;
  exportedAt: string;
  wordbook: WordbookEntry[];
};

export type ParsedTransferPayload = {
  records: TranscriptionRecord[];
  wordbook: WordbookEntry[];
};

export function createTransferPayload(records: TranscriptionRecord[], wordbook: WordbookEntry[]): SnapSayTransferPayload {
  return {
    app: 'SnapSay',
    version: 2,
    exportedAt: new Date().toISOString(),
    records,
    wordbook: normalizeWordbookEntries(wordbook)
  };
}

export function createWordbookTransferPayload(wordbook: WordbookEntry[]): SnapSayWordbookPayload {
  return {
    app: 'SnapSay',
    type: 'wordbook',
    version: 1,
    exportedAt: new Date().toISOString(),
    wordbook: normalizeWordbookEntries(wordbook)
  };
}

export function parseTransferPayload(text: string): ParsedTransferPayload {
  const parsed = JSON.parse(text) as unknown;
  const rawRecords = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { records?: unknown }).records)
      ? (parsed as { records: unknown[] }).records
      : [];
  const rawWordbook = parsed && typeof parsed === 'object' && Array.isArray((parsed as { wordbook?: unknown }).wordbook)
    ? (parsed as { wordbook: unknown[] }).wordbook
    : [];

  return {
    records: rawRecords
      .map((record) => normalizeImportedRecord(record))
      .filter((record): record is TranscriptionRecord => Boolean(record)),
    wordbook: normalizeWordbookEntries(rawWordbook)
  };
}

export function parseWordbookTransferPayload(text: string): WordbookEntry[] {
  const parsed = JSON.parse(text) as unknown;
  const rawWordbook = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { wordbook?: unknown }).wordbook)
      ? (parsed as { wordbook: unknown[] }).wordbook
      : [];
  return normalizeWordbookEntries(rawWordbook);
}

export function mergeWordbookEntries(existing: WordbookEntry[], imported: WordbookEntry[]): WordbookEntry[] {
  const merged = normalizeWordbookEntries(existing);
  for (const entry of normalizeWordbookEntries(imported)) {
    const targetKey = entry.target.trim().toLowerCase();
    const current = merged.find((item) => item.target.trim().toLowerCase() === targetKey);
    if (!current) {
      merged.push(entry);
      continue;
    }
    current.variants = uniqueStrings([...current.variants, ...entry.variants]);
  }
  return merged;
}

function normalizeWordbookEntries(entries: unknown[]): WordbookEntry[] {
  return entries
    .map((entry) => normalizeWordbookEntry(entry))
    .filter((entry): entry is WordbookEntry => Boolean(entry));
}

function normalizeWordbookEntry(entry: unknown): WordbookEntry | undefined {
  if (!entry || typeof entry !== 'object') {
    return undefined;
  }
  const candidate = entry as { id?: unknown; target?: unknown; variants?: unknown };
  const target = typeof candidate.target === 'string' ? candidate.target.trim() : '';
  if (!target) {
    return undefined;
  }
  const variants = Array.isArray(candidate.variants)
    ? candidate.variants.filter((item): item is string => typeof item === 'string')
    : [];
  return {
    id: typeof candidate.id === 'string' && candidate.id.trim() ? candidate.id : `wordbook_${target.toLowerCase()}`,
    target,
    variants: uniqueStrings(variants)
  };
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}
