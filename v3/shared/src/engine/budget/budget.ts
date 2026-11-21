/**
 * token 预算装填（设计 §5.4 / 计划 Task 13）
 *
 * 酒馆语义：聊天历史按「新→旧」排序传入，从最新开始逐项装入，
 * 装不下即停（更旧的项连续全部裁掉——保证历史窗口连续）。
 *
 * 首项必装：即使首项本身超预算也保留（否则生成请求将无任何上下文），
 * 该项超支由调用方在上游预算计算（总预算 = max_context − max_tokens）兜底。
 */

/** 装填结果：included 保持入参顺序（新→旧），truncated 表示是否有项被裁掉 */
export interface FillResult<T> {
  included: T[];
  truncated: boolean;
}

/**
 * 从新到旧装填 items 至 token 预算内。
 * @param items 已按「新→旧」排序的项
 * @param tokenOf 单项 token 估算函数
 * @param budget 可用 token 预算
 */
export function fillBudget<T>(
  items: T[],
  tokenOf: (item: T) => number,
  budget: number,
): FillResult<T> {
  const included: T[] = [];
  let used = 0;
  let truncated = false;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    // 首项必装：保证生成至少携带最新一条上下文
    if (i === 0) {
      included.push(item);
      used += tokenOf(item);
      continue;
    }
    if (used + tokenOf(item) <= budget) {
      included.push(item);
      used += tokenOf(item);
    } else {
      truncated = true;
      break; // 装不下即停：更旧的项连续裁掉
    }
  }

  return { included, truncated };
}
