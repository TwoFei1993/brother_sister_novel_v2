/**
 * 向导资产导入 hook（Word 导入实测反馈①⑥）：一键导入/单独建卡建书的状态与编排。
 * 反馈①：成功不跳转，就地展示成功清单（已建卡名 + 世界书名 +「前往资产库」链接）。
 * 反馈⑥：已建资产 ids 累计记录（assets）供「创建作品自动绑定」——
 * 时序A：ChapterOutlineImport 创建作品时携带全部 ids；
 * 时序B：本会话先前已创建作品（readCreatedWorkId 锚点）→ 建卡/书成功后自动 PATCH 合并绑定。
 */
import { useState } from 'react';

import {
  bindAssetsToWork,
  createCharacterCards,
  createWorldbook,
  importAllAssets,
  mergeAssets,
  readCreatedWorkId,
  writeCreatedWorkId,
  EMPTY_ASSETS,
  type ImportedAssets,
} from './importAll';
import type { ExtractedOutline } from '../../../lib/outline/wizard';

/** 一键导入 UI 状态（OutlinePreview 纯展示） */
export interface ImportAllState {
  phase: 'idle' | 'running' | 'done' | 'error';
  progress: { done: number; total: number } | null;
  /** 本次动作的成果清单（done 时就地展示） */
  assets: ImportedAssets;
  /** 失败时的人话消息 */
  message: string;
}

const INITIAL_STATE: ImportAllState = { phase: 'idle', progress: null, assets: EMPTY_ASSETS, message: '' };

type Notify = (kind: 'ok' | 'err', text: string) => void;

/** onImported：导入成功回调（向导用于清除粘贴草稿） */
export function useWizardImports(notify: Notify, onImported?: () => void) {
  const [busy, setBusy] = useState(false);
  const [assets, setAssets] = useState<ImportedAssets>(EMPTY_ASSETS); // 累计（⑥创建作品时携带）
  const [importState, setImportState] = useState<ImportAllState>(INITIAL_STATE);

  /** 时序B：本会话已创建作品 → 合并绑定本次新建资产，成功后清除锚点 */
  const bindIfWorkExists = async (created: ImportedAssets): Promise<void> => {
    const workId = readCreatedWorkId();
    if (!workId || (created.characterIds.length === 0 && created.worldbookIds.length === 0)) return;
    try {
      const title = await bindAssetsToWork(workId, {
        characterIds: created.characterIds,
        worldbookIds: created.worldbookIds,
      });
      writeCreatedWorkId(null);
      notify('ok', `已自动绑定到作品《${title}》`);
    } catch {
      notify('err', '自动绑定作品失败，可稍后在作品设置中手动绑定');
    }
  };

  /** 公共骨架：busy 管理 + 失败转译 + 累计 assets + 时序B绑定；成功返回 true */
  const run = async (action: () => Promise<Partial<ImportedAssets>>): Promise<boolean> => {
    setBusy(true);
    try {
      const created = mergeAssets(EMPTY_ASSETS, await action());
      setAssets((prev) => mergeAssets(prev, created));
      setImportState((s) => ({ ...s, phase: 'done', progress: null, assets: mergeAssets(s.assets, created) }));
      await bindIfWorkExists(created);
      onImported?.();
      return true;
    } catch (err) {
      setImportState((s) => ({
        ...s,
        phase: 'error',
        progress: null,
        message: err instanceof Error ? err.message : '导入失败，请检查后端服务',
      }));
      return false;
    } finally {
      setBusy(false);
    }
  };

  /** 反馈①：一键导入（串行建卡进度 + 建世界书），成功不跳转 */
  const importAll = async (extracted: ExtractedOutline): Promise<void> => {
    if (busy) return;
    setImportState({
      phase: 'running',
      progress: { done: 0, total: extracted.characters.length },
      assets: EMPTY_ASSETS,
      message: '',
    });
    const ok = await run(() =>
      importAllAssets(extracted, (done, total) => setImportState((s) => ({ ...s, progress: { done, total } }))),
    );
    if (ok) notify('ok', '一键导入完成：角色卡与世界书已生成（未跳转，清单见预览区）');
  };

  /** 单独建角色卡（次级入口；ids 同样累计供⑥） */
  const createCards = async (extracted: ExtractedOutline): Promise<void> => {
    if (busy) return;
    if (extracted.characters.length === 0) {
      notify('err', '未抽取到人物，无法生成角色卡');
      return;
    }
    setImportState({ ...INITIAL_STATE, phase: 'running', progress: { done: 0, total: extracted.characters.length } });
    const ok = await run(async () => {
      const { ids, names } = await createCharacterCards(extracted, (done, total) =>
        setImportState((s) => ({ ...s, progress: { done, total } })),
      );
      return { characterIds: ids, characterNames: names };
    });
    if (ok) notify('ok', `已生成 ${extracted.characters.length} 张角色卡（未跳转）`);
  };

  /** 单独建世界书 */
  const createWorldbookOnly = async (extracted: ExtractedOutline): Promise<void> => {
    if (busy) return;
    setImportState({ ...INITIAL_STATE, phase: 'running', progress: null });
    const ok = await run(async () => {
      const wb = await createWorldbook(extracted);
      return { characterIds: [], characterNames: [], worldbookIds: [wb.id], worldbookNames: [wb.name] };
    });
    if (ok) notify('ok', '已生成世界书（未跳转）');
  };

  return { busy, assets, importState, importAll, createCards, createWorldbookOnly };
}
