import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

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
  totalTokens?: number;
  pasteSucceeded?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type NewTranscriptionRecord = Omit<
  TranscriptionRecord,
  'id' | 'createdAt' | 'updatedAt'
>;

export type ImportRecordsResult = {
  imported: number;
  updated: number;
  skipped: number;
  records: TranscriptionRecord[];
};

export type RecordStore = {
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
  close?(): void;
};

type SqliteRecordRow = {
  id: string;
  transcript: string;
  cleaned_text: string | null;
  user_correction: string | null;
  status: TranscriptionRecordStatus;
  error: string | null;
  asr_provider: string | null;
  asr_model: string | null;
  cleanup_provider: string | null;
  cleanup_model: string | null;
  duration_ms: number | null;
  asr_duration_ms: number | null;
  cleanup_duration_ms: number | null;
  total_tokens: number | null;
  paste_succeeded: number | null;
  created_at: string;
  updated_at: string;
};

export function createRecordId(): string {
  return `rec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createMemoryRecordStore(initialRecords: TranscriptionRecord[] = []): RecordStore {
  const records = new Map<string, TranscriptionRecord>();
  const order = new Map<string, number>();
  let nextOrder = 0;
  for (const record of initialRecords) {
    const normalized = normalizeRecord(record);
    records.set(normalized.id, normalized);
    order.set(normalized.id, nextOrder);
    nextOrder += 1;
  }

  const listRecords = () =>
    [...records.values()].sort((left, right) => {
      const byCreatedAt = right.createdAt.localeCompare(left.createdAt);
      if (byCreatedAt !== 0) {
        return byCreatedAt;
      }
      return (order.get(right.id) ?? 0) - (order.get(left.id) ?? 0);
    });

  return {
    listRecords,
    addRecord(record: NewTranscriptionRecord): TranscriptionRecord {
      const now = new Date().toISOString();
      const saved = normalizeRecord({
        ...record,
        id: createRecordId(),
        createdAt: now,
        updatedAt: now
      });
      records.set(saved.id, saved);
      order.set(saved.id, nextOrder);
      nextOrder += 1;
      return saved;
    },
    updateRecord(
      id: string,
      patch: Partial<Omit<TranscriptionRecord, 'id' | 'createdAt'>>
    ): TranscriptionRecord | undefined {
      const current = records.get(id);
      if (!current) {
        return undefined;
      }
      const updated = normalizeRecord({
        ...current,
        ...patch,
        id: current.id,
        createdAt: current.createdAt,
        updatedAt: new Date().toISOString()
      });
      records.set(id, updated);
      return updated;
    },
    deleteRecord(id: string): boolean {
      return records.delete(id);
    },
    clearDiagnosticLogs(): number {
      let cleared = 0;
      for (const record of records.values()) {
        if (!record.error) {
          continue;
        }
        cleared += 1;
        records.set(record.id, {
          ...record,
          error: undefined,
          updatedAt: new Date().toISOString()
        });
      }
      return cleared;
    },
    clearAllRecords(): void {
      records.clear();
    },
    importRecords(nextRecords: TranscriptionRecord[]): ImportRecordsResult {
      let imported = 0;
      let updated = 0;
      let skipped = 0;
      for (const item of nextRecords) {
        const normalized = normalizeImportedRecord(item);
        if (!normalized) {
          skipped += 1;
          continue;
        }
        if (records.has(normalized.id)) {
          updated += 1;
        } else {
          imported += 1;
          order.set(normalized.id, nextOrder);
          nextOrder += 1;
        }
        records.set(normalized.id, normalized);
      }
      return { imported, updated, skipped, records: listRecords() };
    }
  };
}

export function createSqliteRecordStore(options: { dbPath: string }): RecordStore {
  mkdirSync(dirname(options.dbPath), { recursive: true });
  const db = new Database(options.dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS transcription_records (
      id TEXT PRIMARY KEY,
      transcript TEXT NOT NULL,
      cleaned_text TEXT,
      user_correction TEXT,
      status TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
      error TEXT,
      asr_provider TEXT,
      asr_model TEXT,
      cleanup_provider TEXT,
      cleanup_model TEXT,
      duration_ms INTEGER,
      asr_duration_ms INTEGER,
      cleanup_duration_ms INTEGER,
      total_tokens INTEGER,
      paste_succeeded INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_transcription_records_created_at
      ON transcription_records(created_at DESC);
  `);

  const insertOrReplace = db.prepare(`
    INSERT INTO transcription_records (
      id, transcript, cleaned_text, user_correction, status, error,
      asr_provider, asr_model, cleanup_provider, cleanup_model,
      duration_ms, asr_duration_ms, cleanup_duration_ms, total_tokens,
      paste_succeeded, created_at, updated_at
    ) VALUES (
      @id, @transcript, @cleaned_text, @user_correction, @status, @error,
      @asr_provider, @asr_model, @cleanup_provider, @cleanup_model,
      @duration_ms, @asr_duration_ms, @cleanup_duration_ms, @total_tokens,
      @paste_succeeded, @created_at, @updated_at
    )
    ON CONFLICT(id) DO UPDATE SET
      transcript = excluded.transcript,
      cleaned_text = excluded.cleaned_text,
      user_correction = excluded.user_correction,
      status = excluded.status,
      error = excluded.error,
      asr_provider = excluded.asr_provider,
      asr_model = excluded.asr_model,
      cleanup_provider = excluded.cleanup_provider,
      cleanup_model = excluded.cleanup_model,
      duration_ms = excluded.duration_ms,
      asr_duration_ms = excluded.asr_duration_ms,
      cleanup_duration_ms = excluded.cleanup_duration_ms,
      total_tokens = excluded.total_tokens,
      paste_succeeded = excluded.paste_succeeded,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at
  `);

  const recordExists = db.prepare<[string], { found: 1 }>(
    'SELECT 1 AS found FROM transcription_records WHERE id = ?'
  );
  const list = db.prepare<[], SqliteRecordRow>(
    'SELECT * FROM transcription_records ORDER BY created_at DESC'
  );
  const getById = db.prepare<[string], SqliteRecordRow>(
    'SELECT * FROM transcription_records WHERE id = ?'
  );
  const update = db.prepare(`
    UPDATE transcription_records SET
      transcript = @transcript,
      cleaned_text = @cleaned_text,
      user_correction = @user_correction,
      status = @status,
      error = @error,
      asr_provider = @asr_provider,
      asr_model = @asr_model,
      cleanup_provider = @cleanup_provider,
      cleanup_model = @cleanup_model,
      duration_ms = @duration_ms,
      asr_duration_ms = @asr_duration_ms,
      cleanup_duration_ms = @cleanup_duration_ms,
      total_tokens = @total_tokens,
      paste_succeeded = @paste_succeeded,
      updated_at = @updated_at
    WHERE id = @id
  `);
  const remove = db.prepare<[string]>('DELETE FROM transcription_records WHERE id = ?');
  const clear = db.prepare('DELETE FROM transcription_records');
  const recordsWithErrors = db.prepare<[], { id: string }>(
    "SELECT id FROM transcription_records WHERE error IS NOT NULL AND error != ''"
  );
  const clearError = db.prepare<[string, string]>(
    'UPDATE transcription_records SET error = NULL, updated_at = ? WHERE id = ?'
  );

  const listRecords = () => list.all().map(recordFromRow);

  return {
    listRecords,
    addRecord(record: NewTranscriptionRecord): TranscriptionRecord {
      const now = new Date().toISOString();
      const saved = normalizeRecord({
        ...record,
        id: createRecordId(),
        createdAt: now,
        updatedAt: now
      });
      insertOrReplace.run(rowFromRecord(saved));
      return saved;
    },
    updateRecord(
      id: string,
      patch: Partial<Omit<TranscriptionRecord, 'id' | 'createdAt'>>
    ): TranscriptionRecord | undefined {
      const current = getById.get(id);
      if (!current) {
        return undefined;
      }
      const updated = normalizeRecord({
        ...recordFromRow(current),
        ...patch,
        id,
        createdAt: current.created_at,
        updatedAt: new Date().toISOString()
      });
      update.run(rowFromRecord(updated));
      return updated;
    },
    deleteRecord(id: string): boolean {
      return remove.run(id).changes > 0;
    },
    clearDiagnosticLogs(): number {
      const ids = recordsWithErrors.all().map((row) => row.id);
      const now = new Date().toISOString();
      const transaction = db.transaction(() => {
        for (const id of ids) {
          clearError.run(now, id);
        }
      });
      transaction();
      return ids.length;
    },
    clearAllRecords(): void {
      clear.run();
    },
    importRecords(nextRecords: TranscriptionRecord[]): ImportRecordsResult {
      let imported = 0;
      let updated = 0;
      let skipped = 0;
      const transaction = db.transaction((records: TranscriptionRecord[]) => {
        for (const item of records) {
          const normalized = normalizeImportedRecord(item);
          if (!normalized) {
            skipped += 1;
            continue;
          }
          if (recordExists.get(normalized.id)) {
            updated += 1;
          } else {
            imported += 1;
          }
          insertOrReplace.run(rowFromRecord(normalized));
        }
      });
      transaction(nextRecords);
      return { imported, updated, skipped, records: listRecords() };
    },
    close(): void {
      db.close();
    }
  };
}

