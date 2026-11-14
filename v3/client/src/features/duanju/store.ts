/**
 * 短剧项目 store（实施计划 T1.10）：project.json 会话缓存 + 乐观锁 PATCH
 *
 * 与 useWorkStore 同哲学：持久化全在服务端，本地仅会话缓存；
 * patch 内部读当前 revision 提交，失败（409/网络）置 conflict 由调用方提示刷新。
 *
 * P1/P2 修复（2026-11-14 审查）：
 * - 同 work 刷新不再清空 project——旧实现 load 先置 null，批量出图每张完成回调 load
 *   会让 BatchBar/镜头卡整树卸载重挂（队列实例销毁、旧队列失控、可能重复扣费）；
 * - 请求序号防乱序：并发 load 时旧响应不覆盖新数据（防后续 patch 全 409）；
 * - 跨 work 切换仍清空（loadedWorkId 追踪），防串台。
 */
import { create } from 'zustand';

import { getDuanjuProject, patchDuanju } from '../../api/duanju';
import type { DuanjuPatch, DuanjuProject } from '@shared/duanju';

interface DuanjuState {
  project: DuanjuProject | null;
  loading: boolean;
  loadError: boolean;
  /** PATCH 进行中（保存按钮禁用） */
  saving: boolean;
  /** 最近一次保存失败（409/网络；调用方提示「刷新」，手动清除） */
  conflict: boolean;
  load: (workId: string) => Promise<void>;
  /** 局部字段提交；成功本地刷新并返回 true */
  patch: (workId: string, fields: Partial<Omit<DuanjuPatch, 'revision'>>) => Promise<boolean>;
  clearConflict: () => void;
  reset: () => void;
}

const INITIAL = {
  project: null,
  loading: false,
  loadError: false,
  saving: false,
  conflict: false,
};

/** load 请求序号 + 已加载 workId（模块级，防并发乱序与跨 work 串台） */
let loadSeq = 0;
let loadedWorkId = '';

export const useDuanjuStore = create<DuanjuState>()((set, get) => ({
  ...INITIAL,
  load: async (workId) => {
    const seq = ++loadSeq;
    // 同 work 刷新保留现有 project（不闪空）；跨 work 切换清空防串台
    if (loadedWorkId !== workId) set({ ...INITIAL, loading: true });
    else set({ loading: true, loadError: false });
    loadedWorkId = workId;
    try {
      const project = await getDuanjuProject(workId);
      if (seq !== loadSeq) return; // 旧响应丢弃：并发 load 乱序不覆盖新数据
      set({ project, loading: false });
    } catch {
      if (seq !== loadSeq) return;
      set({ loadError: true, loading: false }); // 失败保留现有 project
    }
  },
  patch: async (workId, fields) => {
    const cur = get().project;
    if (!cur) return false;
    set({ saving: true, conflict: false });
    try {
      const next = await patchDuanju(workId, cur.revision, fields);
      set({ project: next, saving: false });
      return true;
    } catch {
      set({ saving: false, conflict: true });
      return false;
    }
  },
  clearConflict: () => set({ conflict: false }),
  reset: () => {
    loadSeq++;
    loadedWorkId = '';
    set(INITIAL);
  },
}));
