import type { AsrProvider, CleanupResult } from './providers';
import type { SettingsStore, TranscriptionRecord } from './settingsStore';

const TERMINAL_PUNCTUATION_RE = /[。．，、！？!?.,：:；;]+$/u;

export type RecordingPipelineOptions = {
  audio: ArrayBuffer;
  asrProvider: AsrProvider;
  durationMs: number;
  applyWordbook?: (text: string) => string;
  shouldCleanupText?: (transcript: string) => boolean;
  cleanupText: (transcript: string) => Promise<CleanupResult>;
  pasteText: (text: string) => Promise<unknown>;
  settingsStore: SettingsStore;
};

export function stripTerminalPunctuation(text: string): string {
  return text.replace(TERMINAL_PUNCTUATION_RE, '');
}

export async function runRecordingPipeline(
  options: RecordingPipelineOptions
): Promise<TranscriptionRecord> {
  let transcript = '';
  let cleanedText: string | undefined;
  let cleanupError: string | undefined;
  let asrDurationMs: number | undefined;
  let cleanupDurationMs: number | undefined;
  let totalTokens: number | undefined;

  try {
    const asrStart = Date.now();
    const asr = await options.asrProvider.transcribe(options.audio);
    asrDurationMs = Date.now() - asrStart;
    console.log(`[ASR] Transcribe completed. Cost: ${asrDurationMs}ms, Audio physical duration: ${options.durationMs}ms`);
    const rawTranscript = options.applyWordbook ? options.applyWordbook(asr.text) : asr.text;
    transcript = stripTerminalPunctuation(rawTranscript);

    const shouldCleanup = options.shouldCleanupText?.(transcript) ?? true;
    if (shouldCleanup) {
      const cleanupStart = Date.now();
      try {
        const result = await options.cleanupText(transcript);
        cleanedText = result.text;
        totalTokens = result.totalTokens;
      } catch (error) {
        cleanupError = error instanceof Error ? error.message : String(error);
      } finally {
        cleanupDurationMs = Date.now() - cleanupStart;
      }
    }

    await options.pasteText(cleanedText ?? transcript);

    return options.settingsStore.addRecord({
      transcript,
      cleanedText,
      status: 'completed',
      asrProvider: asr.provider,
      asrModel: options.asrProvider.name,
      cleanupProvider: cleanedText ? 'api' : undefined,
      cleanupModel: cleanedText ? options.settingsStore.getSettings().cleanup.provider?.model : undefined,
      error: cleanupError,
      durationMs: options.durationMs,
      asrDurationMs,
      cleanupDurationMs,
      totalTokens,
      pasteSucceeded: true
    });
  } catch (error) {
    return options.settingsStore.addRecord({
      transcript,
      cleanedText,
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
      asrProvider: options.asrProvider.name,
      asrModel: options.asrProvider.name,
      cleanupProvider: options.settingsStore.getSettings().cleanup.provider?.name,
      cleanupModel: options.settingsStore.getSettings().cleanup.provider?.model,
      durationMs: options.durationMs,
      asrDurationMs,
      cleanupDurationMs,
      pasteSucceeded: false
    });
  }
}
