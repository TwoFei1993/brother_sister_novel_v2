/**
 * AssetPanel 行操作测试（api 层模块级 mock，不触网）
 * 覆盖：复制（携「 副本」新名 + 列表重拉）/ 全资产重命名（反馈②：四类 prompt 改名走
 * renameAsset 携类型）/ 取消不动 / 非预设不渲染复制
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  deleteAsset, describeAsset, duplicatePreset, exportAsset, getAsset, importAsset, listAssets, renameAsset,
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
    renameAsset: vi.fn(async () => undefined),
  };
});

const listAssetsMock = vi.mocked(listAssets);
const duplicatePresetMock = vi.mocked(duplicatePreset);
const renameAssetMock = vi.mocked(renameAsset);

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

/** 打开首行的「更多操作」菜单（行内操作已收进菜单——先展开才能触达复制/重命名菜单项） */
async function openMenu(c: HTMLElement): Promise<void> {
  const more = c.querySelector('[data-testid^="asset-more-"]');
  if (!more) throw new Error('missing asset-more toggle');
  await act(async () => {
    (more as HTMLElement).click();
  });
}

beforeEach(() => {
  listAssetsMock.mockReset().mockResolvedValue(refs);
  duplicatePresetMock.mockClear();
  renameAssetMock.mockClear();
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
    await openMenu(c);
    await act(async () => {
      q(c, 'asset-copy').click();
    });

    expect(duplicatePresetMock).toHaveBeenCalledWith('p1', '网文标准预设 副本');
    expect(notify).toHaveBeenCalledWith('ok', expect.stringContaining('已复制'));
    expect(listAssetsMock).toHaveBeenCalledTimes(2); // 初始 + 复制后重拉
  });

  it('重命名：prompt 输入新名 → renameAsset 携类型与 trimmed 新名', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('  新名字  ');
    const c = await mountPanel();
    await openMenu(c);
    await act(async () => {
      q(c, 'asset-rename').click();
    });

    expect(renameAssetMock).toHaveBeenCalledWith('presets', 'p1', '新名字');
    expect(notify).toHaveBeenCalledWith('ok', expect.stringContaining('已重命名'));
  });

  it('重命名：prompt 取消/空输入不发起请求', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue(null);
    const c = await mountPanel();
    await openMenu(c);
    await act(async () => {
      q(c, 'asset-rename').click();
    });

    expect(renameAssetMock).not.toHaveBeenCalled();
  });

  it('非预设类型不渲染复制按钮，但保留重命名（反馈②）', async () => {
    listAssetsMock.mockResolvedValue([{ id: 'w1', name: '主世界书' }]);
    const c = await mountPanel('worldbooks');
    await openMenu(c);
    expect(c.querySelector('[data-testid="asset-copy"]')).toBeNull();
    expect(c.querySelector('[data-testid="asset-rename"]')).not.toBeNull();
  });

  it.each([
    ['characters', 'c1', '女主卡'],
    ['worldbooks', 'w1', '主世界书'],
    ['regex-scripts', 'r1', '美化正则'],
  ] as [AssetType, string, string][])(
    '全资产重命名（反馈②）：%s 点改名 → renameAsset 携类型与 id',
    async (type, id, name) => {
      listAssetsMock.mockResolvedValue([{ id, name }]);
      vi.spyOn(window, 'prompt').mockReturnValue(`${name}·新`);
      const c = await mountPanel(type);
      await openMenu(c);
      await act(async () => {
        q(c, 'asset-rename').click();
      });

      expect(renameAssetMock).toHaveBeenCalledWith(type, id, `${name}·新`);
      expect(notify).toHaveBeenCalledWith('ok', expect.stringContaining('已重命名'));
    },
  );

  it('复制失败：err 通知且不重拉', async () => {
    duplicatePresetMock.mockRejectedValueOnce(new Error('磁盘已满'));
    const c = await mountPanel();
    await openMenu(c);
    await act(async () => {
      q(c, 'asset-copy').click();
    });

    expect(notify).toHaveBeenCalledWith('err', '磁盘已满');
    expect(listAssetsMock).toHaveBeenCalledTimes(1);
  });
});
