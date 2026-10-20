/**
 * 生成崩溃检测（深度测试实测发现：MiniMax-M3 长上下文连写第 6 章起出现重复循环）
 *
 * 形态：单个短语机械重复数百上千次（「刀——刀」×1331、「银的那一头」×1307），
 * 正文不可读。用「最高频 4-gram」做零成本机械检测：
 * 正常行文的最高频 4-gram ≈15-36 次（「看了一眼」类常用语），
 * 崩溃章 ≥100 次（实测 1204-2163），阈值取 100 两侧零误报/零漏报（12 章 + 8 章对照实测）。
 */

/** 最高频 4-gram 及出现次数 */
export function maxRepeat4Gram(text: string): { gram: string; n: number } {
  const clean = text.replace(/\s/g, '');
  const grams = new Map<string, number>();
  for (let i = 0; i + 4 <= clean.length; i++) {
    const g = clean.slice(i, i + 4);
    grams.set(g, (grams.get(g) ?? 0) + 1);
  }
  let best = { gram: '', n: 0 };
  for (const [g, n] of grams) if (n > best.n) best = { gram: g, n };
  return best;
}

/** 是否重复循环崩溃（≥100 视为无效输出，应自动重试） */
export function isCollapsedText(text: string): boolean {
  return maxRepeat4Gram(text).n >= 100;
}
