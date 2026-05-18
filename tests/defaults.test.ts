import { describe, expect, it } from 'vitest';
import { DEFAULT_APP_SETTINGS, DEFAULT_STORAGE_PATHS, PROJECT_ROOT } from '../src/shared/defaults';

describe('shared defaults', () => {
  it('keeps runtime data directories under the TailKall project on D drive', () => {
    expect(PROJECT_ROOT).toBe('D:\\Antigravity\\tailkall');
    expect(DEFAULT_STORAGE_PATHS).toEqual({
      dataDir: 'D:\\Antigravity\\tailkall\\data',
      logsDir: 'D:\\Antigravity\\tailkall\\logs',
      cacheDir: 'D:\\Antigravity\\tailkall\\cache',
      modelsDir: 'D:\\Antigravity\\tailkall\\models',
      tmpDir: 'D:\\Antigravity\\tailkall\\tmp'
    });

    for (const path of Object.values(DEFAULT_STORAGE_PATHS)) {
      expect(path.startsWith('C:\\')).toBe(false);
      expect(path.startsWith('D:\\Antigravity\\tailkall\\')).toBe(true);
    }
  });

  it('builds app settings from safe defaults', () => {
    expect(DEFAULT_APP_SETTINGS.paths).toEqual(DEFAULT_STORAGE_PATHS);
    expect(DEFAULT_APP_SETTINGS.trigger).toEqual({ type: 'keyboard', key: 'F8', modifiers: [] });
    expect(DEFAULT_APP_SETTINGS.recordingMode).toBe('pressToTalk');
    expect(DEFAULT_APP_SETTINGS.outputMode).toBe('paste');
  });
});
