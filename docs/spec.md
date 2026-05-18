# TailKall Windows Voice Input Assistant SPEC

## 1. Product Positioning

TailKall is a Windows desktop voice input assistant. It is designed as an alternative to network-dependent and subscription-heavy voice typing tools. The first version focuses on fast voice capture, configurable keyboard or mouse triggers, local or cloud speech recognition, API-based text cleanup, reliable cursor insertion, and a visible in-app history fallback.

The app must be a normal Windows desktop application with a main window for configuration, history, and model settings. It can also expose a tray entry, but it must not be tray-only.

## 2. MVP Scope

The first version includes:

- Global trigger configuration for keyboard shortcuts, single keyboard keys, mouse middle button, and mouse side buttons.
- Two recording modes: press-to-toggle and hold-to-record.
- A floating recording indicator fixed at the lower center of the screen.
- Local speech recognition and cloud speech recognition provider support.
- API-only text cleanup providers. Local LLM cleanup is excluded from MVP because of latency.
- Automatic paste into the current cursor position.
- Voice input history with raw transcript, cleaned text, status, model metadata, and copy actions.
- Settings pages for ASR providers, text cleanup API providers, prompts, shortcuts, storage paths, and behavior.

## 3. Trigger System

The trigger system must support:

- Keyboard combinations, such as `Ctrl + Alt + V`.
- Single keyboard keys, such as `F8`, `F9`, or `Pause`.
- Mouse middle button.
- Mouse side buttons, including Mouse4 and Mouse5.

The user can bind one primary trigger for voice input. Future versions may support multiple bindings.

If the user binds a high-conflict key such as letters, numbers, space, enter, escape, or common editing shortcuts, the UI must show a risk warning. The app may allow the binding after confirmation, but it must make the conflict visible.

## 4. Recording Modes

The app supports two recording modes:

- Toggle mode: press once to start recording, press again to stop recording and process.
- Hold mode: press and hold to record, release to stop recording and process.

The recording mode is configurable in settings. The floating indicator must appear immediately after recording starts.

## 5. Floating Recording Indicator

The floating recording indicator is a compact green pill displayed at the lower center of the screen.

States:

- Recording: shows `语音输入` and a real-time audio level animation.
- Recognizing: shows `识别中` with a subtle loading animation.
- Cleaning: shows `整理中` with a subtle loading animation.
- Inserted: briefly shows `已输入`, then hides.
- Saved only: briefly shows `已保存`, then hides.
- Failed: briefly shows `输入失败，已保存`, then hides.

The indicator must stay above normal windows while recording and processing. It should not steal focus from the active input target.

## 6. Speech Recognition

The first version supports two ASR categories:

- Local ASR: used for offline and privacy-friendly voice recognition.
- Cloud ASR: used for providers such as Doubao or other speech recognition APIs.

Recommended local ASR candidates:

- SenseVoice or FunASR for Chinese-first recognition.
- whisper.cpp or faster-whisper as a mature cross-platform fallback.

Provider configuration must not be hardcoded. The user must be able to configure provider type, endpoint or local model path, model name, and related options from the desktop app.

Large model files, caches, logs, audio recordings, temporary chunks, and runtime data must not default to the C drive user directory or system drive. Default storage should be under the project/app data directory on `D:\Antigravity`, `D:\SoftInstall`, a project-local directory, or a user-selected non-C drive path.

## 7. Text Cleanup

Text cleanup is API-only in MVP. Local LLM cleanup is excluded.

Supported cleanup options:

- No cleanup: paste the ASR transcript directly.
- API cleanup: send the transcript to a configured model provider such as DeepSeek or another OpenAI-compatible API.

The app must support provider settings:

- Provider preset.
- Display name.
- Base URL.
- API key.
- Model name.
- Test connection button.
- Prompt template editor.

API keys must never be hardcoded, committed, or logged in full. UI and logs may only show masked keys.

Prompt templates must be editable and stored as configuration, not embedded directly in feature code.

## 8. Input Pipeline

The normal processing flow is:

```text
Trigger detected
  -> Start recording
  -> Stop recording
  -> Run ASR
  -> Optional API cleanup
  -> Paste into current cursor position
  -> Save voice input record
```

Paste behavior:

- The first version should use clipboard insertion for maximum compatibility.
- The app writes the final text to the clipboard, simulates paste, and records whether insertion appears to succeed.
- The app should preserve and restore the previous clipboard when feasible, but correctness of the user-facing inserted text has priority.

If the cursor is lost, the target app blocks paste, permissions are insufficient, or insertion fails, the app must still save the record and expose copy actions in the main window.

## 9. Voice Input History

The main window includes a history list. Each record includes:

- Created time.
- Raw transcript.
- Cleaned text when available.
- ASR provider and model.
- Cleanup provider and model when used.
- Duration.
- Status: inserted, saved only, failed, or canceled.
- Failure reason when available.

Record actions:

- Copy raw transcript.
- Copy cleaned text.
- Re-clean with current API settings.
- Paste again into current cursor position.
- Delete record.

Long text in table or list cells must be collapsed by default, must not overflow the layout, and must reveal full content on hover. Editable fields should support inline editing when applicable.

## 10. Main Window Structure

The desktop app should include:

- Dashboard: quick status, selected ASR provider, selected cleanup provider, active trigger, and recent inputs.
- History: searchable voice input records with copy and retry actions.
- Settings: trigger binding, recording mode, floating indicator behavior, insertion behavior, providers, prompts, and storage paths.

The app should be usable as a normal desktop window and should also support minimizing to tray later.

## 11. Settings Requirements

Settings page sections:

- Trigger: keyboard/mouse binding capture, conflict warning, recording mode.
- ASR providers: local ASR and cloud ASR configuration.
- Cleanup API: OpenAI-compatible provider settings and connection test.
- Prompt templates: editable cleanup prompt.
- Output: direct paste, cleanup then paste, or save only.
- Storage: app data, logs, cache, model, and temporary audio paths.

Numeric settings must only accept manual digit input `0-9`. Browser or native spinner controls must be disabled in any numeric input UI.

## 12. Data and Storage Rules

Runtime data must not default to the C drive user directory or system drive. This includes:

- Logs.
- Databases.
- Audio recordings.
- Temporary audio chunks.
- Cache files.
- Model files.
- Download intermediates.

Only small configuration files that do not contain logs, databases, large caches, models, or media may follow OS configuration conventions. If the user chooses a directory explicitly, the app must respect that directory.

## 13. Error Handling

Required error states:

- Trigger conflict.
- Microphone unavailable.
- ASR provider unavailable.
- Local model missing.
- API provider unavailable.
- API key missing or invalid.
- Cleanup timeout.
- Clipboard or paste failure.
- Cursor target lost.

All failed voice input attempts should save a record when any transcript or final text is available.

## 14. Development Phases

Phase 1: Product shell and UI prototype.

- Main window.
- Settings pages.
- History list.
- Floating indicator.

Phase 2: Trigger and recording.

- Global keyboard binding.
- Mouse middle and side button binding.
- Toggle and hold modes.
- Microphone capture.

Phase 3: Recognition and cleanup.

- Local ASR integration.
- Cloud ASR provider interface.
- OpenAI-compatible cleanup provider interface.
- DeepSeek preset.
- Connection testing.

Phase 4: Insertion and history.

- Clipboard paste insertion.
- Failure fallback.
- Record persistence.
- Copy and retry actions.

Phase 5: Hardening.

- Provider timeouts.
- Storage path validation.
- Conflict warnings.
- Packaging.
- Manual Windows compatibility testing.

