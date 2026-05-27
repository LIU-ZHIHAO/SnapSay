import { describe, expect, it } from 'vitest';
import { createTransferPayload, mergeWordbookEntries, parseTransferPayload } from '../src/main/transfer';

const record = {
  id: 'rec_1',
  transcript: 'cloud cold',
  cleanedText: 'cloud cold',
  status: 'completed' as const,
  createdAt: '2026-05-27T12:00:00.000Z',
  updatedAt: '2026-05-27T12:00:00.000Z',
  pasteSucceeded: true
};

describe('SnapSay transfer payload', () => {
  it('exports and imports records with wordbook entries', () => {
    const payload = createTransferPayload([record], [
      { id: 'wb_1', target: 'Claude Code', variants: ['cloud cold', 'cloud code'] }
    ]);

    const parsed = parseTransferPayload(JSON.stringify(payload));

    expect(parsed.records).toEqual([record]);
    expect(parsed.wordbook).toEqual([
      { id: 'wb_1', target: 'Claude Code', variants: ['cloud cold', 'cloud code'] }
    ]);
  });

  it('still imports legacy record-only arrays', () => {
    const parsed = parseTransferPayload(JSON.stringify([record]));

    expect(parsed.records).toEqual([record]);
    expect(parsed.wordbook).toEqual([]);
  });

  it('merges imported wordbook variants into existing targets', () => {
    const merged = mergeWordbookEntries(
      [{ id: 'wb_existing', target: 'Codex', variants: ['code x'] }],
      [
        { id: 'wb_imported', target: 'codex', variants: ['code x', 'codec'] },
        { id: 'wb_claude', target: 'Claude Code', variants: ['cloud cold'] }
      ]
    );

    expect(merged).toEqual([
      { id: 'wb_existing', target: 'Codex', variants: ['code x', 'codec'] },
      { id: 'wb_claude', target: 'Claude Code', variants: ['cloud cold'] }
    ]);
  });
});
