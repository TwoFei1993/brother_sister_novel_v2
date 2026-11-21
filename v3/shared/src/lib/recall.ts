/**
 * 远距记忆检索（向量记忆的稀疏替代，对比 ST Vector Storage/Data Bank）
 *
 * 场景：上下文预算裁掉的最旧章节（plan.dropped）里可能藏着远距离伏笔/设定，
 * 滚动摘要只有粗略概要。本模块用「字符二元组重合度」做零依赖的相关性检索：
 * 中文无需分词，bigram 对汉字文本的区分度足够；窗口按段落聚合到 ~500 字。
 *
 * 与 RAG 的关系：这是稀疏检索（词面匹配），语义改写（"令牌"vs" token"）召回弱于
 * 向量——但零模型依赖、确定性、可测试；作为 P2-1 的轻量形态先行，语义召回后续可加。
 */

const STOP_BIGRAMS = new Set([
  '的的', '了一', '是一', '了的', '的一', '是在', '一是', '他的', '她的',
  '一个', '这个', '那个', '什么', '没有', '不是', '就是', '也是',
  '但是', '可是', '要是', '也是', '还是', '于是', '终于', '竟然',
]);

/** 字符二元组集合（去空白；过滤常见虚词组合降噪声） */
export function bigrams(text: string): Set<string> {
  const clean = text.replace(/\s+/g, '');
  const set = new Set<string>();
  for (let i = 0; i + 2 <= clean.length; i++) {
    const g = clean.slice(i, i + 2);
    if (!STOP_BIGRAMS.has(g)) set.add(g);
  }
  return set;
}

/** 单窗口得分：与 query 的 bigram 交集数（越大越相关） */
export function scoreWindow(queryBigrams: Set<string>, window: string): number {
  const w = bigrams(window);
  let hit = 0;
  for (const g of w) if (queryBigrams.has(g)) hit += 1;
  return hit;
}

/** 按段落聚合切 ~windowSize 字的窗口（不截断段落） */
export function splitWindows(text: string, windowSize = 500): string[] {
  const paras = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const windows: string[] = [];
  let cur = '';
  for (const p of paras) {
    if (cur && (cur.length + p.length > windowSize)) {
      windows.push(cur);
      cur = p;
    } else {
      cur = cur ? `${cur}\n\n${p}` : p;
    }
  }
  if (cur) windows.push(cur);
  return windows;
}

export interface RecallPassage {
  text: string;
  score: number;
}

/** 命中阈值：实测无关语料对短指令的偶合通常 ≤2，相关窗口 ≥4（12 章真实语料校准） */
const MIN_SCORE = 3;

/**
 * 相关性检索：从语料中取与 query 最相关的 topK 窗口。
 * 低于 MIN_SCORE 视为噪声不注入（宁缺毋滥）。
 */
export function retrievePassages(query: string, corpus: string, topK = 3, windowSize = 500): RecallPassage[] {
  const q = bigrams(query);
  if (q.size === 0) return [];
  const scored: RecallPassage[] = [];
  for (const w of splitWindows(corpus, windowSize)) {
    const score = scoreWindow(q, w);
    if (score >= MIN_SCORE) scored.push({ text: w, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, topK);
}

/** 组装注入块（空语料/无命中 → 空串不注入） */
export function recallBlock(query: string, corpus: string): string {
  const hits = retrievePassages(query, corpus, 3, 500);
  if (hits.length === 0) return '';
  return (
    '【前文相关回忆（自动检索，供衔接参考——细节以此为准，不要复述）】\n' +
    hits.map((h) => h.text).join('\n───\n')
  );
}
