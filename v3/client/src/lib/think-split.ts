/**
 * <think> 标签流式分流器（openai 兼容端点的思考内联在 content 里，如 MiniMax-M3）
 *
 * 跨 chunk 状态机：think 开/闭标签可能被切成两半分布在相邻 chunk，
 * 未决缓冲在非 think 态保留「可能是 '<think>' 前缀」的尾巴等下一个 chunk 补全，
 * 在 think 态同样保留「</think> 前缀」尾巴；按当前是否处于 think 块分别导出：
 *   content  → 正文打字机
 *   thinking → 思考流（D4，入库 extra.rawThinking）
 */

export interface ThinkSplitResult {
  content: string;
  thinking: string;
}

const OPEN = '<think>';
const CLOSE = '</think>';

/** 保留 pending 尾部中「可能是 tag 前缀」的最长长度（无则 0） */
function holdLength(pending: string, tag: string): number {
  const keep = Math.min(pending.length, tag.length - 1);
  for (let l = keep; l > 0; l--) {
    if (tag.startsWith(pending.slice(pending.length - l))) return l;
  }
  return 0;
}

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
          const hold = holdLength(pending, OPEN);
          if (hold > 0) {
            content.push(pending.slice(0, pending.length - hold));
            pending = pending.slice(pending.length - hold);
          } else {
            content.push(pending);
            pending = '';
          }
          break;
        }
        if (open > 0) content.push(pending.slice(0, open));
        pending = pending.slice(open + OPEN.length);
        inThink = true;
      } else {
        const close = pending.indexOf(CLOSE);
        if (close === -1) {
          const hold = holdLength(pending, CLOSE);
          if (hold > 0) {
            thinking.push(pending.slice(0, pending.length - hold));
            pending = pending.slice(pending.length - hold);
          } else {
            thinking.push(pending);
            pending = '';
          }
          break;
        }
        thinking.push(pending.slice(0, close));
        pending = pending.slice(close + CLOSE.length);
        inThink = false;
      }
    }
    return { content: content.join(''), thinking: thinking.join('') };
  }

  /** 流结束：把未决缓冲按当前状态导出，并复位状态（下一章可复用同一分流器） */
  function flush(): ThinkSplitResult {
    const wasInThink = inThink;
    const rest = pending;
    pending = '';
    inThink = false;
    return wasInThink
      ? { content: '', thinking: rest }
      : { content: rest, thinking: '' };
  }

  return { split, flush };
}
