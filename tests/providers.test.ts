import { describe, expect, it, vi } from 'vitest';
import {
  buildChatCompletionPayload,
  cleanupText,
  createMockAsrProvider,
  createPythonAsrProvider,
  formatProviderTestDuration,
  maskApiKey,
  resolveActiveCleanupProvider,
  testCleanupProvider,
  createCloudStreamingAsrProvider
} from '../src/main/providers';
import { defaultSettings } from '../src/main/settingsStore';

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
        fetch,
        now: vi.fn()
          .mockReturnValueOnce(1000)
          .mockReturnValueOnce(2200)
      })
    ).resolves.toEqual({ ok: true, durationMs: 1200 });
  });

  it('formats provider test latency with one decimal only when needed', () => {
    expect(formatProviderTestDuration(1000)).toBe('1秒');
    expect(formatProviderTestDuration(1200)).toBe('1.2秒');
    expect(formatProviderTestDuration(1260)).toBe('1.3秒');
  });

  it('rejects non-header-safe API keys before fetch converts Authorization to ByteString', async () => {
    const fetch = vi.fn();

    await expect(
      testCleanupProvider({
        provider: {
          type: 'openai-compatible',
          name: '火山方舟',
          baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
          apiKey: '整理-key',
          model: 'deepseek-v3'
        },
        fetch
      })
    ).resolves.toEqual({
      ok: false,
      error: 'API Key 含有请求 Header 不支持的字符，请只粘贴服务商控制台生成的密钥，不要包含中文说明或全角字符。'
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fails cleanup provider tests before network when required config is missing', async () => {
    const fetch = vi.fn();

    await expect(
      testCleanupProvider({
        provider: {
          type: 'openai-compatible',
          name: 'Custom',
          baseUrl: '',
          apiKey: '',
          model: ''
        },
        fetch
      })
    ).resolves.toEqual({
      ok: false,
      error: '整理模型配置不完整：请填写 Base URL、API Key、Model 后再测试连接。'
    });

    expect(fetch).not.toHaveBeenCalled();
  });

  it('resolves the active LLM provider card for cleanup', () => {
    const settings = {
      ...defaultSettings,
      cleanup: {
        ...defaultSettings.cleanup,
        activeProviderKey: 'openai',
        providers: defaultSettings.cleanup.providers.map((provider) =>
          provider.key === 'openai'
            ? { ...provider, enabled: true, apiKey: 'sk-openai', model: 'gpt-4.1-mini' }
            : provider
        )
      }
    };

    expect(resolveActiveCleanupProvider(settings)).toEqual({
      type: 'openai-compatible',
      name: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-openai',
      model: 'gpt-4.1-mini'
    });
  });

  it('masks keys and exposes a mock ASR provider placeholder', async () => {
    expect(maskApiKey('sk-abcdef123456')).toBe('sk-***3456');

    const asr = createMockAsrProvider('recognized text');
    await expect(asr.transcribe(new ArrayBuffer(0))).resolves.toEqual({
      text: 'recognized text',
      provider: 'mock'
    });
  });

  it('transcribes through the SenseVoice Python ASR provider with GPU auto device', async () => {
    const commands: Array<{ file: string; args: string[] }> = [];
    const asr = createPythonAsrProvider({
      engine: 'sensevoice-funasr',
      pythonPath: 'D:\\Antigravity\\SnapSay\\.venv\\Scripts\\python.exe',
      scriptPath: 'D:\\Antigravity\\SnapSay\\scripts\\asr-sensevoice.py',
      modelPath: 'D:\\Antigravity\\SnapSay\\models\\sensevoice\\SenseVoiceSmall',
      tmpDir: 'D:\\Antigravity\\SnapSay\\tmp',
      ffmpegPath: 'ffmpeg',
      acceleration: 'auto-gpu',
      idFactory: () => 'py-1',
      writeFile: async () => undefined,
      readTextFile: async () => 'python text',
      fileExists: async () => true,
      runCommand: async (file, args) => {
        commands.push({ file, args });
      }
    });

    await expect(asr.transcribe(new ArrayBuffer(0))).resolves.toEqual({
      text: 'python text',
      provider: 'sensevoice-funasr'
    });

    expect(commands[1]).toEqual({
      file: 'D:\\Antigravity\\SnapSay\\.venv\\Scripts\\python.exe',
      args: [
        'D:\\Antigravity\\SnapSay\\scripts\\asr-sensevoice.py',
        '--audio',
        'D:\\Antigravity\\SnapSay\\tmp\\py-1.wav',
        '--model',
        'D:\\Antigravity\\SnapSay\\models\\sensevoice\\SenseVoiceSmall',
        '--out',
        'D:\\Antigravity\\SnapSay\\tmp\\py-1.sensevoice-funasr.txt',
        '--device',
        'auto',
        '--language',
        'zh'
      ]
    });
  });

  it('skips ffmpeg conversion when Python ASR receives WAV audio', async () => {
    const commands: Array<{ file: string; args: string[] }> = [];
    const asr = createPythonAsrProvider({
      engine: 'sensevoice-funasr',
      pythonPath: 'D:\\Antigravity\\SnapSay\\.venv\\Scripts\\python.exe',
      scriptPath: 'D:\\Antigravity\\SnapSay\\scripts\\asr-sensevoice.py',
      modelPath: 'D:\\Antigravity\\SnapSay\\models\\sensevoice\\SenseVoiceSmall',
      tmpDir: 'D:\\Antigravity\\SnapSay\\tmp',
      ffmpegPath: 'ffmpeg',
      idFactory: () => 'py-wav',
      writeFile: async () => undefined,
      readTextFile: async () => 'python wav text',
      fileExists: async () => true,
      runCommand: async (file, args) => {
        commands.push({ file, args });
      }
    });

    const wav = new TextEncoder().encode('RIFF....WAVEfmt ');
    await asr.transcribe(wav.buffer);

    expect(commands).toHaveLength(1);
    expect(commands[0]).toEqual({
      file: 'D:\\Antigravity\\SnapSay\\.venv\\Scripts\\python.exe',
      args: [
        'D:\\Antigravity\\SnapSay\\scripts\\asr-sensevoice.py',
        '--audio',
        'D:\\Antigravity\\SnapSay\\tmp\\py-wav.wav',
        '--model',
        'D:\\Antigravity\\SnapSay\\models\\sensevoice\\SenseVoiceSmall',
        '--out',
        'D:\\Antigravity\\SnapSay\\tmp\\py-wav.sensevoice-funasr.txt',
        '--device',
        'auto',
        '--language',
        'zh'
      ]
    });
  });

  it('returns a clear placeholder for cloud streaming ASR profiles', async () => {
    const asr = createCloudStreamingAsrProvider({
      provider: {
        id: 'cloud-streaming-custom',
        kind: 'cloud-streaming',
        displayName: '云端流式转写 API',
        engine: 'streaming-compatible',
        enabled: true,
        baseUrl: 'wss://stream.example.com/listen',
        apiKey: 'stream-key',
        model: 'nova-3'
      }
    });

    await expect(asr.transcribe(new ArrayBuffer(0))).rejects.toThrow(/流式 ASR/);
  });
});
