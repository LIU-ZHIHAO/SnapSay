import { describe, expect, it } from 'vitest';
import {
  createMemoryStore,
  createSettingsStore,
  defaultSettings
} from '../src/main/settingsStore';

describe('settingsStore', () => {
  it('saves and reads settings from an injected memory store', () => {
    const store = createSettingsStore({ store: createMemoryStore() });

    expect(store.getSettings()).toEqual(defaultSettings);

    const saved = store.saveSettings({
      cleanup: {
        enabled: true,
        provider: {
          type: 'openai-compatible',
          name: 'DeepSeek',
          baseUrl: 'https://api.deepseek.com/v1',
          apiKey: 'sk-test',
          model: 'deepseek-chat'
        },
        prompt: 'Clean this transcript'
      }
    });

    expect(saved.cleanup.enabled).toBe(true);
    expect(store.getSettings().cleanup.provider?.model).toBe('deepseek-chat');
  });

  it('adds, updates, lists, and deletes transcription records', () => {
    const store = createSettingsStore({ store: createMemoryStore() });

    const first = store.addRecord({
      transcript: 'raw text',
      cleanedText: 'clean text',
      status: 'completed'
    });
    const second = store.addRecord({
      transcript: 'failed raw',
      status: 'failed',
      error: 'cleanup failed'
    });

    expect(first.id).toBeTruthy();
    expect(store.listRecords()).toEqual([second, first]);

    const updated = store.updateRecord(first.id, { cleanedText: 'updated clean' });
    expect(updated?.cleanedText).toBe('updated clean');

    expect(store.deleteRecord(second.id)).toBe(true);
    expect(store.listRecords()).toHaveLength(1);
    expect(store.deleteRecord('missing')).toBe(false);
  });
});
