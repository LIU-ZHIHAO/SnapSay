# SnapSay

SnapSay is a native macOS voice input app. It records from the microphone, transcribes speech with local SenseVoice ONNX or a configured cloud ASR provider, optionally rewrites the transcript with an OpenAI-compatible LLM, then copies or pastes the final text into the active app.

This macOS branch keeps the Swift host as the only desktop runtime. The React/Vite code under `src/renderer` is the settings and records UI embedded by the native app; the Electron main process and Electron packaging path have been removed from this branch.

## Interface

SnapSay includes four main views:

- Home: current shortcut, ASR model, cleanup model, style, usage statistics, and recent records.
- Models: local/cloud ASR profiles and OpenAI-compatible cleanup provider cards.
- Styles: editable cleanup prompt presets.
- Settings: appearance, keyboard and mouse triggers, output mode, data paths, record import/export, and diagnostic logs.

## Features

- Native macOS status-bar app and main window.
- Native global keyboard trigger handling.
- Movable native floating recording capsule.
- Native microphone recording through AVFoundation.
- Local SenseVoiceSmall ONNX ASR with CoreML/GPU-first execution when available and CPU fallback.
- Cloud ASR profile support when configured.
- OpenAI-compatible text cleanup providers.
- Clipboard and paste-to-cursor output.
- Local history, settings, styles, and wordbook data.

## Requirements

- macOS 13 or newer is recommended.
- Xcode Command Line Tools with Swift.
- Node.js 22 or newer.
- npm 10 or newer.
- Python 3.10 or newer for local ONNX ASR.

## Quick Start

Install JavaScript dependencies:

```bash
npm install
```

Install local ONNX ASR dependencies when you want local transcription:

```bash
npm run setup:onnx:macos
```

Build the native app:

```bash
npm run build
```

Output:

```text
release/native-macos/SnapSay.app
release/native-macos/SnapSay-macOS.zip
```

## Development

Start the renderer development server on the project-defined high port:

```bash
npm run dev
```

Run tests:

```bash
npm test
```

Run type checks:

```bash
npm run typecheck
```

Build only the Swift app package after the renderer bundle already exists:

```bash
npm run native:mac
```

## Local ASR

The native app uses `scripts/asr-daemon-onnx.py` and `scripts/setup-onnx-asr-macos.sh` for local transcription. The model page should only require a local model when the selected ASR profile is local. If the user selects a cloud ASR profile, missing local model files must not block startup or recording.

Runtime data, logs, caches, models, and temporary files should stay under the configured SnapSay data paths, not under system locations by default.

## Repository Layout

```text
native-macos/   Swift native macOS host, status bar app, permissions, recorder, paste, and capsule.
src/renderer/   React UI embedded by the native app.
src/shared/     Shared defaults, types, validation, and cleanup policy.
scripts/        Native macOS build plus ONNX ASR daemon/setup scripts.
tests/          Vitest coverage for renderer and shared logic.
docs/           Product specs and historical implementation notes.
mockups/        UI mockups used in documentation.
```

## Distribution

Give users the generated zip or app bundle from:

```text
release/native-macos/SnapSay-macOS.zip
release/native-macos/SnapSay.app
```

The product name is `SnapSay`. Do not add `Native` to user-facing app names, bundle names, menus, or install instructions.

## License

SnapSay is licensed under the PolyForm Noncommercial License 1.0.0.

Commercial use is prohibited unless you obtain a separate written commercial license from the copyright holder. See [LICENSE.md](LICENSE.md).
