import { describe, expect, it } from 'vitest';
import { DEFAULT_APP_SETTINGS, DEFAULT_STORAGE_PATHS, PROJECT_ROOT } from '../src/shared/defaults';

describe('shared defaults', () => {
  it('keeps runtime data directories under the SnapSay project root for the current platform', () => {
    const separator = process.platform === 'win32' ? '\\' : '/';
    const expectedRoot = process.platform === 'win32'
      ? 'D:\\Antigravity\\SnapSay'
      : process.env.SNAPSAY_ROOT || process.cwd();

    expect(PROJECT_ROOT).toBe(expectedRoot);
    expect(DEFAULT_STORAGE_PATHS).toEqual({
      dataDir: `${expectedRoot}${separator}data`,
      logsDir: `${expectedRoot}${separator}logs`,
      cacheDir: `${expectedRoot}${separator}cache`,
      modelsDir: `${expectedRoot}${separator}models`,
      tmpDir: `${expectedRoot}${separator}tmp`
    });

    for (const path of Object.values(DEFAULT_STORAGE_PATHS)) {
      expect(path.startsWith('C:\\')).toBe(false);
      expect(path.startsWith(`${expectedRoot}${separator}`)).toBe(true);
    }
  });

  it('builds app settings from safe defaults', () => {
    expect(DEFAULT_APP_SETTINGS.paths).toEqual(DEFAULT_STORAGE_PATHS);
    expect(DEFAULT_APP_SETTINGS.trigger).toEqual({ type: 'keyboard', key: 'F8', modifiers: [] });
    expect(DEFAULT_APP_SETTINGS.recordingMode).toBe('pressToTalk');
    expect(DEFAULT_APP_SETTINGS.outputMode).toBe('paste');
  });
});
