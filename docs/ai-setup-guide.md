# SnapSay AI Setup Guide

Use this guide when asking another AI coding tool to set up or repair SnapSay on a Windows machine.

## Goal

Set up SnapSay so it can run on Windows with:

- Electron desktop app.
- React/Vite renderer.
- SQLite history storage.
- Optional local SenseVoice ASR.
- Optional OpenAI-compatible cleanup API.

SnapSay is licensed under PolyForm Noncommercial License 1.0.0. Do not use it for commercial purposes unless the copyright holder grants a separate written commercial license.

## Non-Negotiable Project Rules

- Do not put logs, databases, model files, caches, temporary audio, or downloaded assets in the Windows user profile or system drive by default.
- Use project-local directories:
  - `data\`
  - `logs\`
  - `cache\`
  - `models\`
  - `tmp\`
- Do not commit runtime data, model files, API keys, cache files, build output, or local tool config.
- Do not use default dev ports such as `5173`, `80`, or `8080`. The project uses `14231`.
- For local ASR, prefer GPU when available and keep CPU fallback.

## Expected Tools

- Windows 10 or 11.
- Git.
- Node.js 22+.
- npm 10+.
- Python 3.10 if local ASR is needed.
- FFmpeg in `PATH` if local ASR smoke tests or non-WAV fallback are needed.
- Optional NVIDIA GPU with CUDA for faster SenseVoice.

## Setup Steps

From PowerShell:

```powershell
git clone https://github.com/LIU-ZHIHAO/SnapSay.git D:\Antigravity\SnapSay
cd D:\Antigravity\SnapSay
npm install
npm run build
```

Run the app:

```powershell
npm run electron
```

One-command setup:

```powershell
.\scripts\setup-windows.ps1
```

With local ASR:

```powershell
.\scripts\setup-windows.ps1 -WithLocalAsr
```

## Local ASR Setup

Run:

```powershell
.\scripts\setup-python-asr.ps1
```

This script must:

- Create `.venv\` inside the repository.
- Use `cache\pip` for pip cache.
- Use `cache\huggingface`, `cache\modelscope`, and `cache\torch`.
- Download SenseVoiceSmall to `models\sensevoice\SenseVoiceSmall`.
- Install `huggingface_hub`, `modelscope`, `funasr`, `av`, CUDA-enabled `torch`, and `torchaudio`.

Smoke test:

```powershell
.\scripts\test-local-asr.ps1
```

## Native Module Handling

SnapSay uses `better-sqlite3`. It must match Electron's Node ABI.

After npm install or Electron upgrades, run:

```powershell
npm run rebuild:native
```

If rebuild fails because the `.node` file is locked, stop all Electron/SnapSay processes and retry.

If rebuild falls back to compiling from source, install Visual Studio Build Tools with the C++ desktop workload.

## Verification

Run:

```powershell
npm test
npm run build
```

Expected:

- Vitest passes.
- TypeScript checks pass.
- Vite build succeeds.
- Electron main process compiles.

Optional smoke launch:

```powershell
npm run electron
```

## Runtime Files

These paths are expected and should stay ignored by git:

```text
data\snapsay-settings.json
data\snapsay.db
data\snapsay.db-shm
data\snapsay.db-wal
data\asr-daemon.port
logs\
cache\
models\
tmp\
.venv\
node_modules\
dist\
dist-electron\
```

## Common Repairs

### Electron starts but SQLite native module fails

```powershell
Get-Process electron -ErrorAction SilentlyContinue | Stop-Process -Force
npm run rebuild:native
```

### Local ASR is slow

Check whether the daemon started:

```powershell
Test-Path .\data\asr-daemon.port
```

If false:

```powershell
.\scripts\setup-python-asr.ps1
npm run electron
```

### Missing `av`

```powershell
$env:PIP_CACHE_DIR = "$PWD\cache\pip"
.\.venv\Scripts\python.exe -m pip install av
```

Prefer rerunning `scripts\setup-python-asr.ps1` so the full ASR environment is consistent.

## Suggested AI Prompt

```text
You are setting up SnapSay on Windows. Follow README.md and docs/ai-setup-guide.md. Keep all runtime data, logs, models, caches, and temp files inside the repository. Do not write model/cache/runtime files to C:\Users or the system drive. Install npm dependencies, rebuild better-sqlite3 for Electron, optionally install local SenseVoice ASR with scripts/setup-python-asr.ps1, then verify with npm test and npm run build. If a native module is locked, stop Electron processes and retry. If local ASR is slow, confirm data/asr-daemon.port exists and reinstall missing Python dependencies.
```
