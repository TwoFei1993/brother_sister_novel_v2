/**
 * 单类资产面板（自 pages/LibraryPage 拆出，review 规范修复）
 *
 * 列表（名/描述摘要）+ 导入（multipart → /api/io/<type>/import）+ 导出
 * （角色卡 png/json，其余 json）+ 删除（confirm 确认）；描述摘要逐项拉详情。
 * 编辑按钮分派逻辑由页面按类型决定（预设内联 / 世界书·卡弹层），本组件只回调。
 */
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';

import {
  ASSET_META, copyAssetToBook, describeAsset, deleteAsset, duplicatePreset, exportAsset, getAsset, importAsset, listAssets,
  renameAsset,
  type AssetType, type LibraryAssetRef,
} from '../../api/library';
import { listWorks } from '../../api/works';

interface AssetPanelProps {
  type: AssetType;
  label: string;
  accept: string;
  notify: (kind: 'ok' | 'err', text: string) => void;
  /** 编辑按钮：分派逻辑由页面按类型决定（预设内联 / 世界书·卡弹层） */
  onEdit: (id: string) => void;
  /** 变更信号：粘贴导入等面板外写入发生后 +1 触发列表重拉 */
  refreshKey: number;
}

export default function AssetPanel({ type, label, accept, notify, onEdit, refreshKey }: AssetPanelProps) {
  const [items, setItems] = useState<LibraryAssetRef[] | null>(null);
  const [summaries, setSummaries] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'name'>('newest');
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    try {
      setItems(await listAssets(type));
    } catch (err) {
      setItems([]);
      notify('err', err instanceof Error ? err.message : `${label}列表加载失败`);
    }
  }, [type, label, notify]);

  useEffect(() => {
    void reload();
  }, [reload, refreshKey]);

  // 描述摘要：列表常量为个位数，逐项拉详情可接受；失败静默（摘要非关键信息）
  useEffect(() => {
    let alive = true;
    for (const it of items ?? []) {
      getAsset(type, it.id)
        .then((a) => {
          if (alive) setSummaries((prev) => ({ ...prev, [it.id]: describeAsset(a) }));
        })
        .catch(() => undefined);
    }
    return () => {
      alive = false;
    };
  }, [items, type]);

  const onFileChosen = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // 允许重复选择同一文件
    if (!file) return;
    setBusy(true);
    try {
      const asset = await importAsset(type, file);
      notify('ok', `已导入「${asset.name}」`);
      await reload();
    } catch (err) {
      notify('err', err instanceof Error ? err.message : '导入失败');
    } finally {
      setBusy(false);
    }
  };

  const onExport = async (id: string, name: string, format?: 'png' | 'json') => {
    try {
      await exportAsset(type, id, { name, format });
      notify('ok', `「${name}」已导出${format ? `（${format.toUpperCase()}）` : ''}`);
    } catch (err) {
      notify('err', err instanceof Error ? err.message : '导出失败');
    }
  };

  const onDelete = async (id: string, name: string) => {
    if (!window.confirm(`确定删除「${name}」？该操作不可恢复。`)) return;
    try {
      await deleteAsset(type, id);
      notify('ok', `已删除「${name}」`);
      await reload();
    } catch (err) {
      notify('err', err instanceof Error ? err.message : '删除失败');
    }
  };

  /** 复制预设（仅 presets）：完整带走提示词与排序，新名 = 原名 + 「 副本」 */
  const onDuplicate = async (id: string, name: string) => {
    try {
      const created = await duplicatePreset(id, `${name} 副本`);
      notify('ok', `已复制为「${created.name}」`);
      await reload();
    } catch (err) {
      notify('err', err instanceof Error ? err.message : '复制失败');
    }
  };

  /** 重命名（全资产，反馈②）：prompt 复用原值，空输入/取消不动 */
  const onRename = async (id: string, name: string) => {
    const next = window.prompt(`重命名${label}`, name)?.trim();
    if (!next || next === name) return;
    try {
      await renameAsset(type, id, next);
      notify('ok', `已重命名为「${next}」`);
      await reload();
    } catch (err) {
      notify('err', err instanceof Error ? err.message : '重命名失败');
    }
  };

  /** 复制到书（P2.1）：输入目标书名关键字 → 唯一匹配即复制（副本挂目标书，原素材不动） */
  const onCopyToBook = async (id: string, name: string) => {
    const keyword = window.prompt(`把「${name}」复制到哪本书？输入书名关键字：`)?.trim();
    if (!keyword) return;
    setBusy(true);
    try {
      const works = await listWorks();
      const hits = works.filter((w) => w.title.includes(keyword));
      if (hits.length === 0) {
        notify('err', `找不到书名含「${keyword}」的作品`);
        return;
      }
      if (hits.length > 1) {
        notify('err', `匹配到 ${hits.length} 本（${hits.slice(0, 3).map((w) => w.title).join('、')}…），请换更精确的关键字`);
        return;
      }
      const created = await copyAssetToBook(type === 'presets' || type === 'regex-scripts' ? 'characters' : type, id, hits[0]!.id);
      notify('ok', `已复制到《${hits[0]!.title}》：「${created.name}」`);
      await reload();
    } catch (err) {
      notify('err', err instanceof Error ? err.message : '复制失败');
    } finally {
      setBusy(false);
    }
  };

  /** 排序后的列表（最近添加 / 最早添加 / 名称）；无时间戳的旧数据排在其余之后 */
  const sorted = (() => {
    const list = [...(items ?? [])];
    if (sortBy === 'name') {
      list.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
    } else {
      const dir = sortBy === 'newest' ? -1 : 1;
      list.sort((a, b) => ((a.createdAt ?? 0) - (b.createdAt ?? 0)) * dir);
    }
    return list;
  })();

  return (
    <section aria-label={`${label}资产面板`} className="flex flex-col gap-3">
      {type === 'regex-scripts' && (
        <div
          data-testid="regex-guide"
          className="rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] px-3 py-2 text-xs leading-5 text-[hsl(var(--fg-muted))]"
        >
          <p className="font-medium text-[hsl(var(--fg))]">正则脚本是什么</p>
          <p>
            自动文本处理规则（查找 → 替换），作用于三条轨道：
            <span className="text-[hsl(var(--fg))]">只改显示</span>
            （美化输出，不改动原文）/
            <span className="text-[hsl(var(--fg))]">只改提示词</span>
            （发给 AI 前清洗）/
            <span className="text-[hsl(var(--fg))]">全部生效</span>
            （两者都改）。
          </p>
          <p>通常随社区预设或角色卡自动导入生效，无需手动编写。</p>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="min-h-[36px] rounded-lg bg-[hsl(var(--accent))] px-4 text-sm font-medium text-white disabled:opacity-40"
        >
          {busy ? '导入中…' : `导入${label}`}
        </button>
        <span className="text-xs text-[hsl(var(--fg-muted))]">
          支持 {accept} 文件{type === 'characters' ? '（PNG 卡自动提取内嵌 JSON）' : ''}
        </span>
        <input ref={fileRef} type="file" accept={accept} hidden onChange={onFileChosen} />
        {(items?.length ?? 0) > 1 && (
          <label className="ml-auto flex items-center gap-1 text-xs text-[hsl(var(--fg-muted))]">
            排序
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              className="h-9 rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-2 text-xs text-[hsl(var(--fg))] outline-none focus:border-[hsl(var(--accent))]"
            >
              <option value="newest">最近添加</option>
              <option value="oldest">最早添加</option>
              <option value="name">按名称</option>
            </select>
          </label>
        )}
      </div>

      {items === null && <p className="py-6 text-center text-sm text-[hsl(var(--fg-muted))]">加载中…</p>}
      {items?.length === 0 && (
        <p className="py-6 text-center text-sm text-[hsl(var(--fg-muted))]">
          暂无{label}，点击上方「导入{label}」上传酒馆格式文件
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {sorted.map((it) => (
          <li
            key={it.id}
            className="rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] px-3 py-2"
          >
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-[hsl(var(--fg))]">{it.name}</p>
                <p className="truncate text-xs text-[hsl(var(--fg-muted))]">
                  {summaries[it.id] ?? ''}
                  {typeof it.createdAt === 'number' && it.createdAt > 0 && (
                    <span className="ml-2 whitespace-nowrap">
                      · 添加于 {new Date(it.createdAt).toLocaleDateString('zh-CN')}
                    </span>
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onEdit(it.id)}
                className="min-h-[36px] rounded-lg border border-[hsl(var(--border-soft))] px-3 text-sm text-[hsl(var(--fg))] hover:border-[hsl(var(--accent))]"
              >
                编辑
              </button>
              {(type === 'characters' || type === 'worldbooks') && (
                <button
                  type="button"
                  onClick={() => void onCopyToBook(it.id, it.name)}
                  data-testid="asset-copy-to-book"
                  title="深拷贝到另一本书（副本挂目标书，原素材不动）"
                  className="min-h-[36px] rounded-lg border border-[hsl(var(--border-soft))] px-3 text-sm text-[hsl(var(--fg))] hover:border-[hsl(var(--accent))]"
                >
                  复制到书
                </button>
              )}
              {type === 'presets' && (
                <button
                  type="button"
                  onClick={() => void onDuplicate(it.id, it.name)}
                  data-testid="asset-copy"
                  title="完整复制一份（含全部提示词与启用排序）"
                  className="min-h-[36px] rounded-lg border border-[hsl(var(--border-soft))] px-3 text-sm text-[hsl(var(--fg))] hover:border-[hsl(var(--accent))]"
                >
                  复制
                </button>
              )}
              <button
                type="button"
                onClick={() => void onRename(it.id, it.name)}
                data-testid="asset-rename"
                title="重命名资产（列表与绑定显示名同步更新）"
                className="min-h-[36px] rounded-lg border border-[hsl(var(--border-soft))] px-3 text-sm text-[hsl(var(--fg))] hover:border-[hsl(var(--accent))]"
              >
                重命名
              </button>
              {type === 'characters' && (
                <button
                  type="button"
                  onClick={() => void onExport(it.id, it.name, 'png')}
                  className="min-h-[36px] rounded-lg border border-[hsl(var(--border-soft))] px-3 text-sm text-[hsl(var(--fg))] hover:border-[hsl(var(--accent))]"
                >
                  导出 PNG
                </button>
              )}
              <button
                type="button"
                onClick={() => void onExport(it.id, it.name, 'json')}
                className="min-h-[36px] rounded-lg border border-[hsl(var(--border-soft))] px-3 text-sm text-[hsl(var(--fg))] hover:border-[hsl(var(--accent))]"
              >
                导出 JSON
              </button>
              <button
                type="button"
                onClick={() => void onDelete(it.id, it.name)}
                className="min-h-[36px] rounded-lg border border-red-400/40 px-3 text-sm text-red-400 hover:bg-red-400/10"
              >
                删除
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
