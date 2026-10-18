/**
 * TXT 导出与书名智能提取（Task 32，交互移植旧站 OutlineConfirmDialog）。
 * suggestBookTitles 优先取大纲内的 AI 推荐书名段，缺失时按哥哥/妹妹名 + 世界名兜底生成。
 */

/** 文件名非法字符：Windows 保留符 + 控制字符（fromCharCode 运行时构造，源码保持纯可见字符） */
const ILLEGAL_FILENAME = new RegExp(
  `[\\\\/:*?"<>|${String.fromCharCode(0)}-${String.fromCharCode(31)}]`,
  'g',
);

/** 文件名安全化：替换非法字符，空白折叠，空值兜底 "export" */
export function sanitizeFilename(name: string): string {
  const safe = name.replace(ILLEGAL_FILENAME, '_').replace(/\s+/g, ' ').trim();
  return safe || 'export';
}

/** TXT 导出：书名 + 分章拼接 → Blob 触发下载 */
export function exportTxt(title: string, chapters: { title: string; content: string }[]): void {
  const parts: string[] = [];
  if (title) parts.push(title, '');
  for (const ch of chapters) {
    if (ch.title) parts.push(ch.title, '');
    parts.push(ch.content ?? '', '');
  }
  const blob = new Blob([parts.join('\n')], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${sanitizeFilename(title)}.txt`;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 从大纲"推荐书名"段落提取 AI 建议名（去列表序号与书名号） */
function extractAiTitles(outline: string): string[] {
  const section = outline.match(/(?:推荐书名|书名建议|书名推荐)[\s\S]*?\n([\s\S]*?)(?:\n##|\n\n\n|$)/);
  if (!section) return [];
  return section[1]
    .split('\n')
    .map((line) => line.replace(/^[\d.、．\-*）]+\s*/, '').replace(/[「」【】《》]/g, '').trim())
    .filter(Boolean)
    .slice(0, 3);
}

/** 兜底生成：哥哥/妹妹名 + 世界名拼装 3 个候选 */
function generateFallbackTitles(outline: string): string[] {
  const brotherMatch = outline.match(/哥哥.*?(?:名|叫|为|：)\s*[「【]?([^\s「」【】,，。]{2,4})/);
  const sisterMatch = outline.match(/妹妹.*?(?:名|叫|为|：)\s*[「【]?([^\s「」【】,，。]{2,4})/);
  const bName = brotherMatch?.[1] || '兄';
  const sName = sisterMatch?.[1] || '妹';
  const worldName = outline.match(/世界.*?[「【]([^」】]+)/)?.[1]?.slice(0, 4) ?? '';

  const names: string[] = [];
  if (worldName) names.push(`${worldName}：${bName}与${sName}`);
  names.push(`异界兄妹：${bName}与${sName}的冒险`);
  names.push(`${bName}${sName}传`);
  while (names.length < 3) names.push(`异界兄妹录·卷${names.length}`);
  return names.slice(0, 3);
}

/** 书名智能提取：AI 推荐段优先，缺失走正则兜底生成（空文本也有 3 个候选） */
export function suggestBookTitles(outline: string): string[] {
  const ai = extractAiTitles(outline);
  return ai.length > 0 ? ai : generateFallbackTitles(outline);
}
