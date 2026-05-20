import type { AsrProvider } from './providers';
import type { SettingsStore, TranscriptionRecord } from './settingsStore';

export type RecordingPipelineOptions = {
  audio: ArrayBuffer;
  asrProvider: AsrProvider;
  durationMs: number;
  applyWordbook?: (text: string) => string;
  shouldCleanupText?: (transcript: string) => boolean;
  cleanupText: (transcript: string) => Promise<string>;
  pasteText: (text: string) => Promise<unknown>;
  settingsStore: SettingsStore;
};

export async function runRecordingPipeline(
  options: RecordingPipelineOptions
): Promise<TranscriptionRecord> {
  let transcript = '';
  let cleanedText: string | undefined;
  let asrDurationMs: number | undefined;
  let cleanupDurationMs: number | undefined;

  try {
    const asrStart = Date.now();
    const asr = await options.asrProvider.transcribe(options.audio);
    asrDurationMs = Date.now() - asrStart;
    console.log(`[ASR] Transcribe completed. Cost: ${asrDurationMs}ms, Audio physical duration: ${options.durationMs}ms`);
    transcript = options.applyWordbook ? options.applyWordbook(asr.text) : asr.text;

    const shouldCleanup = options.shouldCleanupText?.(transcript) ?? true;
    if (shouldCleanup) {
      const cleanupStart = Date.now();
      cleanedText = await options.cleanupText(transcript);
      cleanupDurationMs = Date.now() - cleanupStart;
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
      durationMs: options.durationMs,
      asrDurationMs,
      cleanupDurationMs,
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
