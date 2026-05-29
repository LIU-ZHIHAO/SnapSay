// @vitest-environment node

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('SenseVoice ONNX experiment', () => {
  it('has an explicit ONNX Electron startup script', () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.['electron:onnx']).toContain('start-electron-onnx.ps1');
    expect(packageJson.scripts?.['setup:onnx']).toContain('setup-onnx-asr.ps1');
  });

  it('cleans stale experiment app processes before starting ONNX mode', () => {
    const script = readFileSync(join(process.cwd(), 'scripts', 'start-electron-onnx.ps1'), 'utf8');

    expect(script).toContain('Stop-ExistingExperimentProcesses');
    expect(script).toContain('asr-daemon-onnx.py');
    expect(script).toContain('node_modules\\electron');
    expect(script).toContain('$_.Name -eq "python.exe"');
    expect(script).not.toContain('electron:onnx*');
  });

  it('starts the ONNX daemon in dev mode only when requested by environment', () => {
    const mainSource = readFileSync(join(process.cwd(), 'src', 'main', 'main.ts'), 'utf8');

    expect(mainSource).toContain('SNAPSAY_ASR_ENGINE');
    expect(mainSource).toContain('sensevoice-onnx');
    expect(mainSource).toContain('asr-daemon-onnx.py');
    expect(mainSource).toContain("ASR_ONNX_PROVIDER: 'auto'");
  });

  it('does not fall back to the FunASR Python adapter in ONNX experiment mode', () => {
    const mainSource = readFileSync(join(process.cwd(), 'src', 'main', 'main.ts'), 'utf8');

    expect(mainSource).toContain('isOnnxExperimentMode()');
    expect(mainSource).toContain('await startAsrDaemon(startupSettings)');
    expect(mainSource).toContain('SenseVoice ONNX daemon is not ready');
  });

  it('prefers DirectML for ONNX and falls back to CPU', () => {
    const daemonSource = readFileSync(join(process.cwd(), 'scripts', 'asr-daemon-onnx.py'), 'utf8');
    const mainSource = readFileSync(join(process.cwd(), 'src', 'main', 'main.ts'), 'utf8');

    expect(daemonSource).toContain('DmlExecutionProvider');
    expect(daemonSource).toContain('CPUExecutionProvider');
    expect(daemonSource).toContain('get_available_providers');
    expect(daemonSource).toContain('Execution providers');
    expect(daemonSource).toContain('DirectML inference failed, retrying CPU');
    expect(daemonSource).toContain('ASR_TMP_DIR');
    expect(mainSource).toContain('sensevoice-onnx-daemon');
    expect(mainSource).toContain('ASR_TMP_DIR: TMP_DIR');
  });

  it('installs the DirectML ONNX Runtime package for the experiment venv', () => {
    const setupSource = readFileSync(join(process.cwd(), 'scripts', 'setup-onnx-asr.ps1'), 'utf8');

    expect(setupSource).toContain('onnxruntime-directml');
    expect(setupSource).toContain('PIP_CACHE_DIR');
    expect(setupSource).toContain('get_available_providers');
  });
});
