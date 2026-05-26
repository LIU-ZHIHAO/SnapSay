import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createMemoryRecordStore,
  createSqliteRecordStore,
  type TranscriptionRecord
} from '../src/main/recordStore';

const tempDirs: string[] = [];

function tempDbPath(): string {
  const baseDir = join(process.cwd(), 'tmp', 'tests');
  mkdirSync(baseDir, { recursive: true });
  const dir = mkdtempSync(join(baseDir, 'snapsay-records-'));
  tempDirs.push(dir);
  return join(dir, 'snapsay.db');
}

function demoRecord(id: string, createdAt: string): TranscriptionRecord {
  return {
    id,
    transcript: `raw ${id}`,
    cleanedText: `clean ${id}`,
    status: 'completed',
    asrProvider: 'sensevoice',
    asrModel: 'SenseVoiceSmall',
    cleanupProvider: 'DeepSeek',
    cleanupModel: 'deepseek-chat',
    durationMs: 1200,
    asrDurationMs: 300,
    cleanupDurationMs: 500,
    totalTokens: 42,
    pasteSucceeded: true,
    createdAt,
    updatedAt: createdAt
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('recordStore', () => {
  it('persists records in SQLite independently from settings JSON', () => {
    const dbPath = tempDbPath();
    const firstStore = createSqliteRecordStore({ dbPath });
    firstStore.importRecords([
      demoRecord('rec_1', '2026-05-25T10:00:00.000Z'),
      demoRecord('rec_2', '2026-05-25T11:00:00.000Z')
    ]);
    firstStore.close?.();

    const secondStore = createSqliteRecordStore({ dbPath });
    expect(secondStore.listRecords().map((record) => record.id)).toEqual(['rec_2', 'rec_1']);
    secondStore.close?.();
  });

  it('imports records by id without duplicating existing rows', () => {
    const store = createMemoryRecordStore();
    store.importRecords([demoRecord('rec_1', '2026-05-25T10:00:00.000Z')]);
    store.importRecords([
      { ...demoRecord('rec_1', '2026-05-25T10:00:00.000Z'), cleanedText: 'updated clean' },
      demoRecord('rec_2', '2026-05-25T11:00:00.000Z')
    ]);

    expect(store.listRecords()).toHaveLength(2);
    expect(store.listRecords().find((record) => record.id === 'rec_1')?.cleanedText).toBe('updated clean');
  });
});
