// @vitest-environment node

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('local ASR readiness guard', () => {
  it('blocks local SenseVoice recording when the model path is missing and opens the model page', () => {
    const mainSource = readFileSync(join(process.cwd(), 'src', 'main', 'main.ts'), 'utf8');
    const preloadSource = readFileSync(join(process.cwd(), 'src', 'main', 'preload.ts'), 'utf8');
    const appSource = readFileSync(join(process.cwd(), 'src', 'renderer', 'App.tsx'), 'utf8');

    expect(mainSource).toContain('localAsrReadiness(settings)');
    expect(mainSource).toContain('本地语音模型目录不存在');
    expect(mainSource).toContain('snapsay:local-asr-required');
    expect(mainSource).toContain('pendingLocalAsrNotice');
    expect(mainSource).toContain('snapsay:get-local-asr-notice');
    expect(mainSource).toContain('snapsay:clear-local-asr-notice');
    expect(mainSource).toContain('void warmupLocalAsr(startupSettings)');
    expect(preloadSource).toContain('onLocalAsrRequired');
    expect(preloadSource).toContain('getLocalAsrNotice');
    expect(preloadSource).toContain('clearLocalAsrNotice');
    expect(appSource).toContain("setView('models')");
    expect(appSource).toContain('需要配置语音模型');
  });
});
