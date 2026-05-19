export type WordbookEntry = {
  id: string;
  target: string;
  variants: string[];
};

export type TranscriptionRecordForLearning = {
  id: string;
  transcript: string;
  userCorrection?: string;
  createdAt: string;
};

export type LearnResult = {
  updatedWordbook: WordbookEntry[];
  learnedAt: string;
  added: number;
  updated: number;
};

export function applyWordbook(text: string, entries: WordbookEntry[]): string {
  let result = text;
  for (const entry of entries) {
    if (!entry.target || !entry.variants.length) {
      continue;
    }
    const escapedVariants = entry.variants
      .filter((v) => v.trim().length > 0)
      .map(escapeRegex);
    if (!escapedVariants.length) {
      continue;
    }
    // Sort longest first to avoid partial matches shadowing longer variants
    escapedVariants.sort((a, b) => b.length - a.length);
    const pattern = new RegExp(escapedVariants.join('|'), 'gi');
    result = result.replace(pattern, entry.target);
  }
  return result;
}

export function learnFromCorrections(
  records: TranscriptionRecordForLearning[],
  currentWordbook: WordbookEntry[],
  learnedAt?: string
): LearnResult {
  const cutoff = learnedAt ? new Date(learnedAt).getTime() : 0;
  const candidates = records.filter(
    (r) =>
      r.userCorrection &&
      r.userCorrection.trim() !== r.transcript.trim() &&
      new Date(r.createdAt).getTime() > cutoff
  );

  // Collect substitution pairs: wrong → correct
  const substitutionCounts = new Map<string, Map<string, number>>();

  for (const record of candidates) {
    const pairs = extractSubstitutions(record.transcript, record.userCorrection!);
    for (const [from, to] of pairs) {
      if (!substitutionCounts.has(to)) {
        substitutionCounts.set(to, new Map());
      }
      const fromMap = substitutionCounts.get(to)!;
      fromMap.set(from, (fromMap.get(from) ?? 0) + 1);
    }
  }

  const wordbook = currentWordbook.map((e) => ({ ...e, variants: [...e.variants] }));
  let added = 0;
  let updated = 0;

  for (const [target, fromMap] of substitutionCounts) {
    const existing = wordbook.find(
      (e) => e.target.toLowerCase() === target.toLowerCase()
    );
    if (existing) {
      let changed = false;
      for (const [from] of fromMap) {
        if (!existing.variants.some((v) => v.toLowerCase() === from.toLowerCase())) {
          existing.variants.push(from);
          changed = true;
        }
      }
      if (changed) {
        updated++;
      }
    } else {
      const variants = [...fromMap.keys()];
      wordbook.push({ id: generateId(), target, variants });
      added++;
    }
  }

  return { updatedWordbook: wordbook, learnedAt: new Date().toISOString(), added, updated };
}

function extractSubstitutions(original: string, corrected: string): Array<[string, string]> {
  // Tokenize: replace all punctuation/whitespace with space, split on space, filter short tokens
  const tokenize = (text: string): string[] =>
    text
      .replace(/[\s，。！？、；：""''（）【】《》.,!?;:()\[\]{}"'\n\r]+/g, ' ')
      .trim()
      .split(' ')
      .filter((t) => t.length >= 2);

  const origTokens = tokenize(original);
  const corrTokens = tokenize(corrected);

  // Word-level LCS to find matching tokens
  const lcs = computeLcs(origTokens, corrTokens);

  const pairs: Array<[string, string]> = [];
  let oi = 0;
  let ci = 0;
  let li = 0;

  while (oi < origTokens.length || ci < corrTokens.length) {
    const origWord = origTokens[oi];
    const corrWord = corrTokens[ci];
    const lcsWord = lcs[li];

    if (origWord && corrWord && lcsWord &&
        origWord.toLowerCase() === lcsWord.toLowerCase() &&
        corrWord.toLowerCase() === lcsWord.toLowerCase()) {
      // Both match LCS — skip
      oi++;
      ci++;
      li++;
    } else if (origWord && corrWord && !isStopToken(origWord) && !isStopToken(corrWord)) {
      // Both sides have non-stop words not in LCS — substitution
      pairs.push([origWord, corrWord]);
      oi++;
      ci++;
    } else if (origWord && (!corrWord || (lcsWord && corrWord.toLowerCase() === lcsWord.toLowerCase()))) {
      // Deletion in correction
      oi++;
    } else {
      // Insertion in correction
      ci++;
    }
  }

  return pairs;
}

function isStopToken(token: string): boolean {
  const stops = new Set(['的', '了', '是', '在', '和', '与', '或', '也', '都', '就', '但', '而', '这', '那', '有', '没', '不', '很', '我', '你', '他', '她', '它', '们', '个', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十']);
  return stops.has(token) || /^\d+$/.test(token);
}

function computeLcs(a: string[], b: string[]): string[] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1].toLowerCase() === b[j - 1].toLowerCase()) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const result: string[] = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1].toLowerCase() === b[j - 1].toLowerCase()) {
      result.unshift(a[i - 1]);
      i--;
      j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }
  return result;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function generateId(): string {
  return `wb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
