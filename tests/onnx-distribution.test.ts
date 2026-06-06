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

    expect(packageJson.scripts?.['patch:nsis-install-dir']).toContain('patch-nsis-install-dir.ps1');
    expect(packageJson.scripts?.['dist:onnx-daemon']).toContain('build-onnx-daemon.ps1');
    expect(packageJson.scripts?.['dist:win']).toContain('patch:nsis-install-dir');
    expect(packageJson.scripts?.['dist:win']).toContain('electron-builder');
    expect(packageJson.scripts?.['dist:onnx']).toContain('prepare-dist.ps1');
    expect(packageJson.devDependencies?.['electron-builder']).toBeTruthy();
  });

  it('packages the ONNX daemon executable as an Electron extra resource', () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      build?: {
        extraResources?: Array<{ from?: string; to?: string; filter?: string[] }>;
        npmRebuild?: boolean;
        nsis?: Record<string, unknown>;
        win?: Record<string, unknown>;
      };
    };

    expect(packageJson.build?.extraResources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: 'release/asr-daemon-onnx',
          to: 'asr-daemon-onnx',
          filter: ['**/*']
        })
      ])
    );
    expect(packageJson.build?.nsis?.allowToChangeInstallationDirectory).toBe(true);
    expect(packageJson.build?.npmRebuild).toBe(false);
    expect(JSON.stringify(packageJson.build?.win)).toContain('portable');
  });

  it('preserves packaged runtime data before replacing an old install', () => {
    const installerInclude = readFileSync(join(process.cwd(), 'build', 'installer.nsh'), 'utf8');
    const patchScript = readFileSync(join(process.cwd(), 'scripts', 'patch-nsis-install-dir.ps1'), 'utf8');

    expect(installerInclude).toContain('!macro customBeforeUninstallOldVersion');
    expect(installerInclude).toContain('!insertmacro moveRuntimeDir "data"');
    expect(installerInclude).toContain('!insertmacro moveRuntimeDir "models"');
    expect(installerInclude).toContain('!insertmacro moveRuntimeDir "logs"');
    expect(installerInclude).toContain('!insertmacro moveRuntimeDir "cache"');
    expect(installerInclude).toContain('!insertmacro moveRuntimeDir "tmp"');
    expect(patchScript).toContain('installSection.nsh');
    expect(patchScript).toContain('customBeforeUninstallOldVersion');
    expect(patchScript).toContain('Restored NSIS assisted installer directory behavior.');
    expect(patchScript).toContain('Removed NSIS install section directory guard.');
  });

  it('uses ONNX and install-relative runtime paths in packaged builds', () => {
    const mainSource = readFileSync(join(process.cwd(), 'src', 'main', 'main.ts'), 'utf8');
    const settingsSource = readFileSync(join(process.cwd(), 'src', 'main', 'settingsStore.ts'), 'utf8');

    expect(mainSource).toContain('const INSTALL_ROOT = app.isPackaged ? dirname(process.execPath) : APP_ROOT');
    expect(mainSource).toContain('join(dirname(INSTALL_ROOT), `${basename(INSTALL_ROOT)}Data`)');
    expect(mainSource).toContain('migrateInstallLocalRuntimeData');
    expect(mainSource).toContain('process.env.SNAPSAY_ROOT = RUNTIME_ROOT');
    expect(mainSource).toContain("return process.env.SNAPSAY_ASR_ENGINE !== 'sensevoice-funasr'");
    expect(mainSource).toContain("join(process.resourcesPath, 'asr-daemon-onnx', 'asr-daemon-onnx.exe')");
    expect(mainSource).toContain('SNAPSAY_ROOT: RUNTIME_ROOT');
    expect(mainSource).toContain('MODELSCOPE_CACHE');
    expect(mainSource).toContain('PIP_CACHE_DIR');
    expect(settingsSource).toContain('join(dirname(installRoot), `${basename(installRoot)}Data`)');
    expect(settingsSource).not.toContain("'D:\\\\SoftInstall\\\\SnapSay'");
  });

  it('exposes local model status and download IPC for the packaged ONNX flow', () => {
    const mainSource = readFileSync(join(process.cwd(), 'src', 'main', 'main.ts'), 'utf8');
    const preloadSource = readFileSync(join(process.cwd(), 'src', 'main', 'preload.ts'), 'utf8');
    const modelManagerSource = readFileSync(join(process.cwd(), 'src', 'main', 'localModelManager.ts'), 'utf8');
    const modelsViewSource = readFileSync(join(process.cwd(), 'src', 'renderer', 'ModelsView.tsx'), 'utf8');

    expect(mainSource).toContain('snapsay:get-local-model-status');
    expect(mainSource).toContain('snapsay:download-local-model');
    expect(mainSource).toContain('currentStatus.installed');
    expect(mainSource).toContain('模型已就绪，无需下载');
    expect(mainSource).toContain('snapsay:open-local-model-dir');
    expect(mainSource).toContain('snapsay:get-local-asr-notice');
    expect(mainSource).toContain('snapsay:clear-local-asr-notice');
    expect(mainSource).toContain('pendingLocalAsrNotice');
    expect(mainSource).toContain('SenseVoice ONNX model is not installed');
    expect(mainSource).toContain('本地语音模型未安装');
    expect(mainSource).toContain('点击「下载模型」后再录音');
    expect(mainSource).toContain('warmupLocalAsr');
    expect(mainSource).toContain('localAsrReadiness');
    expect(mainSource).toContain('snapsay:local-asr-required');
    expect(mainSource).toContain('本地语音识别模型正在加载');
    expect(preloadSource).toContain('getLocalModelStatus');
    expect(preloadSource).toContain('downloadLocalModel');
    expect(preloadSource).toContain('onLocalAsrRequired');
    expect(preloadSource).toContain('getLocalAsrNotice');
    expect(preloadSource).toContain('clearLocalAsrNotice');
    expect(modelManagerSource).toContain('https://www.modelscope.cn/models/iic/SenseVoiceSmall-onnx/resolve/master/model_quant.onnx');
    expect(modelManagerSource).toContain("targetName: 'model.onnx'");
    expect(modelsViewSource).toContain('下载模型');
    expect(modelsViewSource).toContain('检查模型');
    expect(modelsViewSource).toContain('localModelStatus?.installed');
    expect(modelsViewSource).toContain('打开目录');
  });

  it('builds the daemon exe with PyInstaller from the ONNX script', () => {
    const script = readFileSync(join(process.cwd(), 'scripts', 'build-onnx-daemon.ps1'), 'utf8');

    expect(script).toContain('asr-daemon-onnx.py');
    expect(script).toContain('PyInstaller');
    expect(script).toContain('--onedir');
    expect(script).not.toContain('--onefile');
    expect(script).toContain('onnxruntime-directml');
    expect(script).toContain('release');
    expect(script).toContain('asr-daemon-onnx.exe');
    expect(script).toContain('XDG_CACHE_HOME');
  });

  it('runs build, daemon packaging, and electron-builder in order', () => {
    const script = readFileSync(join(process.cwd(), 'scripts', 'prepare-dist.ps1'), 'utf8');

    expect(script).toContain('npm run build');
    expect(script).toContain('npm run dist:onnx-daemon');
    expect(script).toContain('npm run patch:nsis-install-dir');
    expect(script).toContain('electron-builder --win nsis portable');
  });
});
