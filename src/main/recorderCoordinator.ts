import type { AsrProvider } from './providers';
import type { SettingsStore, TranscriptionRecord } from './settingsStore';

export type RecordingPipelineOptions = {
  audio: ArrayBuffer;
  asrProvider: AsrProvider;
  applyWordbook?: (text: string) => string;
  cleanupText: (transcript: string) => Promise<string>;
  pasteText: (text: string) => Promise<unknown>;
  settingsStore: SettingsStore;
};

export async function runRecordingPipeline(
  options: RecordingPipelineOptions
): Promise<TranscriptionRecord> {
  let transcript = '';
  let cleanedText: string | undefined;

  try {
    const asr = await options.asrProvider.transcribe(options.audio);
    transcript = options.applyWordbook ? options.applyWordbook(asr.text) : asr.text;

    cleanedText = await options.cleanupText(transcript);
    await options.pasteText(cleanedText);

    return options.settingsStore.addRecord({
      transcript,
      cleanedText,
      status: 'completed',
      asrProvider: asr.provider,
      asrModel: options.asrProvider.name,
      cleanupProvider: 'api',
      cleanupModel: options.settingsStore.getSettings().cleanup.provider?.model,
      durationMs: 0,
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
      durationMs: 0,
      pasteSucceeded: false
    });
  }
}
