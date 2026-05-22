import { describe, expect, it, vi } from 'vitest';
import {
  buildChatCompletionPayload,
  cleanupText,
  createMockAsrProvider,
  createPythonAsrProvider,
  createWhisperCppAsrProvider,
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

  it('skips ffmpeg conversion when whisper.cpp receives WAV audio', async () => {
    const writes: Array<{ path: string; data: Buffer }> = [];
    const commands: Array<{ file: string; args: string[] }> = [];
    const asr = createWhisperCppAsrProvider({
      executablePath: 'D:\\Antigravity\\tailkall\\models\\whisper\\whisper-cli.exe',
      modelPath: 'D:\\Antigravity\\tailkall\\models\\whisper\\ggml-small.bin',
      tmpDir: 'D:\\Antigravity\\tailkall\\tmp',
      ffmpegPath: 'D:\\Antigravity\\tailkall\\models\\whisper\\ffmpeg.exe',
      idFactory: () => 'rec-wav',
      writeFile: async (path, data) => {
        writes.push({ path, data });
      },
      readTextFile: async () => 'wav text',
      fileExists: async () => true,
      runCommand: async (file, args) => {
        commands.push({ file, args });
      }
    });

    const wav = new TextEncoder().encode('RIFF....WAVEfmt ');
    await expect(asr.transcribe(wav.buffer)).resolves.toEqual({ text: 'wav text', provider: 'whisper.cpp' });

    expect(writes[0].path).toBe('D:\\Antigravity\\tailkall\\tmp\\rec-wav.wav');
    expect(commands).toEqual([
      {
        file: 'D:\\Antigravity\\tailkall\\models\\whisper\\whisper-cli.exe',
        args: [
          '-m',
          'D:\\Antigravity\\tailkall\\models\\whisper\\ggml-small.bin',
          '-f',
          'D:\\Antigravity\\tailkall\\tmp\\rec-wav.wav',
          '-l',
          'zh',
          '-otxt',
          '-of',
          'D:\\Antigravity\\tailkall\\tmp\\rec-wav'
        ]
      }
    ]);
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

  it('transcribes through Python ASR providers with GPU auto device', async () => {
    const commands: Array<{ file: string; args: string[] }> = [];
    const asr = createPythonAsrProvider({
      engine: 'faster-whisper',
      pythonPath: 'D:\\Antigravity\\tailkall\\.venv\\Scripts\\python.exe',
      scriptPath: 'D:\\Antigravity\\tailkall\\scripts\\asr-faster-whisper.py',
      modelPath: 'D:\\Antigravity\\tailkall\\models\\faster-whisper\\small',
      tmpDir: 'D:\\Antigravity\\tailkall\\tmp',
      ffmpegPath: 'D:\\Antigravity\\tailkall\\models\\whisper\\ffmpeg.exe',
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
      provider: 'faster-whisper'
    });

    expect(commands[1]).toEqual({
      file: 'D:\\Antigravity\\tailkall\\.venv\\Scripts\\python.exe',
      args: [
        'D:\\Antigravity\\tailkall\\scripts\\asr-faster-whisper.py',
        '--audio',
        'D:\\Antigravity\\tailkall\\tmp\\py-1.wav',
        '--model',
        'D:\\Antigravity\\tailkall\\models\\faster-whisper\\small',
        '--out',
        'D:\\Antigravity\\tailkall\\tmp\\py-1.faster-whisper.txt',
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
      engine: 'faster-whisper',
      pythonPath: 'D:\\Antigravity\\tailkall\\.venv\\Scripts\\python.exe',
      scriptPath: 'D:\\Antigravity\\tailkall\\scripts\\asr-faster-whisper.py',
      modelPath: 'D:\\Antigravity\\tailkall\\models\\faster-whisper\\small',
      tmpDir: 'D:\\Antigravity\\tailkall\\tmp',
      ffmpegPath: 'D:\\Antigravity\\tailkall\\models\\whisper\\ffmpeg.exe',
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
      file: 'D:\\Antigravity\\tailkall\\.venv\\Scripts\\python.exe',
      args: [
        'D:\\Antigravity\\tailkall\\scripts\\asr-faster-whisper.py',
        '--audio',
        'D:\\Antigravity\\tailkall\\tmp\\py-wav.wav',
        '--model',
        'D:\\Antigravity\\tailkall\\models\\faster-whisper\\small',
        '--out',
        'D:\\Antigravity\\tailkall\\tmp\\py-wav.faster-whisper.txt',
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
