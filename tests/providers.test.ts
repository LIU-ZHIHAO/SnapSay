import { describe, expect, it, vi } from 'vitest';
import {
  buildChatCompletionPayload,
  cleanupText,
  createMockAsrProvider,
  maskApiKey,
  testCleanupProvider
} from '../src/main/providers';

describe('providers', () => {
  it('builds an OpenAI-compatible chat completion payload', () => {
    expect(
      buildChatCompletionPayload({
        model: 'deepseek-chat',
        transcript: 'hello   world',
        prompt: 'Polish the transcript.'
      })
    ).toEqual({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: 'Polish the transcript.' },
        { role: 'user', content: 'hello   world' }
      ],
      temperature: 0.2
    });
  });

  it('calls cleanup API with DeepSeek default base URL and never exposes full API keys in errors', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'invalid sk-secret-123456'
    });

    await expect(
      cleanupText({
        provider: {
          type: 'openai-compatible',
          name: 'DeepSeek',
          apiKey: 'sk-secret-123456',
          model: 'deepseek-chat'
        },
        transcript: 'raw words',
        prompt: 'Clean it',
        fetch
      })
    ).rejects.toThrow(/sk-\*\*\*3456/);

    expect(fetch).toHaveBeenCalledWith(
      'https://api.deepseek.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer sk-secret-123456'
        })
      })
    );
  });

  it('returns cleaned content and tests provider connectivity', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'clean text' } }]
      })
    });

    await expect(
      cleanupText({
        provider: {
          type: 'openai-compatible',
          name: 'Custom',
          baseUrl: 'https://example.com/v1/',
          apiKey: 'sk-live-9999',
          model: 'cleanup-model'
        },
        transcript: 'raw',
        fetch
      })
    ).resolves.toBe('clean text');

    await expect(
      testCleanupProvider({
        provider: {
          type: 'openai-compatible',
          name: 'Custom',
          baseUrl: 'https://example.com/v1',
          apiKey: 'sk-live-9999',
          model: 'cleanup-model'
        },
        fetch
      })
    ).resolves.toEqual({ ok: true });
  });

  it('masks keys and exposes a mock ASR provider placeholder', async () => {
    expect(maskApiKey('sk-abcdef123456')).toBe('sk-***3456');

    const asr = createMockAsrProvider('recognized text');
    await expect(asr.transcribe(new ArrayBuffer(0))).resolves.toEqual({
      text: 'recognized text',
      provider: 'mock'
    });
  });
});
