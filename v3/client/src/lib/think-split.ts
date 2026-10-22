/**
 * <think> 标签流式分流器（openai 兼容端点的思考内联在 content 里，如 MiniMax-M3）
 *
 * 跨 chunk 状态机：think 开/闭标签可能被切成两半分布在相邻 chunk，
 * 内部持有未决缓冲，按当前是否处于 think 块把文字分别导出：
 *   content  → 正文打字机
 *   thinking → 思考流（D4，入库 extra.rawThinking）
 */

export interface ThinkSplitResult {
  content: string;
  thinking: string;
}

const OPEN = '<think>';
const CLOSE = '</think>';

export function createThinkSplitter() {
  let pending = '';
  let inThink = false;

  /** 喂入一段流文本，返回本段分离出的正文与思考 */
  function split(text: string): ThinkSplitResult {
    pending += text;
    const content: string[] = [];
    const thinking: string[] = [];
    for (;;) {
      if (!inThink) {
        const open = pending.indexOf(OPEN);
        if (open === -1) {
          content.push(pending);
          pending = '';
          break;
        }
        if (open > 0) content.push(pending.slice(0, open));
        pending = pending.slice(open + OPEN.length);
        inThink = true;
      } else {
        const close = pending.indexOf(CLOSE);
        if (close === -1) {
          thinking.push(pending);
          pending = '';
          break;
        }
        thinking.push(pending.slice(0, close));
        pending = pending.slice(close + CLOSE.length);
        inThink = false;
      }
    }
    return { content: content.join(''), thinking: thinking.join('') };
  }

  /** 流结束：把残留在未决缓冲里的尾巴按当前状态导出（think 中断也归思考流） */
  function flush(): ThinkSplitResult {
    if (!pending) return { content: '', thinking: '' };
    const rest = pending;
    pending = '';
    return inThink ? { content: '', thinking: rest } : { content: rest, thinking: '' };
  }

  return { split, flush };
}
