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

  it('starts the ONNX daemon in dev mode only when requested by environment', () => {
    const mainSource = readFileSync(join(process.cwd(), 'src', 'main', 'main.ts'), 'utf8');

    expect(mainSource).toContain('SNAPSAY_ASR_ENGINE');
    expect(mainSource).toContain('sensevoice-onnx');
    expect(mainSource).toContain('asr-daemon-onnx.py');
  });
});
