import { describe, expect, it } from 'vitest';
import {
  createMemoryStore,
  createSettingsStore,
  defaultSettings
} from '../src/main/settingsStore';
import { DEFAULT_CLEANUP_PROMPT } from '../src/shared/cleanupPolicy';

describe('settingsStore', () => {
  it('saves and reads settings from an injected memory store', () => {
    const store = createSettingsStore({ store: createMemoryStore() });

    expect(store.getSettings()).toEqual(defaultSettings);
    expect(store.getSettings().cleanup.prompt).toBe(DEFAULT_CLEANUP_PROMPT);
    expect(store.getSettings().cleanup.activeProviderKey).toBe('deepseek');
    expect(store.getSettings().cleanup.providers.map((provider) => provider.key)).toEqual(
      expect.arrayContaining(['openai', 'deepseek', 'openrouter', 'custom-openai'])
    );
    expect(store.getSettings().input.activeAsrProfileId).toBe('local-sensevoice');
    expect(store.getSettings().input.microphoneDeviceId).toBe('');
    expect(store.getSettings().input.asrProfiles.filter((profile) => profile.kind === 'local')).toEqual([
      { id: 'local-sensevoice', kind: 'local', displayName: '本地 SenseVoice', engine: 'SenseVoice', enabled: true }
    ]);

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
      },
      input: {
        trigger: {
          key: 'Mouse Middle',
          modifiers: []
        },
        triggerLabel: 'Mouse Middle',
        recordMode: '点击开始/停止',
        asr: 'removed-local-engine',
        asrAcceleration: 'GPU 优先',
        localModelDir: 'D:\\Antigravity\\tailkall\\models\\sensevoice',
        senseVoiceModelPath: 'D:\\Antigravity\\tailkall\\models\\sensevoice\\SenseVoiceSmall',
        pythonPath: 'D:\\Antigravity\\tailkall\\.venv\\Scripts\\python.exe',
        outputMode: '仅保存记录',
        dataDir: 'D:\\Antigravity\\tailkall\\data',
        shortPressAction: '语音输入',
        longPressAction: '语音助手',
        smartMouseMode: true,
        microphoneDeviceId: 'mic-2',
        wordbook: []
      }
    });

    expect(saved.cleanup.enabled).toBe(true);
    expect(store.getSettings().cleanup.provider?.model).toBe('deepseek-chat');
    expect(store.getSettings().cleanup.activeProviderKey).toBe('deepseek');
    expect(store.getSettings().cleanup.providers.find((provider) => provider.key === 'deepseek')?.model).toBe('deepseek-chat');
    expect(store.getSettings().input.recordMode).toBe('点击开始/停止');
    expect(store.getSettings().input.asr).toBe('SenseVoice');
    expect(store.getSettings().input.asrAcceleration).toBe('GPU 优先');
    expect(store.getSettings().input.microphoneDeviceId).toBe('mic-2');
    expect(store.getSettings().input.outputMode).toBe('仅保存记录');
  });

  it('does not restore removed local fallback profiles from saved settings', () => {
    const store = createSettingsStore({
      store: createMemoryStore({
        settings: {
          input: {
            activeAsrProfileId: 'removed-local-engine',
            asrProfiles: [
              { id: 'removed-local-engine', kind: 'local', displayName: '已移除本地引擎', engine: 'removed-local-engine', enabled: true }
            ]
          }
        }
      })
    });

    expect(store.getSettings().input.activeAsrProfileId).toBe('local-sensevoice');
    expect(store.getSettings().input.asr).toBe('SenseVoice');
    expect(store.getSettings().input.asrProfiles.map((profile) => profile.id)).not.toEqual(
      expect.arrayContaining(['removed-local-engine'])
    );
  });

  it('saves multiple LLM provider cards and ASR profile choices', () => {
    const store = createSettingsStore({ store: createMemoryStore() });

    const saved = store.saveSettings({
      cleanup: {
        enabled: true,
        activeProviderKey: 'siliconflow',
        providers: defaultSettings.cleanup.providers.map((provider) =>
          provider.key === 'siliconflow'
            ? { ...provider, enabled: true, apiKey: 'sk-sf', model: 'Qwen/Qwen2.5-72B-Instruct' }
            : provider
        ),
        prompt: 'Clean this transcript'
      },
      input: {
        activeAsrProfileId: 'cloud-streaming-custom',
        asrProfiles: defaultSettings.input.asrProfiles.map((profile) =>
          profile.id === 'cloud-streaming-custom'
            ? { ...profile, enabled: true, apiKey: 'dg-key', model: 'nova-3', baseUrl: 'wss://api.deepgram.com/v1/listen' }
            : profile
        )
      }
    });

    expect(saved.cleanup.providers.find((provider) => provider.key === 'siliconflow')?.apiKey).toBe('sk-sf');
    expect(saved.cleanup.activeProviderKey).toBe('siliconflow');
    expect(saved.input.activeAsrProfileId).toBe('cloud-streaming-custom');
    expect(saved.input.asrProfiles.find((profile) => profile.id === 'cloud-streaming-custom')?.kind).toBe('cloud-streaming');
  });

  it('adds, updates, lists, and deletes transcription records', () => {
    const store = createSettingsStore({ store: createMemoryStore() });

    const first = store.addRecord({
      transcript: 'raw text',
      cleanedText: 'clean text',
      status: 'completed',
      asrProvider: 'local',
      asrModel: 'SenseVoice',
      cleanupProvider: 'DeepSeek',
      cleanupModel: 'deepseek-chat',
      durationMs: 1200,
      pasteSucceeded: true
    });
    const second = store.addRecord({
      transcript: 'failed raw',
      status: 'failed',
      error: 'cleanup failed'
    });

    expect(first.id).toBeTruthy();
    expect(first.asrModel).toBe('SenseVoice');
    expect(first.durationMs).toBe(1200);
    expect(store.listRecords()).toEqual([second, first]);

    const updated = store.updateRecord(first.id, { cleanedText: 'updated clean' });
    expect(updated?.cleanedText).toBe('updated clean');

    expect(store.deleteRecord(second.id)).toBe(true);
    expect(store.listRecords()).toHaveLength(1);
    expect(store.deleteRecord('missing')).toBe(false);
  });

  it('clears diagnostic errors without deleting transcription records', () => {
    const store = createSettingsStore({ store: createMemoryStore() });

    const first = store.addRecord({
      transcript: 'failed raw',
      status: 'failed',
      error: 'Cleanup provider DeepSeek failed with HTTP 402: insufficient balance'
    });
    const second = store.addRecord({
      transcript: 'failed again',
      status: 'failed',
      error: 'Cleanup provider DeepSeek failed with HTTP 402: insufficient balance'
    });

    const cleared = store.clearDiagnosticLogs();

    expect(cleared).toBe(2);
    expect(store.listRecords()).toHaveLength(2);
    expect(store.listRecords().map((record) => record.id).sort()).toEqual([first.id, second.id].sort());
    expect(store.listRecords().every((record) => record.error === undefined)).toBe(true);
  });
});
