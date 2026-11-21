/**
 * 顶栏「后台生成中 N 本」轮询 hook（Chunk 6 Task 6.2）
 *
 * 5s 轮询 GET /api/llm/tasks/active，返回 novel-chapter 活跃任务数（llm 任务不计）。
 * 与书架侧 useShelfBatch 的轮询相互独立（轻量列表接口，两处各自轮询可接受——
 * fetch 与类型已抽 lib/activeTasks 共享）；单次抖动静默保留上次计数，卸载停轮询。
 */
import { useEffect, useState } from 'react';

import { fetchActiveTasks } from '../lib/activeTasks';

/** 轮询间隔（与书架侧 SHELF_POLL_MS 同节拍） */
export const ACTIVE_GEN_POLL_MS = 5000;

export function useActiveGenCount(): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let alive = true;
    async function tick(): Promise<void> {
      try {
        const tasks = await fetchActiveTasks();
        if (!alive) return;
        setCount(tasks.filter((t) => t.kind === 'novel-chapter').length);
      } catch {
        /* 单次轮询抖动静默：保留上次计数 */
      }
    }
    void tick();
    const h = setInterval(() => void tick(), ACTIVE_GEN_POLL_MS);
    return () => {
      alive = false;
      clearInterval(h);
    };
  }, []);
  return count;
}
