/**
 * 作品域 store（设计 §7.2 workStore）：当前作品 + 消息流窗口（会话缓存）
 *
 * - loadWork：GET work 全量 + tail=50 尾部窗口（§4.6 打开作品默认窗口）
 * - loadOlder：before 游标向上翻页，prependOlder 插入头部（幂等去重）
 * - upsertLocal：生成入库成功后的本地同步（同 id 替换，新消息按时间追加尾部）
 * - updateSwipe：本地切换 swipe 候选（content=swipes[n]）后 PATCH 持久化，失败回滚
 * 持久化全在服务端，本 store 仅为会话缓存；离开写作台 reset 释放。
 */
import { create } from 'zustand';

import { deleteMessage as deleteMessageApi, getWork, listMessages, patchMessage } from '../api/works';
import type { Message } from '@shared/message';
import type { Work } from '@shared/work';

/** 尾部窗口大小（§4.6 默认 50 条） */
const TAIL_SIZE = 50;

interface WorkState {
  work: Work | null;
  messages: Message[];
  /** loadWork 进行中 */
  loading: boolean;
  /** loadWork 失败（网络/404） */
  loadError: boolean;
  /** 更早方向是否还有消息（向上翻页判据） */
  hasMore: boolean;
  /** loadOlder 进行中（防重复触发） */
  loadingOlder: boolean;
  loadWork: (id: string) => Promise<void>;
  /** 向上拉取更早一页（guard：无更多/加载中/空消息时静默跳过） */
  loadOlder: () => Promise<void>;
  /** 直接插入更早消息（去重合并，保持服务端顺序） */
  prependOlder: (older: Message[]) => void;
  /** 生成入库/本地构造后的同步：同 id 替换，新消息追加尾部 */
  upsertLocal: (message: Message) => void;
  /** 切换某条消息的 swipe 候选：本地即改 + PATCH 持久化（失败回滚） */
  updateSwipe: (messageId: string, swipeId: number) => Promise<void>;
  /** 删除单条消息（D3）：乐观移除 + DELETE 持久化 + 回拉全量 Work 同步 stats；
   *  失败按 createdAt 序回插原位并返回 false（调用方提示） */
  removeMessage: (messageId: string) => Promise<boolean>;
  /** 设置抽屉保存成功后的全量替换 */
  setWork: (work: Work) => void;
  reset: () => void;
}

const INITIAL = {
  work: null,
  messages: [],
  loading: false,
  loadError: false,
  hasMore: false,
  loadingOlder: false,
};

/** 按 id 去重合并两段消息（先到者优先，保持各自相对顺序） */
function mergeById(base: Message[], incoming: Message[]): Message[] {
  const seen = new Set(base.map((m) => m.id));
  return [...base, ...incoming.filter((m) => !seen.has(m.id))];
}

export const useWorkStore = create<WorkState>()((set, get) => ({
  ...INITIAL,

  loadWork: async (id) => {
    set({ ...INITIAL, loading: true });
    try {
      const [work, page] = await Promise.all([getWork(id), listMessages(id, { tail: TAIL_SIZE })]);
      set({
        work,
        messages: page.messages,
        hasMore: page.hasMore ?? false,
        loading: false,
        loadError: false,
      });
    } catch {
      set({ loading: false, loadError: true });
    }
  },

  loadOlder: async () => {
    const { hasMore, loadingOlder, loading, messages, work } = get();
    if (!hasMore || loadingOlder || loading || messages.length === 0 || !work) return;
    set({ loadingOlder: true });
    try {
      const page = await listMessages(work.id, { before: messages[0].id, limit: TAIL_SIZE });
      set((s) => ({
        messages: mergeById(page.messages, s.messages), // 旧窗口在前，新窗口接尾
        hasMore: page.hasMore ?? false,
        loadingOlder: false,
      }));
    } catch {
      set({ loadingOlder: false }); // 翻页失败静默保留当前窗口，可再次触发
    }
  },

  prependOlder: (older) => set((s) => ({ messages: mergeById(older, s.messages) })),

  upsertLocal: (message) =>
    set((s) => {
      const idx = s.messages.findIndex((m) => m.id === message.id);
      if (idx < 0) return { messages: [...s.messages, message] };
      const next = [...s.messages];
      next[idx] = message;
      return { messages: next };
    }),

  updateSwipe: async (messageId, swipeId) => {
    const { work, messages } = get();
    if (!work) return;
    const target = messages.find((m) => m.id === messageId);
    if (!target || !target.swipes[swipeId]) return;
    const updated: Message = { ...target, swipeId, content: target.swipes[swipeId]!.content };
    set((s) => ({
      messages: s.messages.map((m) => (m.id === messageId ? updated : m)),
    }));
    try {
      await patchMessage(work.id, updated);
    } catch (err) {
      console.warn('[workStore] swipe 切换持久化失败，已回滚', err);
      set((s) => ({
        messages: s.messages.map((m) => (m.id === messageId ? target : m)),
      }));
    }
  },

  setWork: (work) => set({ work }),
  reset: () => set({ ...INITIAL }),

  removeMessage: async (messageId) => {
    const { work, messages } = get();
    if (!work) return false;
    const target = messages.find((m) => m.id === messageId);
    if (!target) return false;
    // 乐观移除：章节计数（h1）与气泡流立即反映删除
    set((s) => ({ messages: s.messages.filter((m) => m.id !== messageId) }));
    try {
      await deleteMessageApi(work.id, messageId);
      // stats 快照随服务端重算（updateWorkStats），回拉全量保持 h1/书架口径一致
      set({ work: await getWork(work.id) });
      return true;
    } catch (err) {
      console.warn('[workStore] 删除消息持久化失败，已回滚', err);
      // 按 createdAt 序回插原位（窗口消息即按时间序），不破坏消息流顺序
      set((s) => {
        const next = [...s.messages];
        const idx = next.findIndex((m) => m.createdAt > target.createdAt);
        next.splice(idx < 0 ? next.length : idx, 0, target);
        return { messages: next };
      });
      return false;
    }
  },
}));