export function normalizeImportedRecord(record: unknown): TranscriptionRecord | undefined {
  if (!record || typeof record !== 'object') {
    return undefined;
  }
  const candidate = record as Partial<TranscriptionRecord>;
  if (!candidate.id || typeof candidate.id !== 'string') {
    return undefined;
  }
  if (!candidate.transcript || typeof candidate.transcript !== 'string') {
    return undefined;
  }
  return normalizeRecord({
    id: candidate.id,
    transcript: candidate.transcript,
    cleanedText: asOptionalString(candidate.cleanedText),
    userCorrection: asOptionalString(candidate.userCorrection),
    status: candidate.status === 'failed' ? 'failed' : 'completed',
    error: asOptionalString(candidate.error),
    asrProvider: asOptionalString(candidate.asrProvider),
    asrModel: asOptionalString(candidate.asrModel),
    cleanupProvider: asOptionalString(candidate.cleanupProvider),
    cleanupModel: asOptionalString(candidate.cleanupModel),
    durationMs: asOptionalNumber(candidate.durationMs),
    asrDurationMs: asOptionalNumber(candidate.asrDurationMs),
    cleanupDurationMs: asOptionalNumber(candidate.cleanupDurationMs),
    totalTokens: asOptionalNumber(candidate.totalTokens),
    pasteSucceeded: typeof candidate.pasteSucceeded === 'boolean' ? candidate.pasteSucceeded : undefined,
    createdAt: asIsoString(candidate.createdAt) ?? new Date().toISOString(),
    updatedAt: asIsoString(candidate.updatedAt) ?? asIsoString(candidate.createdAt) ?? new Date().toISOString()
  });
}

