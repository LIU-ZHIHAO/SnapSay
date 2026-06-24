# SnapSay macOS

This folder contains the native macOS host for SnapSay.

Current scope:

- Native status-bar app.
- Global `Option + 2` hotkey.
- Click once to start recording, click again to stop.
- Native floating capsule shown across Spaces.
- Native microphone recording via `AVAudioRecorder`.
- Sends recorded WAV audio to the local ONNX ASR daemon through the configured SnapSay data directory.
- Copies recognized text to the pasteboard and sends native `Command + V` via CoreGraphics.
- Hosts the existing React settings and records UI in a native `WKWebView`.

Build:

```bash
bash scripts/build-native-macos.sh
```

Output:

```text
release/native-macos/SnapSay.app
```

Notes:

- This macOS branch uses the Swift host as the only desktop runtime.
- Keep user-facing names as `SnapSay`; do not reintroduce legacy suffixes.
- The first version reuses the Python ONNX daemon while model management and ASR inference continue moving into native macOS paths.
