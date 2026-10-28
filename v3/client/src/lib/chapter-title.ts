/**
 * 章节显示标题工具：AI 生成的 chapter.title 常自带「第N章」前缀，
 * 显示层再拼「第N章」会出现「第2章 第2章 ×××」重复——此处统一去重。
 */

const HAS_PREFIX = /^第\d+[章节]/;

/** 完整标题（章节卡/上架列表）：「第N章 标题」；title 已带前缀则原样 */
export function chapterTitle(index: number, title: string): string {
  const t = (title || '').trim();
  if (!t) return `第${index}章 未命名`;
  return HAS_PREFIX.test(t) ? t : `第${index}章 ${t}`;
}

/** 短标（章节 chips）：title 已带前缀时省略「N ·」 */
export function chapterChip(index: number, title: string): string {
  const t = (title || '').trim();
  if (!t) return `${index} · 未命名`;
  return HAS_PREFIX.test(t) ? t : `${index} · ${t}`;
}
