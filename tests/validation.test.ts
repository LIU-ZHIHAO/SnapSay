import { describe, expect, it } from 'vitest';
import {
  isHighConflictTrigger,
  maskApiKey,
  sanitizeDigitInput,
  validateStoragePath
} from '../src/shared/validation';

describe('shared validation helpers', () => {
  it('flags plain letters and Enter as high-conflict triggers', () => {
    expect(isHighConflictTrigger({ type: 'keyboard', key: 'A', modifiers: [] })).toBe(true);
    expect(isHighConflictTrigger({ type: 'keyboard', key: 'Enter', modifiers: [] })).toBe(true);
  });

  it('allows F8 and middle mouse as low-conflict triggers', () => {
    expect(isHighConflictTrigger({ type: 'keyboard', key: 'F8', modifiers: [] })).toBe(false);
    expect(isHighConflictTrigger({ type: 'mouse', button: 'middle' })).toBe(false);
  });

  it('keeps only ASCII digits in numeric settings input', () => {
    expect(sanitizeDigitInput('a1 2三3-4.5６')).toBe('12345');
  });

  it('rejects C drive storage paths and accepts D drive storage paths', () => {
    expect(validateStoragePath('C:\\Users\\lzh\\AppData\\TailKall')).toEqual({
      valid: false,
      reason: 'Storage paths must not default to the C drive or user profile.'
    });
    expect(validateStoragePath('D:\\Antigravity\\SnapSay\\data')).toEqual({ valid: true });
  });

  it('masks API keys by exposing only the last four characters', () => {
    expect(maskApiKey('sk-test-1234567890')).toBe('**************7890');
  });
});
