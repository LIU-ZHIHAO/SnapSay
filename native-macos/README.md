# SnapSay macOS

This folder contains the native macOS host for the lightweight SnapSay voice input tool.

Current scope:

- Native status-bar app.
- Global `Option + 2` hotkey.
- Click once to start recording, click again to stop.
- Native floating capsule shown across Spaces.
- Native microphone recording via `AVAudioRecorder`.
- Sends recorded WAV audio to the existing local ONNX ASR daemon through `~/Library/Application Support/SnapSay/data/asr-daemon.port`.
- Copies recognized text to the pasteboard and sends native `Command + V` via CoreGraphics.

Build:

```bash
bash scripts/build-native-macos.sh
```

Output:

```text
release/native-macos/SnapSay.app
```

Notes:

- This is intentionally separate from the existing Electron app while the migration is in progress.
- The settings/records UI can later be hosted in a native `WKWebView` and backed by the existing React build.
- The first version reuses the existing Python ONNX daemon and runtime data to avoid moving model management and ASR inference at the same time.
