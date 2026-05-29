# ONNX Windows Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Windows installer from the ONNX branch that installs successfully into a temporary directory and runs local SenseVoice transcription without requiring customers to install Python or developer tools.

**Architecture:** Package the Electron app with a hidden ONNX ASR daemon executable generated from `scripts/asr-daemon-onnx.py`. Keep the large SenseVoice model outside the installer and add app-managed model status/download controls that write model, cache, logs, and runtime data under a non-C default directory.

**Tech Stack:** Electron, Vite, TypeScript, electron-builder, PyInstaller, Python ONNX daemon, onnxruntime-directml, DirectML GPU with CPU fallback.

---

### Task 1: Packaging Toolchain

**Files:**
- Modify: `D:\Antigravity\SnapSay-onnx-experiment\package.json`
- Create: `D:\Antigravity\SnapSay-onnx-experiment\scripts\build-onnx-daemon.ps1`
- Create: `D:\Antigravity\SnapSay-onnx-experiment\scripts\prepare-dist.ps1`
- Test: `D:\Antigravity\SnapSay-onnx-experiment\tests\onnx-distribution.test.ts`

- [ ] Add `electron-builder` and package scripts: `dist:onnx-daemon`, `dist:win`, and `dist:onnx`.
- [ ] Add an `electron-builder` config that creates NSIS and portable artifacts, includes `dist`, `dist-electron`, and extra resource `release/asr-daemon-onnx/asr-daemon-onnx.exe`.
- [ ] Add a PyInstaller script that builds `scripts/asr-daemon-onnx.py` into `release/asr-daemon-onnx/asr-daemon-onnx.exe`.
- [ ] Add tests that assert the package scripts, builder config, and daemon resource path exist.
- [ ] Run `npm test -- onnx-distribution` and `npm run build`.
- [ ] Commit with `feat: add onnx windows packaging pipeline`.

### Task 2: Runtime Paths And Packaged Daemon Launch

**Files:**
- Modify: `D:\Antigravity\SnapSay-onnx-experiment\src\main\main.ts`
- Modify: `D:\Antigravity\SnapSay-onnx-experiment\src\main\settingsStore.ts`
- Test: `D:\Antigravity\SnapSay-onnx-experiment\tests\onnx-distribution.test.ts`

- [ ] Resolve packaged data root to `D:\SoftInstall\SnapSay` by default, with `SNAPSAY_ROOT` override.
- [ ] Ensure packaged daemon starts from `process.resourcesPath\asr-daemon-onnx\asr-daemon-onnx.exe`.
- [ ] Pass `ASR_MODEL_PATH`, `ASR_PORT_FILE`, `ASR_ONNX_PROVIDER=auto`, `XDG_CACHE_HOME`, `PIP_CACHE_DIR`, `HF_HOME`, and `MODELSCOPE_CACHE` into the daemon process.
- [ ] Preserve dev behavior for `npm run electron:onnx`.
- [ ] Run focused tests and commit with `fix: use distributable paths for onnx runtime`.

### Task 3: Model Status And Download Controls

**Files:**
- Create: `D:\Antigravity\SnapSay-onnx-experiment\src\main\localModelManager.ts`
- Modify: `D:\Antigravity\SnapSay-onnx-experiment\src\main\main.ts`
- Modify: `D:\Antigravity\SnapSay-onnx-experiment\src\main\preload.ts`
- Modify: `D:\Antigravity\SnapSay-onnx-experiment\src\renderer\App.tsx`
- Modify: `D:\Antigravity\SnapSay-onnx-experiment\src\renderer\ModelsView.tsx`
- Test: `D:\Antigravity\SnapSay-onnx-experiment\tests\localModelManager.test.ts`
- Test: `D:\Antigravity\SnapSay-onnx-experiment\tests\app-render.test.tsx`

- [ ] Add model status checks for `model.onnx`, `tokens.json`, and `am.mvn`.
- [ ] Add IPC APIs `snapsay:get-local-model-status`, `snapsay:download-local-model`, and `snapsay:open-local-model-dir`.
- [ ] Add Models page controls: status, download/preparing button, retry, and open directory.
- [ ] Download from a China-friendly source first and keep all cache/download temp files under `D:\SoftInstall\SnapSay` or `SNAPSAY_ROOT`.
- [ ] Run focused model manager and renderer tests.
- [ ] Commit with `feat: add local onnx model download controls`.

### Task 4: GPU Runtime Fallback Hardening

**Files:**
- Modify: `D:\Antigravity\SnapSay-onnx-experiment\scripts\asr-daemon-onnx.py`
- Test: `D:\Antigravity\SnapSay-onnx-experiment\tests\onnx-experiment.test.ts`

- [ ] If DirectML session starts but inference fails, retry the same request once with a CPU session.
- [ ] Return execution provider status in daemon logs so packaged builds can distinguish GPU and CPU.
- [ ] Keep DirectML as default when available.
- [ ] Run ONNX tests and a local daemon smoke test.
- [ ] Commit with `fix: fallback to cpu after onnx runtime inference failure`.

### Task 5: Build, Install, And Verify

**Files:**
- Modify as required by failures found during packaging or installation.

- [ ] Run `npm run dist:onnx`.
- [ ] Install the generated NSIS installer into a temporary non-C directory such as `D:\SoftInstall\SnapSayInstallTest`.
- [ ] Launch the installed app.
- [ ] Verify the app does not require system Python and does not write model/cache/log/data files under C drive user directories.
- [ ] Verify the model status/download UI appears.
- [ ] If a model is present or downloadable, verify one short recording transcribes successfully.
- [ ] Commit any final fixes with focused messages.
