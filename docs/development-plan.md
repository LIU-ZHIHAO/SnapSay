# SnapSay macOS Native Development Plan

This branch uses the Swift macOS host as the only desktop runtime.

## Runtime Architecture

- `native-macos/`: native status bar app, main window, hotkey handling, recording, paste, permissions, data storage, and floating capsule.
- `src/renderer/`: React settings and records UI embedded by the native app.
- `src/shared/`: shared TypeScript defaults, validation, and cleanup policy used by the renderer and tests.
- `scripts/asr-daemon-onnx.py`: local ONNX ASR daemon used by the native app.
- `scripts/setup-onnx-asr-macos.sh`: macOS local ASR environment setup.

## Product Rules

- User-facing product name is always `SnapSay`.
- Do not reintroduce Electron runtime, Electron builder config, Electron preload IPC, or Electron floating windows on this branch.
- Missing local model files should only block local ASR mode. Cloud ASR mode must remain usable after restart.
- Runtime data, logs, databases, caches, models, and temporary files must stay in configured SnapSay data paths.

## Build And Verify

```bash
npm run typecheck
npm test
npm run build
```

Native output:

```text
release/native-macos/SnapSay.app
release/native-macos/SnapSay-macOS.zip
```
