import type { TranscriptionRecord } from './settingsStore.js';

export type WordbookEntry = {
  id: string;
  /** 正确的目标词，如 "codex" 或 "爆款逻辑" */
  target: string;
  /**
   * ASR 可能识别出的错误形式，如 ["codexx", "code x"]。
   * 为空时将由 generateVariants 自动推断（英文词）或仅依赖 LLM 纠错（中文词）。
   */
  variants: string[];
};

// ─── 应用词库替换（后处理，速度快，所有 ASR 引擎均有效） ──────────────────

/**
 * 对 ASR 输出文本执行词库后处理替换。
 * - 英文词：词边界感知，大小写不敏感，保留目标词原始大小写
 * - 中文词：精确字符串替换
 * - 变体为空时：跳过后处理替换，依靠 LLM 纠错
 */
export function applyWordbook(text: string, entries: WordbookEntry[]): string {
  let result = text;
  for (const entry of entries) {
    if (!entry.target) continue;

    // 收集所有变体（用户手填 + 自动推断）
    const allVariants = collectVariants(entry);
    if (!allVariants.length) continue;

    // 按长度降序排列，避免短变体遮蔽长变体
    allVariants.sort((a, b) => b.length - a.length);

    const isEnglishTarget = /^[A-Za-z0-9\s\-_.]+$/.test(entry.target);

    for (const variant of allVariants) {
      const escapedVariant = escapeRegex(variant);
      let pattern: RegExp;

      if (isEnglishTarget && /^[A-Za-z0-9\s\-_.]+$/.test(variant)) {
        // 英文变体：词边界感知，大小写不敏感
        pattern = new RegExp(`(?<![A-Za-z0-9])${escapedVariant}(?![A-Za-z0-9])`, 'gi');
      } else {
        // 中文或混合变体：精确匹配
        pattern = new RegExp(escapedVariant, 'g');
      }

      result = result.replace(pattern, entry.target);
    }
  }
  return result;
}

/**
 * 收集一个词条的所有有效变体（用户手填 + 自动推断）。
 * 不包含目标词本身（避免循环替换）。
 */
function collectVariants(entry: WordbookEntry): string[] {
  const manual = entry.variants.filter((v) => v.trim().length > 0 && v.toLowerCase() !== entry.target.toLowerCase());
  const isEnglishTarget = /^[A-Za-z][A-Za-z0-9\-_.]*$/.test(entry.target);

  if (isEnglishTarget) {
    const auto = generateEnglishVariants(entry.target).filter(
      (v) => !manual.some((m) => m.toLowerCase() === v.toLowerCase())
    );
    return [...manual, ...auto];
  }

  return manual;
}

// ─── 英文词自动变体推断 ───────────────────────────────────────────────────────

/**
 * 为英文词自动生成 ASR 常见错误形式。
 * 例如 "codex" → ["codexx", "code x", "codeks", "codecs", "codec"]
 */
export function generateEnglishVariants(word: string): string[] {
  const lower = word.toLowerCase();
  const variants = new Set<string>();

  // 1. 末尾字母重复（最常见的拼写错误）
  if (lower.length > 0) {
    const lastChar = lower[lower.length - 1];
    variants.add(lower + lastChar); // codex → codexx
  }

  // 2. 拆分驼峰/复合词（每个大写字母前加空格）
  const spaced = word.replace(/([A-Z])/g, ' $1').toLowerCase().trim();
  if (spaced !== lower) variants.add(spaced); // napSay → nap say

  // 3. 在常见位置插入空格（词中切分）
  for (let i = 1; i < lower.length - 1; i++) {
    const split = `${lower.slice(0, i)} ${lower.slice(i)}`;
    if (split.trim() !== lower) variants.add(split); // codex → code x, cod ex, ...
  }

  // 4. 末尾常见替换（x → ks, cs, cx, s）
  if (lower.endsWith('x')) {
    variants.add(lower.slice(0, -1) + 'ks'); // codex → codeks
    variants.add(lower.slice(0, -1) + 'cs'); // codex → codecs
    variants.add(lower.slice(0, -1) + 's');  // codex → codes
  }
  if (lower.endsWith('ex')) {
    variants.add(lower.slice(0, -2) + 'ec');   // codex → codec
    variants.add(lower.slice(0, -2) + 'eck');  // codex → codeck
  }

  // 5. 末尾常见替换（ks/cs → x）的反向
  if (lower.endsWith('ks')) {
    variants.add(lower.slice(0, -2) + 'x'); // index → indexx... rare but covers
  }

  // 6. 常见混淆字母对（ph↔f, c↔k, z↔s）
  variants.add(lower.replace(/ph/g, 'f').replace(/f/g, 'ph'));
  if (lower !== lower.replace(/c/g, 'k')) variants.add(lower.replace(/c/g, 'k'));
  if (lower !== lower.replace(/k/g, 'c')) variants.add(lower.replace(/k/g, 'c'));

  // 7. 连字符变体
  if (lower.length > 4) {
    for (let i = 2; i < lower.length - 2; i++) {
      variants.add(`${lower.slice(0, i)}-${lower.slice(i)}`);
    }
  }

  // 过滤掉与原词相同的条目和过短的变体
  variants.delete(lower);
  variants.delete(word.toLowerCase());
  return [...variants].filter((v) => v.length >= 2);
}

