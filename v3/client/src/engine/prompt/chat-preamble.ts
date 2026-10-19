/**
 * 闲聊前导剥离（novel 模式专用，实测 MiniMax 系角色扮演倾向模型）
 *
 * 模型在写正文前先与 System/系统对话寒暄（「收到的呢，System！」「现在可以开始创作了嘛？」、
 * 思考结束标记、指令原文回显、RP 星号动作等），把正文冲得极短。本模块按行扫描**开头连续**
 * 闲聊段逐行剥离，遇结构/叙述行即停；命中 ≥1 行且剥后剩余 ≥50 字才生效（保守哲学对齐
 * stripLooseThinking：宁可不剥，不可误杀正文）。
 *
 * 注意：chat 模式的 *星号动作* / 括号动作是合法角色扮演内容，故本剥离只接入 novel
 * 路径（presentableNovel / postprocessMessage 的 stripChatter 开关），绝不碰 chat。
 */

/** 结构/叙述行（命中即停止剥离——从这里开始就是正文了） */
function isNarrativeLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (t.startsWith('#')) return true; // 章节标题/嵌套标题
  if (/^[-*_]{3,}$/.test(t)) return true; // 分隔线
  if (/^[「『"']/.test(t)) return true; // 引号对白/引语开篇
  if (t.length >= 40 && /[。！？」』]$/.test(t)) return true; // 长叙述段收尾
  return false;
}

/** 类别 1：思考结束标记行（代理注入的「思考已结束。」及英文变体） */
const THINK_END_RE =
  /^[（\[【]?\s*(?:思考|思维|thinking)\s*(?:已?经?)?\s*(?:结束|完毕|完成|ended?|finished|completed?)\s*[】\]）]?\s*[。．.！!~]*$/i;

/** 类别 2a：对 System/系统 的应答短语（≤30 字）：「收到的呢，System！」「好的，明白。」 */
const SYSTEM_ACK_RE =
  /^(?:收到|好的|明白|了解|没问题|遵命|OK|Okay|好哒|好嘞|当然)(?:[的呢哈哦呀啊啦哒～~！!。，,、\s]*(?:明白了?|收到|好的|没问题|System|系统|主人))*[的呢哈哦呀啊啦哒～~！!。，,、]*[！!。~\s]*$/i;

/** 类别 2b：以 System/系统 开头且带「提供服务」语气的行（可长可短） */
function isSystemOffer(line: string): boolean {
  if (!/^[（\[【]?\s*(?:System|系统)\s*[:：，,！!～~]?/i.test(line)) return false;
  return /(需要我|要我|帮你|你能|写什么|什么类型|什么风格|开始创作|可以开始|请下|随时|指示|为您|为你)/.test(line);
}

/** 类别 3：确认/反问语（≤80 字、疑问/感叹/波浪号收尾、含启动或询问词；引号行已被 isNarrativeLine 拦下） */
const CONFIRM_Q_RE = /(可以.{0,4}(?:开始|创作|写)|开始创作|开始写|需要我|要我|想让我|写什么|什么类型|什么风格|准备好了|请下|指示|继续吗|能帮我)/;

/** 类别 6：指令原文回显（整段复述剧情指令） */
function isDirectiveEcho(line: string, directive?: string): boolean {
  const d = directive?.trim();
  if (!d || d.length < 4) return /^\s*[（(「]?\s*(?:指令|剧情指引|要求|本章)\s*[:：]/.test(line);
  return (line.length <= 30 && line.includes(d)) || /^\s*[（(「]?\s*(?:指令|剧情指引|要求|本章)\s*[:：]/.test(line);
}

/**
 * 单行是否为闲聊行（类别 1-6；category 7 需上下文，见 stripChatPreamble 主循环）
 */
export function isChatterLine(line: string, directive?: string): boolean {
  const t = line.trim();
  if (!t || isNarrativeLine(t)) return false;
  if (t.length <= 30 && SYSTEM_ACK_RE.test(t)) return true; // 2a
  if (isSystemOffer(t)) return true; // 2b
  if (THINK_END_RE.test(t)) return true; // 1
  if (t.length <= 80 && /[？?！!～]\s*$/.test(t) && CONFIRM_Q_RE.test(t)) return true; // 3
  if (/^\*[^*\n]{1,60}\*[。～~]?$/.test(t)) return true; // 4 星号动作
  if (/^[（(][^）\n]{1,60}[）)][。～~]?$/.test(t)) return true; // 5 括号动作
  if (isDirectiveEcho(t, directive)) return true; // 6 指令回显
  return false;
}

/**
 * 剥离开头连续闲聊段：按行扫描，空行跳过、闲聊行剥除、叙述行即停。
 * 类别 7（裸 RP 动作短行，如「坐在咖啡馆里，双手托腮…」）：形式上与正文无异，仅在
 * 已进闲聊语境（前面剥过 ≥1 行）时按「≤40 字 + 含第一人称 + 无完结标点」收紧判定。
 * 全程保守：命中 ≥1 行且剥后剩余 ≥50 字才生效，否则原样返回。
 */
export function stripChatPreamble(content: string, directive?: string): string {
  const lines = content.split('\n');
  let i = 0;
  let stripped = 0;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (!t) {
      i += 1;
      continue;
    }
    if (isChatterLine(t, directive)) {
      stripped += 1;
      i += 1;
      continue;
    }
    // 类别 7：裸 RP 动作短行（需已进闲聊语境才启用，防误杀正文开篇）
    if (
      stripped > 0 &&
      t.length <= 40 &&
      /我/.test(t) &&
      !/[。！？」』]$/.test(t)
    ) {
      stripped += 1;
      i += 1;
      continue;
    }
    break;
  }
  if (stripped === 0) return content;
  const body = lines
    .slice(i)
    .join('\n')
    .replace(/^\n+/, '');
  return body.trim().length >= 50 ? body : content;
}