function normalizeRecord(record: TranscriptionRecord): TranscriptionRecord {
  return {
    ...record,
    status: record.status === 'failed' ? 'failed' : 'completed',
    transcript: record.transcript ?? '',
    createdAt: record.createdAt || new Date().toISOString(),
    updatedAt: record.updatedAt || record.createdAt || new Date().toISOString()
  };
}

function rowFromRecord(record: TranscriptionRecord): SqliteRecordRow {
  return {
    id: record.id,
    transcript: record.transcript,
    cleaned_text: record.cleanedText ?? null,
    user_correction: record.userCorrection ?? null,
    status: record.status,
    error: record.error ?? null,
    asr_provider: record.asrProvider ?? null,
    asr_model: record.asrModel ?? null,
    cleanup_provider: record.cleanupProvider ?? null,
    cleanup_model: record.cleanupModel ?? null,
    duration_ms: record.durationMs ?? null,
    asr_duration_ms: record.asrDurationMs ?? null,
    cleanup_duration_ms: record.cleanupDurationMs ?? null,
    total_tokens: record.totalTokens ?? null,
    paste_succeeded: record.pasteSucceeded == null ? null : Number(record.pasteSucceeded),
    created_at: record.createdAt,
    updated_at: record.updatedAt
  };
}

function recordFromRow(row: SqliteRecordRow): TranscriptionRecord {
  return {
    id: row.id,
    transcript: row.transcript,
    cleanedText: row.cleaned_text ?? undefined,
    userCorrection: row.user_correction ?? undefined,
    status: row.status,
    error: row.error ?? undefined,
    asrProvider: row.asr_provider ?? undefined,
    asrModel: row.asr_model ?? undefined,
    cleanupProvider: row.cleanup_provider ?? undefined,
    cleanupModel: row.cleanup_model ?? undefined,
    durationMs: row.duration_ms ?? undefined,
    asrDurationMs: row.asr_duration_ms ?? undefined,
    cleanupDurationMs: row.cleanup_duration_ms ?? undefined,
    totalTokens: row.total_tokens ?? undefined,
    pasteSucceeded: row.paste_succeeded == null ? undefined : Boolean(row.paste_succeeded),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asIsoString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}
