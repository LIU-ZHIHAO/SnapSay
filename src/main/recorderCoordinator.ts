import type { AsrProvider } from './providers';
import type { SettingsStore, TranscriptionRecord } from './settingsStore';

export type RecordingPipelineOptions = {
  audio: ArrayBuffer;
  asrProvider: AsrProvider;
  cleanupText: (transcript: string) => Promise<string>;
  pasteText: (text: string) => Promise<unknown>;
  settingsStore: SettingsStore;
};

export async function runRecordingPipeline(
  options: RecordingPipelineOptions
): Promise<TranscriptionRecord> {
  let transcript = '';

  try {
    const asr = await options.asrProvider.transcribe(options.audio);
    transcript = asr.text;

    const cleanedText = await options.cleanupText(transcript);
    await options.pasteText(cleanedText);

    return options.settingsStore.addRecord({
      transcript,
      cleanedText,
      status: 'completed'
    });
  } catch (error) {
    return options.settingsStore.addRecord({
      transcript,
      status: 'failed',
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
