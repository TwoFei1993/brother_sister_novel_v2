/**
 * 截断检测（feedback：续写没写完就停止）
 *
 * 上游按 max_tokens 截断（推理模型思考吃预算的典型形态）时，正文会在
 * 句中戛然而止。启发式判定：取正文最后一段（剔除标题行），若
 *  1) 不含任何句末标点（。！？…"」』等），且
 *  2) 长度 ≥ 30 字（排除极短尾行误判）
 * 则视为截断。
 */
const ENDING_PUNCT = /[。！？…」』"’】\n]\s*$/;

/** 正文是否疑似被截断（结尾无句末标点的连续叙述 ≥30 字）；非字符串内容一律 false */
export function isTruncatedText(content: string): boolean {
  if (typeof content !== 'string') return false;
  const text = content.replace(/^#[^\n]*\n/, '').trim(); // 去首行标题
  if (text.length < 30) return false;
  if (ENDING_PUNCT.test(text)) return false;
  const tail = text.slice(-80);
  // 尾部 80 字内完全没有句末/段末停顿 → 高概率截断
  return !/[。！？…」』"\n]/.test(tail);
}
