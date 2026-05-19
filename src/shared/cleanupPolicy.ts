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
