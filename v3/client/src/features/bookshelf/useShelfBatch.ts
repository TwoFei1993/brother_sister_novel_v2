/**
 * 书架批量生成状态机（Chunk 6 Task 6.1）：多选模式 + novel-chapter 活跃任务 5s 轮询
 *
 * - 多选：enterBatchMode/toggleWork/exitBatchMode（退出清空选择）；状态独立成 hook，
 *   Bookshelf 不因多选 UI + 轮询破 300 行约束
 * - 轮询：挂载即拉一次 GET /api/llm/tasks/active，此后 5s 一拍，卸载停（单次抖动静默
 *   保留上次索引）；novel-chapter 任务按 workId 索引为卡片徽标数据源
 * - 终态感知：上次在轮询中、本次消失的 workId = 该书任务终态 → 调 refreshWorks 一次
 *   （静默刷新，卡片显示新章数）；结果集不变不刷
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchActiveTasks, novelTasksByWork } from '../../lib/activeTasks';
import type { ActiveTask } from '../../lib/activeTasks';
import { cancelTask as cancelTaskApi } from '../../lib/llmTask';

/** 轮询间隔（5s）：进度徽标与终态感知的节拍；与顶栏 useActiveGenCount 独立轮询 */
export const SHELF_POLL_MS = 5000;

/** 书架批量状态面（Bookshelf 消费；选择集与轮询结果只读） */
export interface ShelfBatch {
  batchMode: boolean;
  selectedIds: ReadonlySet<string>;
  activeByWork: Readonly<Record<string, ActiveTask>>;
  /** 已发 cancel、server 段间生效前的 workId 集合（卡片取消按钮禁用/文案「取消中…」；
   *  任务终态从 active 列表消失后自动清除，取消请求失败也立即清除可重试） */
  cancellingIds: ReadonlySet<string>;
  dialogOpen: boolean;
  enterBatchMode: () => void;
  exitBatchMode: () => void;
  toggleWork: (id: string) => void;
  openDialog: () => void;
  /** 弹窗关闭（提交完成自动关 / 用户取消）：退出多选——进度展示交还卡片徽标 */
  closeDialog: () => void;
  /** 取消该书进行中的后台任务（POST cancel；server 段间生效——当前段跑完即停，D6） */
  cancelTask: (workId: string) => void;
}

export function useShelfBatch(refreshWorks: () => void): ShelfBatch {
  const [batchMode, setBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [activeByWork, setActiveByWork] = useState<Readonly<Record<string, ActiveTask>>>({});
  const [cancellingIds, setCancellingIds] = useState<ReadonlySet<string>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);

  // refreshWorks 经 ref 转接：轮询 effect 只挂一次，Bookshelf 每轮渲染的新回调不重启轮询
  const refreshRef = useRef(refreshWorks);
  refreshRef.current = refreshWorks;
  // activeByWork 同款 ref 转接：cancelTask 稳定引用，点击时读最新索引拿 taskId
  const activeRef = useRef(activeByWork);
  activeRef.current = activeByWork;

  const enterBatchMode = useCallback(() => setBatchMode(true), []);
  const exitBatchMode = useCallback(() => {
    setBatchMode(false);
    setSelectedIds(new Set());
  }, []);
  const toggleWork = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const openDialog = useCallback(() => setDialogOpen(true), []);
  const closeDialog = useCallback(() => {
    setDialogOpen(false);
    setBatchMode(false);
    setSelectedIds(new Set());
  }, []);

  /** 取消：先本地标记取消中（按钮禁用防重复点），POST 失败立即撤销标记可重试；
   *  成功则等任务终态从 active 消失时由轮询清理标记 */
  const cancelTask = useCallback((workId: string): void => {
    const task = activeRef.current[workId];
    if (!task) return;
    setCancellingIds((prev) => {
      if (prev.has(workId)) return prev;
      const next = new Set(prev);
      next.add(workId);
      return next;
    });
    void cancelTaskApi(task.id).catch(() => {
      setCancellingIds((prev) => {
        if (!prev.has(workId)) return prev;
        const next = new Set(prev);
        next.delete(workId);
        return next;
      });
    });
  }, []);

  useEffect(() => {
    let alive = true;
    /** 上一拍在轮询中的 workId 集合（终态 diff 基准；首拍空集不触发刷新） */
    let prevWorkIds = new Set<string>();
    async function tick(): Promise<void> {
      let byWork: Record<string, ActiveTask>;
      try {
        byWork = novelTasksByWork(await fetchActiveTasks());
      } catch {
        return; // 单次轮询抖动静默：保留上次索引
      }
      if (!alive) return;
      setActiveByWork(byWork);
      const ids = new Set(Object.keys(byWork));
      let disappeared = false;
      for (const id of prevWorkIds) {
        if (!ids.has(id)) disappeared = true;
      }
      if (prevWorkIds.size > 0 && disappeared) refreshRef.current();
      prevWorkIds = ids;
      // 取消中标记清理：任务已终态（不在 active 列表）→ 不再禁用按钮（按钮随徽标消失）
      setCancellingIds((prev) => {
        let changed = false;
        const next = new Set(prev);
        for (const id of next) {
          if (!ids.has(id)) {
            next.delete(id);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }
    void tick();
    const h = setInterval(() => void tick(), SHELF_POLL_MS);
    return () => {
      alive = false;
      clearInterval(h);
    };
  }, []);

  return {
    batchMode,
    selectedIds,
    activeByWork,
    cancellingIds,
    dialogOpen,
    enterBatchMode,
    exitBatchMode,
    toggleWork,
    openDialog,
    closeDialog,
    cancelTask,
  };
}
