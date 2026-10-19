/**
 * chat 快速回复点选（用户反馈四问④：不想每次手输）
 *
 * - 内置建议池：每条 AI 回复后展示一轮 chips，点击即发送
 * - 每轮换一组：按轮次（assistant 消息数）在池内旋转窗口（简单轮换）
 * - 作品 settings.quickDirectives 非空时优先作为轮换池
 * - 括号包裹的指令（如「（继续推进剧情）」）为隐式引导：进上下文（userMessage 通道）
 *   但不入库——复用 chat-flow 对空 userText 跳过入库的既有语义
 */

/** 每轮展示的 chips 数量 */
export const QUICK_DIRECTIVE_COUNT = 5;

/** 内置建议池：前两条括号形式为隐式引导，其余为普通对话文本 */
export const DEFAULT_QUICK_DIRECTIVES: readonly string[] = [
  '（继续推进剧情）',
  '（走近对方）',
  '追问真相',
  '转移话题',
  '沉默观察',
  '温柔安慰',
  '开个玩笑',
  '（时间流逝到傍晚）',
];

/** 从池中按轮次旋转窗口取一组 chips（纯函数；custom 非空时优先作为轮换池） */
export function pickQuickDirectives(custom: string[] | undefined, round: number): string[] {
  const pool = (custom && custom.filter((s) => s.trim()).length > 0 ? custom : DEFAULT_QUICK_DIRECTIVES).filter(
    (s) => s.trim(),
  );
  const start = ((round % pool.length) + pool.length) % pool.length; // 防负数轮次
  return Array.from({ length: Math.min(QUICK_DIRECTIVE_COUNT, pool.length) }, (_, i) => pool[(start + i) % pool.length]);
}

/** 隐式引导判定：整条被中英文括号包裹的文本只作上下文引导、不入库 */
export function isImplicitDirective(text: string): boolean {
  const t = text.trim();
  return /^[（(].+[）)]$/.test(t);
}
