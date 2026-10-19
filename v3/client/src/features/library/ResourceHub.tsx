/**
 * 资源中心（Task 30，设计 §8）：精选索引搜索 + 类型筛选 + 一键导入 + 本地上传入口。
 *
 * 数据源：GET /api/io/resources/index（builtin 本地复制 + remote 直链，只读不改）。
 * 导入：POST /api/io/resources/fetch（服务端拉取→校验→入库），成功后按返回的
 * assetType 跳转对应资产 Tab。本地上传复用 LibraryPage 同款 multipart 导入管道
 * （importAsset），上传前需选择资产类型。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';

import { apiFetch } from '../../api/client';
import FieldHint from '../../components/FieldHint';
import { OPTION_CLS, SELECT_TONE_CLS } from '../../components/ui-select';
import { ASSET_META, importAsset, type AssetType, type LibraryAssetRef } from '../../api/library';

// ---------- 索引条目（与服务端 resources.ts 的 index.json 同构） ----------

interface ResourceEntry {
  id: string;
  type: 'preset' | 'worldbook' | 'character' | 'regex';
  name: string;
  description: string;
  tags: string[];
  source: string;
  ref: { kind: 'builtin' | 'remote'; path?: string; url?: string };
  license: string;
}

const TYPE_LABEL: Record<ResourceEntry['type'], string> = {
  preset: '预设',
  worldbook: '世界书',
  character: '角色卡',
  regex: '正则',
};

const FILTERS: ReadonlyArray<{ id: ResourceEntry['type'] | 'all'; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'preset', label: '预设' },
  { id: 'worldbook', label: '世界书' },
  { id: 'character', label: '角色卡' },
  { id: 'regex', label: '正则' },
];

type Toast = { kind: 'ok' | 'err'; text: string };

interface ResourceHubProps {
  notify: (kind: 'ok' | 'err', text: string) => void;
  /** 导入/上传成功后跳转到对应资产 Tab（AssetType） */
  onJump: (type: AssetType) => void;
}

