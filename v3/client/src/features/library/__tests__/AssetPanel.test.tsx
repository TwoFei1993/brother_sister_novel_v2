/**
 * AssetPanel 预设行操作测试（api 层模块级 mock，不触网）
 * 覆盖：复制（携「 副本」新名 + 列表重拉）/ 重命名（prompt 输入回车改名）/ 取消不动
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  deleteAsset, describeAsset, duplicatePreset, exportAsset, getAsset, importAsset, listAssets, renamePreset,
  type AssetType, type LibraryAssetRef,
} from '../../../api/library';

import AssetPanel from '../AssetPanel';

vi.mock('../../../api/library', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/library')>();
  return {
    ...actual,
    listAssets: vi.fn(),
    getAsset: vi.fn(async () => {
      throw new Error('详情加载失败（测试 mock）');
    }),
    importAsset: vi.fn(),
    exportAsset: vi.fn(async () => undefined),
    deleteAsset: vi.fn(async () => undefined),
    describeAsset: actual.describeAsset,
    duplicatePreset: vi.fn(async (id: string, name: string) => ({ id: 'p-copy', name })),
    renamePreset: vi.fn(async () => undefined),
  };
});

const listAssetsMock = vi.mocked(listAssets);
const duplicatePresetMock = vi.mocked(duplicatePreset);
const renamePresetMock = vi.mocked(renamePreset);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
const notify = vi.fn();

const refs: LibraryAssetRef[] = [
  { id: 'p1', name: '网文标准预设', createdAt: 1 },
];

async function mountPanel(type: AssetType = 'presets'): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(<AssetPanel type={type} label="预设" accept=".json" notify={notify} onEdit={() => undefined} refreshKey={0} />);
  });
  return container;
}

const q = (c: HTMLElement, id: string): HTMLElement => {
  const el = c.querySelector(`[data-testid="${id}"]`);
  if (!el) throw new Error(`missing [data-testid=${id}]`);
  return el as HTMLElement;
};

beforeEach(() => {
  listAssetsMock.mockReset().mockResolvedValue(refs);
  duplicatePresetMock.mockClear();
  renamePresetMock.mockClear();
  notify.mockClear();
});

afterEach(async () => {
  await act(async () => {
    for (const root of roots) root.unmount();
  });
  roots.length = 0;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('AssetPanel 预设复制/重命名', () => {
  it('复制：携「 原名 副本」调用 duplicatePreset 并重拉列表', async () => {
    const c = await mountPanel();
    await act(async () => {
      q(c, 'asset-copy').click();
    });

    expect(duplicatePresetMock).toHaveBeenCalledWith('p1', '网文标准预设 副本');
    expect(notify).toHaveBeenCalledWith('ok', expect.stringContaining('已复制'));
    expect(listAssetsMock).toHaveBeenCalledTimes(2); // 初始 + 复制后重拉
  });

  it('重命名：prompt 输入新名 → renamePreset 携 trimmed 新名', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('  新名字  ');
    const c = await mountPanel();
    await act(async () => {
      q(c, 'asset-rename').click();
    });

    expect(renamePresetMock).toHaveBeenCalledWith('p1', '新名字');
    expect(notify).toHaveBeenCalledWith('ok', expect.stringContaining('已重命名'));
  });

  it('重命名：prompt 取消/空输入不发起请求', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue(null);
    const c = await mountPanel();
    await act(async () => {
      q(c, 'asset-rename').click();
    });

    expect(renamePresetMock).not.toHaveBeenCalled();
  });

  it('非预设类型不渲染复制/重命名按钮', async () => {
    listAssetsMock.mockResolvedValue([{ id: 'w1', name: '主世界书' }]);
    const c = await mountPanel('worldbooks');
    expect(c.querySelector('[data-testid="asset-copy"]')).toBeNull();
    expect(c.querySelector('[data-testid="asset-rename"]')).toBeNull();
  });

  it('复制失败：err 通知且不重拉', async () => {
    duplicatePresetMock.mockRejectedValueOnce(new Error('磁盘已满'));
    const c = await mountPanel();
    await act(async () => {
      q(c, 'asset-copy').click();
    });

    expect(notify).toHaveBeenCalledWith('err', '磁盘已满');
    expect(listAssetsMock).toHaveBeenCalledTimes(1);
  });
});
