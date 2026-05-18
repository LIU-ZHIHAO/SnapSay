import { describe, expect, it, vi } from 'vitest';
import {
  buildChatCompletionPayload,
  cleanupText,
  createMockAsrProvider,
  createWhisperCppAsrProvider,
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

  it('transcribes audio through a local whisper.cpp CLI adapter', async () => {
    const writes: Array<{ path: string; data: Buffer }> = [];
    const commands: Array<{ file: string; args: string[] }> = [];
    const asr = createWhisperCppAsrProvider({
      executablePath: 'D:\\Antigravity\\tailkall\\models\\whisper\\whisper-cli.exe',
      modelPath: 'D:\\Antigravity\\tailkall\\models\\whisper\\ggml-small.bin',
      tmpDir: 'D:\\Antigravity\\tailkall\\tmp',
      ffmpegPath: 'D:\\Antigravity\\tailkall\\models\\whisper\\ffmpeg.exe',
      idFactory: () => 'rec-1',
      writeFile: async (path, data) => {
        writes.push({ path, data });
      },
      readTextFile: async (path) => {
        expect(path).toBe('D:\\Antigravity\\tailkall\\tmp\\rec-1.txt');
        return '  本地识别文本  ';
      },
      fileExists: async () => true,
      runCommand: async (file, args) => {
        commands.push({ file, args });
      }
    });

    const result = await asr.transcribe(new Uint8Array([1, 2, 3]).buffer);

    expect(result).toEqual({ text: '本地识别文本', provider: 'whisper.cpp' });
    expect(writes[0].path).toBe('D:\\Antigravity\\tailkall\\tmp\\rec-1.webm');
    expect(commands[0]).toEqual({
      file: 'D:\\Antigravity\\tailkall\\models\\whisper\\ffmpeg.exe',
      args: ['-y', '-i', 'D:\\Antigravity\\tailkall\\tmp\\rec-1.webm', 'D:\\Antigravity\\tailkall\\tmp\\rec-1.wav']
    });
    expect(commands[1]).toEqual({
      file: 'D:\\Antigravity\\tailkall\\models\\whisper\\whisper-cli.exe',
      args: [
        '-m',
        'D:\\Antigravity\\tailkall\\models\\whisper\\ggml-small.bin',
        '-f',
        'D:\\Antigravity\\tailkall\\tmp\\rec-1.wav',
        '-l',
        'zh',
        '-otxt',
        '-of',
        'D:\\Antigravity\\tailkall\\tmp\\rec-1'
      ]
    });
  });

  it('can disable GPU for whisper.cpp when CPU mode is selected', async () => {
    const commands: Array<{ file: string; args: string[] }> = [];
    const asr = createWhisperCppAsrProvider({
      executablePath: 'D:\\Antigravity\\tailkall\\models\\whisper\\Release\\whisper-cli.exe',
      modelPath: 'D:\\Antigravity\\tailkall\\models\\whisper\\ggml-small.bin',
      tmpDir: 'D:\\Antigravity\\tailkall\\tmp',
      acceleration: 'cpu',
      idFactory: () => 'cpu-1',
      writeFile: async () => undefined,
      readTextFile: async () => 'cpu text',
      fileExists: async () => true,
      runCommand: async (file, args) => {
        commands.push({ file, args });
      }
    });

    await asr.transcribe(new ArrayBuffer(0));

    expect(commands[0].args).toContain('-ng');
  });
});
