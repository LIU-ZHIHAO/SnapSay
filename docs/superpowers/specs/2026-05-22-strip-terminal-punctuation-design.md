# Strip Terminal Punctuation Design

## Goal

SnapSay should remove trailing sentence punctuation from transcription text before it is pasted or saved, especially for short recordings that skip LLM cleanup.

## Behavior

- After ASR returns text and the wordbook is applied, remove any continuous trailing punctuation from the transcript.
- The removal targets sentence-ending punctuation only at the end of the whole transcript, including common Chinese and English marks such as `。`, `，`, `、`, `！`, `？`, `.`, `,`, `!`, `?`, `：`, `；`, `;`, and `:`.
- Do not remove punctuation inside the transcript.
- Do not add a settings switch; this is a built-in default behavior.
- LLM cleanup receives the sanitized transcript. If cleanup is skipped or fails, paste uses the sanitized transcript.
- Records store the sanitized transcript so the history matches what was pasted.

## Architecture

Add a focused helper near the transcription pipeline to strip terminal punctuation with a regular expression. `runRecordingPipeline` will apply it immediately after optional wordbook replacement and before `shouldCleanupText` is evaluated.

This keeps provider adapters unchanged and avoids duplicating cleanup logic across local ASR, cloud ASR, and future streaming ASR implementations.

## Testing

Add coordinator tests proving:

- A short transcript ending in punctuation skips LLM cleanup and pastes the punctuation-free text.
- Interior punctuation remains unchanged while only trailing punctuation is removed.

