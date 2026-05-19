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
      },
      input: {
        trigger: {
          key: 'Mouse Middle',
          modifiers: []
        },
        triggerLabel: 'Mouse Middle',
        recordMode: '点击开始/停止',
        asr: 'faster-whisper',
        asrAcceleration: 'GPU 优先',
        localModelDir: 'D:\\Antigravity\\tailkall\\models\\sensevoice',
        localAsrExePath: 'D:\\Antigravity\\tailkall\\models\\whisper\\Release\\whisper-cli.exe',
        localAsrModelPath: 'D:\\Antigravity\\tailkall\\models\\whisper\\ggml-small.bin',
        ffmpegPath: 'D:\\Antigravity\\tailkall\\models\\whisper\\ffmpeg.exe',
        fasterWhisperModelPath: 'D:\\Antigravity\\tailkall\\models\\faster-whisper\\small',
        senseVoiceModelPath: 'D:\\Antigravity\\tailkall\\models\\sensevoice\\SenseVoiceSmall',
        pythonPath: 'D:\\Antigravity\\tailkall\\.venv\\Scripts\\python.exe',
        outputMode: '仅保存记录',
        dataDir: 'D:\\Antigravity\\tailkall\\data',
        shortPressAction: '语音输入',
        longPressAction: '语音助手',
        smartMouseMode: true
      }
    });

    expect(saved.cleanup.enabled).toBe(true);
    expect(store.getSettings().cleanup.provider?.model).toBe('deepseek-chat');
    expect(store.getSettings().input.recordMode).toBe('点击开始/停止');
    expect(store.getSettings().input.asr).toBe('faster-whisper');
    expect(store.getSettings().input.asrAcceleration).toBe('GPU 优先');
    expect(store.getSettings().input.outputMode).toBe('仅保存记录');
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
});
