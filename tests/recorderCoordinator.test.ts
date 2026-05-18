import { describe, expect, it } from 'vitest';
import { makeVoiceRecord } from '../src/shared/validation';

describe('voice record pipeline model', () => {
  it('saves raw text, cleaned text, status, provider metadata, and pipeline metadata', () => {
    const record = makeVoiceRecord({
      rawText: '原始识别文本',
      cleanedText: '整理后的文本',
      status: 'pasted',
      durationMs: 2430,
      asr: { providerId: 'local-sensevoice', providerType: 'local', model: 'SenseVoiceSmall' },
      cleanup: { providerId: 'deepseek', providerType: 'openai-compatible', model: 'deepseek-chat' },
      metadata: {
        audioPath: 'D:\\Antigravity\\tailkall\\data\\recordings\\sample.wav',
        outputMode: 'paste',
        pasteSucceeded: true
      },
      now: () => new Date('2026-05-18T15:30:00.000Z'),
      idFactory: () => 'voice-1'
    });

    expect(record).toMatchObject({
      id: 'voice-1',
      rawText: '原始识别文本',
      cleanedText: '整理后的文本',
      status: 'pasted',
      durationMs: 2430,
      asr: { providerId: 'local-sensevoice', providerType: 'local', model: 'SenseVoiceSmall' },
      cleanup: { providerId: 'deepseek', providerType: 'openai-compatible', model: 'deepseek-chat' },
      metadata: {
        audioPath: 'D:\\Antigravity\\tailkall\\data\\recordings\\sample.wav',
        outputMode: 'paste',
        pasteSucceeded: true
      },
      createdAt: '2026-05-18T15:30:00.000Z',
      updatedAt: '2026-05-18T15:30:00.000Z'
    });
  });
});
