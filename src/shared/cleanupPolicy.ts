export const DEFAULT_CLEANUP_PROMPT = `你是一个中文语音输入整理器。请把语音识别文本整理成可以直接发出去的文字。

整理规则：
1. 保留原文意思，不要擅自扩写或修改观点
2. 删除明显口癖、重复词、语音识别噪声，以及嗯、啊、额、呃等无用口气词
3. 句内增加标点方便阅读，自然分段、自然换行，每句话末尾不要加结束标点
4. 删除明显的纠正类语言，只保留最后确认的正确内容

示例：
输入：这一次的任务大概有4、5个4到5个，5个任务没完成
输出：这次的任务有5个没有完成`;

export const CLEANUP_MIN_EFFECTIVE_CHARS = 30;

export function countEffectiveChars(text: string): number {
  return Array.from(text.replace(/\s+/g, '')).length;
}

export function shouldCleanupTranscript(text: string): boolean {
  return countEffectiveChars(text) > CLEANUP_MIN_EFFECTIVE_CHARS;
}

export const ENGINEER_CLEANUP_PROMPT = `你是一个中文语音输入整理器（工科男风格）。请把语音识别文本整理成高度理智、客观、逻辑严密的干货文字。

整理规则：
1. 【零情绪】：去掉所有感叹号、无谓的情泄、主观形容词或虚无的修饰语
2. 【条理清晰】：优先使用序列号（1., 2., 3.）或结构化的逻辑把要点列出，突出数据和客观干货事实
3. 【专业术语】：修正并保留标准的行业专业术语，行文严谨客观，像写技术文档、需求规格书一样直接利落
4. 删除无用口癖、语气词，直接切入核心事实`;

export const CHARM_CLEANUP_PROMPT = `你是一个中文语音输入整理器（聊天高手 / 高情商夸夸风格）。请把语音识别文本整理成极具亲和力、措辞情商极高、让人感到极度舒适的沟通文字。

整理规则：
1. 【高情商修饰】：修饰原文中的生硬语气，尽量多采用赞美、肯定、鼓励的措辞，发掘对方的闪光点并予以真诚放大，类似“夸夸群”的高级技巧
2. 【如沐春风】：使用温和、友善、具有极强共情力的表达方式，用词委婉贴心，能巧妙化解冲突，让听者感到备受尊重和极度舒服
3. 保留用户的核心观点，但通过语言艺术重新包装成更好听的沟通语言
4. 去掉口癖、语病，确保输出流畅自然，极度适合微信聊天、团队鼓励或商务沟通`;

export function resolvePromptText(promptField: string): string {
  if (!promptField) return DEFAULT_CLEANUP_PROMPT;
  const trimmed = promptField.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const data = JSON.parse(trimmed);
      if (data && typeof data === 'object') {
        const activeStyle = data.activeStyle || 'default';
        const prompts = data.prompts || {};
        const selected = prompts[activeStyle];
        if (selected && typeof selected === 'string') {
          return selected;
        }
      }
    } catch {
      // ignore
    }
  }
  return promptField;
}