export default function ResourceHub({ notify, onJump }: ResourceHubProps) {
  const [entries, setEntries] = useState<ResourceEntry[] | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ResourceEntry['type'] | 'all'>('all');
  const [importingId, setImportingId] = useState<string | null>(null);
  const [uploadType, setUploadType] = useState<AssetType>('presets');
  const [uploading, setUploading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  /** 拉取资源索引（首载与「刷新」共用）；失败置空列表并提示 */
  const loadIndex = useCallback(
    async (withSpinner: boolean): Promise<void> => {
      if (withSpinner) setRefreshing(true);
      try {
        const idx = await apiFetch<{ entries: ResourceEntry[] }>('/api/io/resources/index');
        setEntries(idx.entries);
      } catch (err) {
        setEntries([]);
        notify('err', err instanceof Error ? err.message : '资源索引加载失败');
      } finally {
        if (withSpinner) setRefreshing(false);
      }
    },
    [notify],
  );

  useEffect(() => {
    void loadIndex(false);
  }, [loadIndex]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (entries ?? []).filter((e) => {
      if (filter !== 'all' && e.type !== filter) return false;
      if (q === '') return true;
      return (
        e.name.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q) ||
        e.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [entries, query, filter]);

  const onImport = async (entry: ResourceEntry) => {
    setImportingId(entry.id);
    try {
      const body =
        entry.ref.kind === 'builtin'
          ? { kind: 'builtin', path: entry.ref.path }
          : { kind: 'remote', url: entry.ref.url };
      const asset = await apiFetch<{ assetType: AssetType; id: string; name: string }>(
        '/api/io/resources/fetch',
        { method: 'POST', body: JSON.stringify(body) },
      );
      notify('ok', `已导入「${asset.name}」，已为你切换到对应标签页`);
      onJump(asset.assetType);
    } catch (err) {
      notify('err', err instanceof Error ? err.message : '导入失败');
    } finally {
      setImportingId(null);
    }
  };

  const onUploadFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    try {
      const asset: LibraryAssetRef = await importAsset(uploadType, file);
      notify('ok', `已上传导入「${asset.name}」`);
      onJump(uploadType);
    } catch (err) {
      notify('err', err instanceof Error ? err.message : '上传导入失败');
    } finally {
      setUploading(false);
    }
  };

  const chip = (active: boolean): string =>
    `min-h-[36px] rounded-full border px-3 text-sm transition-colors ${
      active
        ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent))]/15 font-medium text-[hsl(var(--accent))]'
        : 'border-[hsl(var(--border-soft))] text-[hsl(var(--fg-muted))] hover:border-[hsl(var(--accent))]'
    }`;

  return (
    <section aria-label="资源中心" className="flex flex-col gap-4">
      {/* 来源说明 + 刷新 */}
      <div className="rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-[hsl(var(--fg))]">资源从哪来</h3>
          <button
            type="button"
            data-testid="hub-refresh"
            onClick={() => void loadIndex(true)}
            disabled={refreshing}
            aria-label="刷新资源索引"
            className="flex min-h-[36px] items-center gap-1.5 rounded-lg border border-[hsl(var(--border-soft))] px-3 text-sm text-[hsl(var(--fg))] transition-colors hover:border-[hsl(var(--accent))] disabled:opacity-40"
          >
            <span aria-hidden="true" className={refreshing ? 'inline-block animate-spin' : 'inline-block'}>
              ⟳
            </span>
            {refreshing ? '刷新中…' : '刷新'}
          </button>
        </div>
        <ul className="mt-1 flex flex-col gap-0.5 text-xs leading-5 text-[hsl(var(--fg-muted))]">
          <li>
            <span className="font-medium text-[hsl(var(--fg))]">官方内置</span>
            ：酒馆自带资源，本地复制导入，离线可用
          </li>
          <li>
            <span className="font-medium text-[hsl(var(--fg))]">社区直链</span>
            ：GitHub 公开仓库（Sudachi-Next、社区卡合集等），服务端拉取后入库
          </li>
          <li>
            <span className="font-medium text-[hsl(var(--fg))]">自定义</span>
            ：任意 https 直链或本地上传，不限于下方清单
          </li>
        </ul>
      </div>

      {/* 搜索 + 类型筛选 */}
      <div className="flex flex-col gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索名称 / 描述 / 标签…"
          className="min-h-[36px] w-full rounded-lg border border-[hsl(var(--border-soft))] bg-transparent px-3 text-sm text-[hsl(var(--fg))] placeholder:text-[hsl(var(--fg-muted))] focus:border-[hsl(var(--accent))] focus:outline-none"
        />
        <div className="flex flex-wrap gap-2" role="group" aria-label="类型筛选">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" onClick={() => setFilter(f.id)} className={chip(filter === f.id)}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* 本地上传入口（复用各资产 Tab 的 multipart 导入管道） */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-[hsl(var(--border-soft))] px-3 py-2">
        <span className="flex items-center gap-1 text-xs text-[hsl(var(--fg-muted))]">
          本地上传：先选类型，再选酒馆格式文件（{uploadType === 'characters' ? '.png/.json' : '.json'}）
          <FieldHint text="本地上传不限于下方清单：任何符合酒馆格式的文件（角色卡 PNG/JSON、世界书、预设 JSON）都可以导入。" />
        </span>
        <select
          value={uploadType}
          onChange={(e) => setUploadType(e.target.value as AssetType)}
          className={`min-h-[36px] rounded-lg border border-[hsl(var(--border-soft))] px-2 text-sm ${SELECT_TONE_CLS}`}
          aria-label="选择上传的资产类型"
        >
          {ASSET_META.map((m) => (
            <option key={m.id} value={m.id} className={OPTION_CLS}>
              {m.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="min-h-[36px] rounded-lg border border-[hsl(var(--border-soft))] px-3 text-sm text-[hsl(var(--fg))] hover:border-[hsl(var(--accent))] disabled:opacity-40"
        >
          {uploading ? '上传中…' : '选择文件'}
        </button>
        <input ref={fileRef} type="file" hidden onChange={onUploadFile} />
      </div>

      {/* 索引列表 */}
      {entries === null && <p className="py-6 text-center text-sm text-[hsl(var(--fg-muted))]">加载中…</p>}
      {entries !== null && filtered.length === 0 && (
        <p className="py-6 text-center text-sm text-[hsl(var(--fg-muted))]">没有匹配的资源，换个关键词试试</p>
      )}

      <ul className="flex flex-col gap-2">
        {filtered.map((e) => (
          <li
            key={e.id}
            className="rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] px-3 py-2"
          >
            <div className="flex flex-wrap items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-[hsl(var(--fg))]">{e.name}</p>
                  <span className="rounded-full bg-[hsl(var(--fg-muted))]/10 px-2 py-0.5 text-xs text-[hsl(var(--fg-muted))]">
                    {TYPE_LABEL[e.type]}
                  </span>
                  <span className="rounded-full bg-[hsl(var(--fg-muted))]/10 px-2 py-0.5 text-xs text-[hsl(var(--fg-muted))]">
                    {e.ref.kind === 'builtin' ? '内置' : '远程直链'}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-5 text-[hsl(var(--fg-muted))]">{e.description}</p>
                <p className="mt-1 text-xs text-[hsl(var(--fg-muted))]">
                  来源：{e.source}
                  <span
                    className={`ml-2 rounded px-1.5 py-0.5 text-xs ${
                      e.license === '未标注'
                        ? 'bg-amber-400/15 text-amber-500'
                        : 'bg-emerald-400/15 text-emerald-500'
                    }`}
                  >
                    {e.license}
                  </span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => void onImport(e)}
                disabled={importingId !== null}
                className="min-h-[36px] rounded-lg bg-[hsl(var(--accent))] px-4 text-sm font-medium text-white disabled:opacity-40"
              >
                {importingId === e.id ? '导入中…' : '导入'}
              </button>
              <FieldHint
                tapToExpand
                text={`导入「${e.name}」到资产库：服务端拉取并校验后入库，成功后自动切换到对应标签页。`}
              />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
