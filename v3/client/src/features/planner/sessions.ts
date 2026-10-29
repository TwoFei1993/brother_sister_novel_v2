/**
 * 向导多会话存储（豆包式左侧历史列表）：localStorage 持久化
 *
 * - 每个创作想法一个会话（turns + proposal + 自动标题），互不干扰
 * - 旧单会话（v3-planner-session-v1）首次读取时自动迁移为一个会话
 * - title 自动生成：首条用户消息前 18 字；无用户消息 = 「新对话」
 */
import type { PlannerProposal } from './planner-llm';

export interface PlannerQuestion {
  q: string;
  options: string[];
}

export interface PlannerTurn {
  role: 'user' | 'assistant';
  text: string;
  questions?: PlannerQuestion[];
  failed?: boolean;
  /** 大纲流被中断的半成品（反馈⑥）：折叠展示原始内容 + 引导「继续」，不直接倾倒原始 JSON */
  interrupted?: boolean;
}

export interface PlannerSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  turns: PlannerTurn[];
  proposal: PlannerProposal | null;
}

const KEY = 'v3-planner-sessions-v1';
const LEGACY_KEY = 'v3-planner-session-v1';
const WELCOME = '描述你的创作想法吧——题材、主角、核心冲突，一两句话就够。我会先问你几个关键问题，聊清楚了再出完整策划案。';

export function newId(): string {
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function welcomeTurn(): PlannerTurn {
  return { role: 'assistant', text: WELCOME };
}

export function titleOf(turns: readonly PlannerTurn[]): string {
  const firstUser = turns.find((t) => t.role === 'user');
  if (firstUser) return firstUser.text.slice(0, 18) || '新对话';
  return `新对话 ${new Date().toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
}

export function createSession(): PlannerSession {
  const now = Date.now();
  return { id: newId(), title: '新对话', createdAt: now, updatedAt: now, turns: [welcomeTurn()], proposal: null };
}

interface Store {
  sessions: PlannerSession[];
  activeId: string;
}

/** 读取全部会话：无存储时建首个；旧单会话键存在则迁移（一次性，迁移后清旧键） */
export function loadStore(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw) as Store;
      if (Array.isArray(d.sessions) && d.sessions.length > 0 && d.activeId) {
        const active = d.sessions.find((s) => s.id === d.activeId) ? d.activeId : d.sessions[0].id;
        return { sessions: d.sessions, activeId: active };
      }
    }
  } catch {
    /* 坏存储 → 重建 */
  }
  // 旧单会话迁移：保留历史对话为第一个会话
  try {
    const legacyRaw = localStorage.getItem(LEGACY_KEY);
    if (legacyRaw) {
      const legacy = JSON.parse(legacyRaw) as { turns?: PlannerTurn[]; proposal?: PlannerProposal | null };
      if (Array.isArray(legacy.turns) && legacy.turns.length > 1) {
        const s: PlannerSession = {
          id: newId(),
          title: titleOf(legacy.turns),
          createdAt: Date.now(),
          updatedAt: Date.now(),
          turns: legacy.turns,
          proposal: legacy.proposal ?? null,
        };
        const store = { sessions: [s], activeId: s.id };
        persist(store);
        localStorage.removeItem(LEGACY_KEY);
        return store;
      }
    }
  } catch {
    /* 迁移失败不阻塞新建 */
  }
  const first = createSession();
  return { sessions: [first], activeId: first.id };
}

export function persist(store: Store): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* 隐私模式静默 */
  }
}