// ─── LLM Prompt 注入 ──────────────────────────────────────────────────────────

/**
 * 将词库编译成追加到 LLM cleanup prompt 末尾的说明块。
 * 当词库非空时，LLM 会根据词库对同音/近音词进行语义纠错。
 *
 * 示例输出：
 * ```
 * 专有名词词库（请确保以下词汇使用正确的书写形式）：
 * - codex（可能被识别为：codexx, code x）
 * - 爆款逻辑（可能被识别为：报款逻辑, 暴款逻辑）
 * - napSay（仅此名称，注意大小写）
 * ```
 */
export function buildWordbookPrompt(entries: WordbookEntry[]): string {
  const nonEmpty = entries.filter((e) => e.target.trim().length > 0);
  if (!nonEmpty.length) return '';

  const lines = nonEmpty.map((entry) => {
    const isEnglish = /^[A-Za-z0-9\s\-_.]+$/.test(entry.target);
    const allVariants = collectVariants(entry);
    // LLM prompt 里只展示用户手填的变体（自动推断的太多，会增大噪声）
    const displayVariants = entry.variants.filter((v) => v.trim().length > 0 && v.toLowerCase() !== entry.target.toLowerCase());

    if (displayVariants.length > 0) {
      return `- ${entry.target}（可能被识别为：${displayVariants.join('、')}）`;
    } else if (isEnglish) {
      return `- ${entry.target}（英文专有名词，注意拼写）`;
    } else {
      return `- ${entry.target}`;
    }
  });

  return `\n\n专有名词词库（这些是用户的专有词汇，请确保在输出中使用正确的书写形式，若发现同音字或近似拼写请替换为正确写法）：\n${lines.join('\n')}`;
}

// ─── 纠错记录中提取候选词对（用于"一键添加到词库"功能） ─────────────────────

export type WordPairCandidate = {
  from: string; // ASR 识别的错误形式
  to: string;   // 用户修正的正确形式
};

/**
 * 从原始 ASR 文本和用户修正文本中提取候选词对。
 * 仅提取单词粒度的替换（不提取添加/删除）。
 */
export function extractWordPairCandidates(
  original: string,
  corrected: string
): WordPairCandidate[] {
  const tokenize = (text: string): string[] =>
    text
      .replace(/[\s，。！？、；：""''（）【】《》.,!?;:()\[\]{}"'\n\r]+/g, ' ')
      .trim()
      .split(' ')
      .filter((t) => t.length >= 2);

  const origTokens = tokenize(original);
  const corrTokens = tokenize(corrected);

  const lcs = computeLcs(origTokens, corrTokens);

  const pairs: WordPairCandidate[] = [];
  let oi = 0;
  let ci = 0;
  let li = 0;

  while (oi < origTokens.length || ci < corrTokens.length) {
    const origWord = origTokens[oi];
    const corrWord = corrTokens[ci];
    const lcsWord = lcs[li];

    if (
      origWord && corrWord && lcsWord &&
      origWord.toLowerCase() === lcsWord.toLowerCase() &&
      corrWord.toLowerCase() === lcsWord.toLowerCase()
    ) {
      oi++; ci++; li++;
    } else if (origWord && corrWord && origWord.toLowerCase() !== corrWord.toLowerCase()) {
      // 词级别替换
      pairs.push({ from: origWord, to: corrWord });
      oi++; ci++;
    } else if (origWord && (!corrWord || (lcsWord && corrWord.toLowerCase() === lcsWord.toLowerCase()))) {
      oi++;
    } else {
      ci++;
    }
  }

  // 过滤掉明显是停用词的替换
  return pairs.filter(
    (p) => !isStopToken(p.from) && !isStopToken(p.to) && p.from !== p.to
  );
}

function isStopToken(token: string): boolean {
  const stops = new Set([
    '的', '了', '是', '在', '和', '与', '或', '也', '都', '就', '但', '而',
    '这', '那', '有', '没', '不', '很', '我', '你', '他', '她', '它', '们',
    '个', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'
  ]);
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
      i--; j--;
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

export function generateId(): string {
  return `wb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}



