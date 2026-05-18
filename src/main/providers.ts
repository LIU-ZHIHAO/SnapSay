import type { CleanupProviderConfig } from './settingsStore';

export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1';

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
    body: string;
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
