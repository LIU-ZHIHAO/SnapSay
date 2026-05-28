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
  });

  it('does not fall back to the FunASR Python adapter in ONNX experiment mode', () => {
    const mainSource = readFileSync(join(process.cwd(), 'src', 'main', 'main.ts'), 'utf8');

    expect(mainSource).toContain('isOnnxExperimentMode()');
    expect(mainSource).toContain('await startAsrDaemon(startupSettings)');
    expect(mainSource).toContain('SenseVoice ONNX daemon is not ready');
  });
});
