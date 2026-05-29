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

  it('uses ONNX and non-C runtime paths by default in packaged builds', () => {
    const mainSource = readFileSync(join(process.cwd(), 'src', 'main', 'main.ts'), 'utf8');
    const settingsSource = readFileSync(join(process.cwd(), 'src', 'main', 'settingsStore.ts'), 'utf8');

    expect(mainSource).toContain("app.isPackaged ? 'D:\\\\SoftInstall\\\\SnapSay' : APP_ROOT");
    expect(mainSource).toContain('return app.isPackaged || process.env.SNAPSAY_ASR_ENGINE');
    expect(mainSource).toContain("join(process.resourcesPath, 'asr-daemon-onnx', 'asr-daemon-onnx.exe')");
    expect(mainSource).toContain('SNAPSAY_ROOT: RUNTIME_ROOT');
    expect(mainSource).toContain('MODELSCOPE_CACHE');
    expect(mainSource).toContain('PIP_CACHE_DIR');
    expect(settingsSource).toContain("'D:\\\\SoftInstall\\\\SnapSay'");
  });

  it('exposes local model status and download IPC for the packaged ONNX flow', () => {
    const mainSource = readFileSync(join(process.cwd(), 'src', 'main', 'main.ts'), 'utf8');
    const preloadSource = readFileSync(join(process.cwd(), 'src', 'main', 'preload.ts'), 'utf8');
    const modelManagerSource = readFileSync(join(process.cwd(), 'src', 'main', 'localModelManager.ts'), 'utf8');
    const modelsViewSource = readFileSync(join(process.cwd(), 'src', 'renderer', 'ModelsView.tsx'), 'utf8');

    expect(mainSource).toContain('snapsay:get-local-model-status');
    expect(mainSource).toContain('snapsay:download-local-model');
    expect(mainSource).toContain('snapsay:open-local-model-dir');
    expect(preloadSource).toContain('getLocalModelStatus');
    expect(preloadSource).toContain('downloadLocalModel');
    expect(modelManagerSource).toContain('https://www.modelscope.cn/models/iic/SenseVoiceSmall-onnx/resolve/master/model_quant.onnx');
    expect(modelManagerSource).toContain("targetName: 'model.onnx'");
    expect(modelsViewSource).toContain('下载模型');
    expect(modelsViewSource).toContain('打开目录');
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
