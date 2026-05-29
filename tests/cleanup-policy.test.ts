import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CLEANUP_MIN_EFFECTIVE_CHARS,
  DEFAULT_CLEANUP_PROMPT,
  countEffectiveChars,
  shouldCleanupTranscript
} from '../src/shared/cleanupPolicy';

describe('cleanup policy', () => {
  it('skips short transcripts and only cleans text longer than the threshold', () => {
    expect(CLEANUP_MIN_EFFECTIVE_CHARS).toBe(30);
    expect(countEffectiveChars('打开 设置 页')).toBe(5);
    expect(shouldCleanupTranscript('打开设置页')).toBe(false);
    expect(shouldCleanupTranscript('我们要做一个逻辑判断，短文本不要调用大模型，长文本才需要整理整个内容')).toBe(true);
  });

  it('uses the Chinese voice cleanup prompt and keeps main cleanup calls bounded', () => {
    const mainSource = readFileSync(join(process.cwd(), 'src', 'main', 'main.ts'), 'utf8');

    expect(DEFAULT_CLEANUP_PROMPT).toContain('任务：精修语音转写文本，输出可直接发送的干净文字');
    expect(DEFAULT_CLEANUP_PROMPT).toContain('精准识别改口，直接删除被推翻的前文，无缝拼接最终确认内容');
    expect(DEFAULT_CLEANUP_PROMPT).toContain('严禁在句末加任何结束标点');
    expect(mainSource).toContain('shouldCleanupTranscript(transcript)');
    expect(mainSource).toContain('timeoutMs: 15_000');
  });
});
