import { execFile } from 'node:child_process';
import { access, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { createConnection, type Socket } from 'node:net';
import { promisify } from 'node:util';
import type { CleanupProviderConfig, CloudAsrProviderConfig } from './settingsStore';

export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1';
const execFileAsync = promisify(execFile);

export type ChatRole = 'system' | 'user' | 'assistant';

export type ChatCompletionPayload = {
  model: string;
  messages: Array<{
    role: ChatRole;
    content: string;
  }>;
  temperature: number;
};

export type FetchLike = (
  input: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string | Uint8Array;
    signal?: AbortSignal;
  }
) => Promise<{
  ok: boolean;
  status: number;
  json?: () => Promise<unknown>;
  text?: () => Promise<string>;
}>;

export type AsrResult = {
  text: string;
  provider: string;
};

export type AsrProvider = {
  name: string;
  transcribe(audio: ArrayBuffer): Promise<AsrResult>;
};

export function buildChatCompletionPayload(options: {
  model: string;
  transcript: string;
  prompt?: string;
  temperature?: number;
}): ChatCompletionPayload {
  return {
    model: options.model,
    messages: [
      {
        role: 'system',
        content:
          options.prompt ??
          'Clean up this voice transcript. Preserve meaning and return only the cleaned text.'
      },
      {
        role: 'user',
        content: options.transcript
      }
    ],
    temperature: options.temperature ?? 0.2
  };
}

export async function cleanupText(options: {
  provider: CleanupProviderConfig;
  transcript: string;
  prompt?: string;
  fetch: FetchLike;
  timeoutMs?: number;
}): Promise<string> {
  const provider = normalizeProvider(options.provider);
  const response = await options.fetch(`${provider.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${provider.apiKey}`
    },
    body: JSON.stringify(
      buildChatCompletionPayload({
        model: provider.model,
        transcript: options.transcript,
        prompt: options.prompt
      })
    ),
    signal: createTimeoutSignal(options.timeoutMs)
  });

  if (!response.ok) {
    const body = response.text ? await response.text() : '';
    throw new Error(
      sanitizeProviderError(
        `Cleanup provider ${provider.name} failed with HTTP ${response.status}: ${body}`,
        provider.apiKey
      )
    );
  }

  const json = response.json ? await response.json() : undefined;
  const content = readAssistantContent(json);
  if (!content) {
    throw new Error(`Cleanup provider ${provider.name} returned no text`);
  }
  return content;
}

