// @vitest-environment node

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('ONNX Windows distribution packaging', () => {
  it('defines installer and daemon packaging scripts', () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
      build?: Record<string, unknown>;
      devDependencies?: Record<string, string>;
    };

    expect(packageJson.scripts?.['dist:onnx-daemon']).toContain('build-onnx-daemon.ps1');
    expect(packageJson.scripts?.['dist:win']).toContain('electron-builder');
    expect(packageJson.scripts?.['dist:onnx']).toContain('prepare-dist.ps1');
    expect(packageJson.devDependencies?.['electron-builder']).toBeTruthy();
  });

  it('packages the ONNX daemon executable as an Electron extra resource', () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      build?: {
        extraResources?: Array<{ from?: string; to?: string; filter?: string[] }>;
        nsis?: Record<string, unknown>;
        win?: Record<string, unknown>;
      };
    };

    expect(packageJson.build?.extraResources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: 'release/asr-daemon-onnx',
          to: 'asr-daemon-onnx',
          filter: ['asr-daemon-onnx.exe']
        })
      ])
    );
    expect(packageJson.build?.nsis?.allowToChangeInstallationDirectory).toBe(true);
    expect(JSON.stringify(packageJson.build?.win)).toContain('portable');
  });

  it('builds the daemon exe with PyInstaller from the ONNX script', () => {
    const script = readFileSync(join(process.cwd(), 'scripts', 'build-onnx-daemon.ps1'), 'utf8');

    expect(script).toContain('asr-daemon-onnx.py');
    expect(script).toContain('PyInstaller');
    expect(script).toContain('onnxruntime-directml');
    expect(script).toContain('release');
    expect(script).toContain('asr-daemon-onnx.exe');
    expect(script).toContain('XDG_CACHE_HOME');
  });

  it('runs build, daemon packaging, and electron-builder in order', () => {
    const script = readFileSync(join(process.cwd(), 'scripts', 'prepare-dist.ps1'), 'utf8');

    expect(script).toContain('npm run build');
    expect(script).toContain('npm run dist:onnx-daemon');
    expect(script).toContain('electron-builder --win nsis portable');
  });
});
