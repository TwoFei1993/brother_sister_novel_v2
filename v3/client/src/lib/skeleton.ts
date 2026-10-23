/**
 * 章节骨架注入（失忆兜底）：LLM 滚动摘要依赖一次额外模型调用，上游不稳（529 频发）
 * 时会失败——失败后被预算裁掉的旧章节在上下文中完全消失，续写「失忆」复写旧剧情。
 * 骨架块纯本地压缩（标题 + 首段），零模型依赖、永不失败，与摘要/回忆检索并存。
 */
import type { Message } from '@shared/message';

/** 单章首段截取上限（字符），控制 token 开销 */
const PER_CHAPTER_LIMIT = 100;
/** 携带完整骨架（标题+首段）的最大章数；更早的章节只保留标题行 */
const MAX_FULL_SKELETON = 20;

/** 单章骨架文本：书名号标题 + 首段截断（正文非字符串时仅标题） */
export function chapterSkeletonLine(m: Message, bodyLimit = PER_CHAPTER_LIMIT): string {
  const title = typeof m.chapter?.title === 'string' ? m.chapter.title.trim() : '';
  const prefix = title ? `《${title}》` : '';
  const body = typeof m.content === 'string' ? m.content.replace(/^#[^\n]*\n/, '') : '';
  const firstPara = body
    .split(/\n+/)
    .map((s) => s.trim())
    .find(Boolean) ?? '';
  if (!firstPara) return prefix;
  const head = firstPara.slice(0, bodyLimit);
  return `${prefix}${head}${firstPara.length > bodyLimit ? '…' : ''}`;
}

/** 组装骨架注入块：dropped 无章节消息返回空串（不注入） */
export function skeletonBlock(dropped: Message[]): string {
  const chapters = dropped.filter((m) => m.chapter && typeof m.content === 'string');
  if (chapters.length === 0) return '';
  const lines = chapters.map((m, i) => {
    const full = chapters.length - i <= MAX_FULL_SKELETON;
    const line = full ? chapterSkeletonLine(m) : (typeof m.chapter?.title === 'string' ? `《${m.chapter.title.trim()}》` : '');
    return `第${m.chapter!.index}章 ${line}`;
  });
  return (
    '【前文章节骨架（自动压缩，供把握全局脉络——写新章时不得复述/重演这些已有情节）】\n' +
    lines.join('\n')
  );
}
