/**
 * chat 模式多角色激活策略（设计 §4.3，酒馆群聊 activation 简化版）
 *
 * pickSpeaker 优先级：手动指定 > 提及检测 > 自然轮换：
 * - 手动指定：UI 点选的 manualPickId 生效；id 不在成员中视为无效，落回自动策略
 * - 提及检测：userText 含成员 name 或 @name；多个提及取靠后出现者（最新话题人物）
 * - 自然轮换：成员顺序中 lastSpeaker 的下一位；lastSpeaker=null/未知取首位；单成员恒定
 * - 空成员列表抛错（调用方保证成员非空）
 */
export interface ChatMember {
  id: string;
  name: string;
}

/** 成员在文本中被提及的最早位置（@name 与裸名等价；未提及返回 -1；空名不参与） */
function mentionPos(userText: string, name: string): number {
  const trimmed = name.trim();
  if (!trimmed) return -1;
  const positions = [userText.indexOf(trimmed), userText.indexOf(`@${trimmed}`)].filter((p) => p >= 0);
  return positions.length ? Math.min(...positions) : -1;
}

/**
 * 选出本次生成的发言角色（纯函数）。
 * {{char}} 宏与 AI 消息 name 均绑定此结果（设计 §4.3）。
 */
export function pickSpeaker(
  members: ChatMember[],
  lastSpeakerId: string | null,
  userText: string,
  manualPickId: string | null = null,
): ChatMember {
  if (members.length === 0) throw new Error('pickSpeaker：成员列表为空');

  // 1. 手动指定（UI 点选下一位发言者）
  const manual = manualPickId ? members.find((m) => m.id === manualPickId) : undefined;
  if (manual) return manual;

  // 2. 提及检测：逐成员取其最早提及位置，多个提及取靠后出现者（最新话题人物）；
  //    位置并列取先声明者（确定性）
  let best: { member: ChatMember; pos: number } | null = null;
  for (const m of members) {
    const pos = mentionPos(userText, m.name);
    if (pos >= 0 && (!best || pos > best.pos)) best = { member: m, pos };
  }
  if (best) return best.member;

  // 3. 自然轮换：lastSpeaker 的下一位；lastSpeaker 为 null 或不在成员中取首位
  const idx = lastSpeakerId ? members.findIndex((m) => m.id === lastSpeakerId) : -1;
  return members[idx === -1 ? 0 : (idx + 1) % members.length];
}
