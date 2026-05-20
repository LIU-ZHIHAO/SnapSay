import { describe, expect, it } from 'vitest';
import {
  applyWordbook,
  generateEnglishVariants,
  buildWordbookPrompt,
  extractWordPairCandidates,
  generateId,
  WordbookEntry
} from '../src/main/wordbook';

describe('Wordbook Logic', () => {
  describe('applyWordbook', () => {
    it('applies English words with word boundary awareness (case-insensitive, preserving target case)', () => {
      const entries: WordbookEntry[] = [
        {
          id: '1',
          target: 'codex',
          variants: ['codexx', 'code x', 'codes']
        }
      ];

      // Exact match variant
      expect(applyWordbook('I used codexx yesterday.', entries)).toBe('I used codex yesterday.');
      
      // Case insensitive match
      expect(applyWordbook('I used Code X yesterday.', entries)).toBe('I used codex yesterday.');

      // Should NOT replace when it's a substring of another word (e.g. codexxify)
      expect(applyWordbook('I am using codexxify.', entries)).toBe('I am using codexxify.');

      // Should NOT replace when it's a substring at the start (e.g. precodexx)
      expect(applyWordbook('I am using precodexx.', entries)).toBe('I am using precodexx.');
    });

    it('applies Chinese words with exact string replacement', () => {
      const entries: WordbookEntry[] = [
        {
          id: '2',
          target: '爆款逻辑',
          variants: ['报款逻辑', '暴款逻辑']
        }
      ];

      expect(applyWordbook('这个是我们的报款逻辑。', entries)).toBe('这个是我们的爆款逻辑。');
      expect(applyWordbook('那个是暴款逻辑。', entries)).toBe('那个是爆款逻辑。');
    });

    it('sorts variants by length in descending order to avoid short variants overshadowing long variants', () => {
      const entries: WordbookEntry[] = [
        {
          id: '3',
          target: 'deep learning',
          variants: ['deep learn', 'deep learning ASR']
        }
      ];

      // If 'deep learn' replaced first, 'deep learning ASR' would become 'deep learning ASR' -> 'deep learning ASR' wait.
      // If we have 'deep learning ASR', it should be replaced entirely to 'deep learning'.
      expect(applyWordbook('using deep learning ASR now', entries)).toBe('using deep learning now');
    });
  });

  describe('generateEnglishVariants', () => {
    it('generates expected variations for standard English words', () => {
      const word = 'codex';
      const variants = generateEnglishVariants(word);

      // Suffix doubling: codexx
      expect(variants).toContain('codexx');
      // Splitting: code x
      expect(variants).toContain('code x');
      // Trailing replacement (x -> ks, cs, s):
      expect(variants).toContain('codeks');
      expect(variants).toContain('codecs');
      expect(variants).toContain('codes');
    });

    it('generates camelCase space splits', () => {
      const word = 'napSay';
      const variants = generateEnglishVariants(word);
      expect(variants).toContain('nap say');
    });
  });

  describe('buildWordbookPrompt', () => {
    it('returns empty string if entries are empty or target is blank', () => {
      expect(buildWordbookPrompt([])).toBe('');
      expect(buildWordbookPrompt([{ id: '1', target: ' ', variants: [] }])).toBe('');
    });

    it('builds clear prompt text for LLM injection with variants & special targets', () => {
      const entries: WordbookEntry[] = [
        {
          id: '1',
          target: 'codex',
          variants: ['codexx', 'code x']
        },
        {
          id: '2',
          target: '爆款逻辑',
          variants: ['报款逻辑']
        },
        {
          id: '3',
          target: 'napSay',
          variants: []
        }
      ];

      const prompt = buildWordbookPrompt(entries);
      expect(prompt).toContain('专有名词词库');
      expect(prompt).toContain('- codex（可能被识别为：codexx、code x）');
      expect(prompt).toContain('- 爆款逻辑（可能被识别为：报款逻辑）');
      expect(prompt).toContain('- napSay（英文专有名词，注意拼写）');
    });
  });

  describe('extractWordPairCandidates', () => {
    it('extracts word differences between ASR and corrected text', () => {
      const original = '今天我用了一下 code x 进行开发。';
      const corrected = '今天我用了一下 codex 进行开发。';
      const candidates = extractWordPairCandidates(original, corrected);

      // Should extract 'code' -> 'codex' or 'x' -> 'codex' (depending on LCS token diff)
      expect(candidates.length).toBeGreaterThan(0);
      expect(candidates.some(c => c.to === 'codex')).toBe(true);
    });

    it('extracts simple Chinese word replacement pairs', () => {
      const original = '我们要把这个报款逻辑做好。';
      const corrected = '我们要把这个爆款逻辑做好。';
      const candidates = extractWordPairCandidates(original, corrected);

      expect(candidates).toEqual([
        { from: '报款逻辑', to: '爆款逻辑' }
      ]);
    });

    it('filters out common stopwords and digits', () => {
      const original = '我的 他的 三个 123 报款逻辑';
      const corrected = '你的 她的 四个 456 爆款逻辑';
      const candidates = extractWordPairCandidates(original, corrected);

      // Stopwords like '我的', '你的', '三个', '123' etc. should be filtered
      expect(candidates).toEqual([
        { from: '报款逻辑', to: '爆款逻辑' }
      ]);
    });
  });

  describe('generateId', () => {
    it('generates unique ids starting with wb_', () => {
      const id1 = generateId();
      const id2 = generateId();
      expect(id1.startsWith('wb_')).toBe(true);
      expect(id1).not.toBe(id2);
    });
  });
});