export async function testCleanupProvider(options: {
  provider: CleanupProviderConfig;
  fetch: FetchLike;
  timeoutMs?: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await cleanupText({
      provider: options.provider,
      transcript: 'ping',
      prompt: 'Reply with ok.',
      fetch: options.fetch,
      timeoutMs: options.timeoutMs ?? 5000
    });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export function maskApiKey(apiKey: string): string {
  if (!apiKey) {
    return '';
  }
  if (apiKey.length <= 4) {
    return '***';
  }
  const prefix = apiKey.startsWith('sk-') ? 'sk-' : '';
  return `${prefix}***${apiKey.slice(-4)}`;
}

export function createMockAsrProvider(text = ''): AsrProvider {
  return {
    name: 'mock',
    async transcribe(): Promise<AsrResult> {
      return {
        text,
        provider: 'mock'
      };
    }
  };
}

export function createPlaceholderLocalAsrProvider(options?: {
  modelPath?: string;
}): AsrProvider {
  return {
    name: 'local-placeholder',
    async transcribe(): Promise<AsrResult> {
      const suffix = options?.modelPath ? ` Model path: ${options.modelPath}` : '';
      throw new Error(`Local ASR provider is not implemented yet.${suffix}`);
    }
  };
}

export type WhisperCppProviderOptions = {
  executablePath: string;
  modelPath: string;
  tmpDir: string;
  ffmpegPath?: string;
  language?: string;
  acceleration?: 'auto-gpu' | 'cpu';
  prompt?: string;
  idFactory?: () => string;
  writeFile?: (path: string, data: Buffer) => Promise<void>;
  readTextFile?: (path: string) => Promise<string>;
  fileExists?: (path: string) => Promise<boolean>;
  runCommand?: (file: string, args: string[]) => Promise<void>;
};

export type PythonAsrProviderOptions = {
  engine: 'faster-whisper' | 'sensevoice-funasr';
  pythonPath: string;
  scriptPath: string;
  modelPath: string;
  tmpDir: string;
  ffmpegPath?: string;
  acceleration?: 'auto-gpu' | 'cpu';
  language?: string;
  prompt?: string;
  idFactory?: () => string;
  writeFile?: (path: string, data: Buffer) => Promise<void>;
  readTextFile?: (path: string) => Promise<string>;
  fileExists?: (path: string) => Promise<boolean>;
  runCommand?: (file: string, args: string[]) => Promise<void>;
};

export function createWhisperCppAsrProvider(options: WhisperCppProviderOptions): AsrProvider {
  return {
    name: `whisper.cpp ${basename(options.modelPath)}`,
    async transcribe(audio: ArrayBuffer): Promise<AsrResult> {
      await assertFileExists(options.executablePath, options.fileExists, 'whisper.cpp 可执行文件不存在');
      await assertFileExists(options.modelPath, options.fileExists, 'whisper.cpp 模型文件不存在');

      const id = options.idFactory?.() ?? `voice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const inputPath = join(options.tmpDir, `${id}.webm`);
      const wavPath = join(options.tmpDir, `${id}.wav`);
      const outputBase = join(options.tmpDir, id);
      const outputTextPath = `${outputBase}.txt`;
      const writer = options.writeFile ?? writeFile;
      const reader = options.readTextFile ?? ((path: string) => readFile(path, 'utf8'));
      const runner = options.runCommand ?? runExecFile;

      await writer(inputPath, Buffer.from(audio));

      const audioPath = options.ffmpegPath ? wavPath : inputPath;
      if (options.ffmpegPath) {
        await assertFileExists(options.ffmpegPath, options.fileExists, 'ffmpeg.exe 不存在，无法转换浏览器录音格式');
        await runner(options.ffmpegPath, ['-y', '-i', inputPath, wavPath]);
      }

      await runner(options.executablePath, [
        ...(options.prompt ? ['--prompt', options.prompt] : []),
        '-m',
        options.modelPath,
        '-f',
        audioPath,
        '-l',
        options.language ?? 'zh',
        ...(options.acceleration === 'cpu' ? ['-ng'] : []),
        '-otxt',
        '-of',
        outputBase
      ]);

      const text = (await reader(outputTextPath)).trim();
      if (!text) {
        throw new Error('本地 whisper.cpp 没有返回识别文本');
      }
      return { text, provider: 'whisper.cpp' };
    }
  };
}

export function createPythonAsrProvider(options: PythonAsrProviderOptions): AsrProvider {
  return {
    name: `${options.engine} ${basename(options.modelPath)}`,
    async transcribe(audio: ArrayBuffer): Promise<AsrResult> {
      await assertFileExists(options.pythonPath, options.fileExists, 'Python 运行时不存在');
      await assertFileExists(options.scriptPath, options.fileExists, 'ASR runner 脚本不存在');
      await assertFileExists(options.modelPath, options.fileExists, 'ASR 模型目录不存在');

      const id = options.idFactory?.() ?? `voice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const inputPath = join(options.tmpDir, `${id}.webm`);
      const wavPath = join(options.tmpDir, `${id}.wav`);
      const outputTextPath = join(options.tmpDir, `${id}.${options.engine}.txt`);
      const writer = options.writeFile ?? writeFile;
      const reader = options.readTextFile ?? ((path: string) => readFile(path, 'utf8'));
      const runner = options.runCommand ?? runExecFile;

      await writer(inputPath, Buffer.from(audio));

      const audioPath = options.ffmpegPath ? wavPath : inputPath;
      if (options.ffmpegPath) {
        await assertFileExists(options.ffmpegPath, options.fileExists, 'ffmpeg.exe 不存在，无法转换浏览器录音格式');
        await runner(options.ffmpegPath, ['-y', '-i', inputPath, wavPath]);
      }

      await runner(options.pythonPath, [
        options.scriptPath,
        '--audio',
        audioPath,
        '--model',
        options.modelPath,
        '--out',
        outputTextPath,
        '--device',
        options.acceleration === 'cpu' ? 'cpu' : 'auto',
        '--language',
        options.language ?? 'zh',
        ...(options.engine === 'faster-whisper' && options.prompt ? ['--prompt', options.prompt] : [])
      ]);

      const text = (await reader(outputTextPath)).trim();
      if (!text) {
        throw new Error(`${options.engine} 没有返回识别文本`);
      }
      return { text, provider: options.engine };
    }
  };
}

export type CloudAsrProviderOptions = {
  provider: CloudAsrProviderConfig;
  fetch: FetchLike;
  language?: string;
  timeoutMs?: number;
};

export function createCloudAsrProvider(options: CloudAsrProviderOptions): AsrProvider {
  const p = options.provider;
  const baseUrl = p.baseUrl.replace(/\/+$/, '');
  return {
    name: `cloud-asr ${p.model}`,
    async transcribe(audio: ArrayBuffer): Promise<AsrResult> {
      const boundary = `----TailKall${Date.now().toString(36)}`;
      const audioBuf = Buffer.from(audio);
      const parts: Uint8Array[] = [];

      // file field
      parts.push(strToBuf(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="audio.webm"\r\n` +
        `Content-Type: audio/webm\r\n\r\n`
      ));
      parts.push(audioBuf);
      parts.push(strToBuf('\r\n'));

      // model field
      parts.push(strToBuf(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="model"\r\n\r\n` +
        `${p.model}\r\n`
      ));

      // language field
      parts.push(strToBuf(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="language"\r\n\r\n` +
        `${options.language ?? 'zh'}\r\n`
      ));

      // closing boundary
      parts.push(strToBuf(`--${boundary}--\r\n`));

      const body = concatBuffers(parts);

      const url = `${baseUrl}/v1/audio/transcriptions`;
      const response = await options.fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          Authorization: `Bearer ${p.apiKey}`
        },
        body,
        signal: createTimeoutSignal(options.timeoutMs)
      });

      if (!response.ok) {
        const errBody = response.text ? await response.text() : '';
        throw new Error(
          sanitizeProviderError(
            `Cloud ASR ${p.model} failed with HTTP ${response.status}: ${errBody}`,
            p.apiKey
          )
        );
      }

      const json = response.json ? await response.json() : undefined;
      const text = json && typeof json === 'object' && 'text' in json
        ? String((json as { text: unknown }).text)
        : '';
      if (!text) {
        throw new Error(`Cloud ASR ${p.model} returned no text`);
      }
      return { text, provider: `cloud-asr ${p.model}` };
    }
  };
}

function strToBuf(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function concatBuffers(buffers: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const buf of buffers) total += buf.length;
  const result = new Uint8Array(total);
  let offset = 0;
  for (const buf of buffers) {
    result.set(buf, offset);
    offset += buf.length;
  }
  return result;
}

async function runExecFile(file: string, args: string[]): Promise<void> {
  await execFileAsync(file, args, { windowsHide: true });
}

async function assertFileExists(
  path: string,
  fileExists: WhisperCppProviderOptions['fileExists'],
  label: string
): Promise<void> {
  const exists = fileExists
    ? await fileExists(path)
    : await access(path)
        .then(() => true)
        .catch(() => false);
  if (!exists) {
    throw new Error(`${label}: ${path}`);
  }
}

function normalizeProvider(provider: CleanupProviderConfig): Required<CleanupProviderConfig> {
  return {
    ...provider,
    baseUrl: trimTrailingSlash(provider.baseUrl || DEEPSEEK_BASE_URL)
  };
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function createTimeoutSignal(timeoutMs?: number): AbortSignal | undefined {
  if (!timeoutMs || typeof AbortController === 'undefined') {
    return undefined;
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs).unref?.();
  return controller.signal;
}

function readAssistantContent(json: unknown): string | undefined {
  if (!json || typeof json !== 'object' || !('choices' in json)) {
    return undefined;
  }
  const choices = (json as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) {
    return undefined;
  }
  const first = choices[0] as { message?: { content?: unknown } } | undefined;
  return typeof first?.message?.content === 'string' ? first.message.content : undefined;
}

function sanitizeProviderError(message: string, apiKey: string): string {
  return message.split(apiKey).join(maskApiKey(apiKey));
}

export type AsrDaemonClient = {
  transcribe(audio: ArrayBuffer): Promise<AsrResult>;
  close(): void;
};

export function createAsrDaemonProvider(port: number): AsrProvider {
  let socket: Socket | undefined;

  function getSocket(): Promise<Socket> {
    if (socket && !socket.destroyed) {
      return Promise.resolve(socket);
    }
    return new Promise((resolve, reject) => {
      const s = createConnection({ host: '127.0.0.1', port }, () => resolve(s));
      s.on('error', reject);
      socket = s;
    });
  }

  return {
    name: 'sensevoice-daemon',
    async transcribe(audio: ArrayBuffer): Promise<AsrResult> {
      const s = await getSocket();
      const buf = Buffer.from(audio);
      const header = Buffer.allocUnsafe(4);
      header.writeUInt32BE(buf.length, 0);
      s.write(header);
      s.write(buf);

      const text = await new Promise<string>((resolve, reject) => {
        let acc = '';
        const onData = (chunk: Buffer) => {
          acc += chunk.toString('utf-8');
          const nl = acc.indexOf('\n');
          if (nl === -1) return;
          s.off('data', onData);
          s.off('error', onError);
          try {
            const parsed = JSON.parse(acc.slice(0, nl)) as { text?: string; error?: string };
            if (parsed.error) reject(new Error(parsed.error));
            else resolve(parsed.text ?? '');
          } catch (e) {
            reject(e);
          }
        };
        const onError = (err: Error) => {
          s.off('data', onData);
          socket = undefined;
          reject(err);
        };
        s.on('data', onData);
        s.on('error', onError);
      });

      return { text, provider: 'sensevoice-daemon' };
    }
  };
}
