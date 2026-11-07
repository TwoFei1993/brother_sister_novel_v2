/**
 * 短剧项目 store（实施计划 T1.10）：project.json 会话缓存 + 乐观锁 PATCH
 *
 * 与 useWorkStore 同哲学：持久化全在服务端，本地仅会话缓存；
 * patch 内部读当前 revision 提交，失败（409/网络）置 conflict 由调用方提示刷新。
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

export const useDuanjuStore = create<DuanjuState>()((set, get) => ({
  ...INITIAL,
  load: async (workId) => {
    set({ ...INITIAL, loading: true });
    try {
      const project = await getDuanjuProject(workId);
      set({ project, loading: false });
    } catch {
      set({ ...INITIAL, loadError: true });
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
  reset: () => set(INITIAL),
}));
