/**
 * 短剧资产库面板（discuss/2026-11-18-短剧资产库设计.md）
 * 三类资产（角色/场景/风格）列表 + 单项「导入到当前作品」+ 一键「从当前作品提取入库」。
 * MVP：列表不含缩略图（详情区按需展开），导入后由调用方刷新 workbench 项目数据。
 */
import { useCallback, useEffect, useState } from 'react';

import {
  duanjuAssetFileUrl,
  duanjuAssetToWork,
  getDuanjuAsset,
  importDuanjuAssets,
  listDuanjuAssets,
  type DuanjuAssetSummary,
} from '../../../api/duanjuAssets';

type SubTab = 'characters' | 'scenes' | 'styles';

const SUBTABS: ReadonlyArray<{ id: SubTab; label: string }> = [
  { id: 'characters', label: '角色' },
  { id: 'scenes', label: '场景' },
  { id: 'styles', label: '风格' },
];

interface Props {
  workId: string;
  /** 导入作品成功后回调（workbench 刷新 project） */
  onImported?: () => void;
}

interface AssetDetail {
  id: string;
  name: string;
  profile?: string;
  spec?: string;
  style?: string;
  visualSignature?: string;
  sheetImages?: ReadonlyArray<{ id: string; path: string }>;
  images?: ReadonlyArray<{ id: string; path: string }>;
}

const btn = 'h-9 rounded-lg px-3 text-sm transition-colors';
const cardCls = 'flex items-center gap-3 rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] p-3';

export default function AssetLibraryPane({ workId, onImported }: Props) {
  const [sub, setSub] = useState<SubTab>('characters');
  const [items, setItems] = useState<DuanjuAssetSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<AssetDetail | null>(null);
  const [msg, setMsg] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await listDuanjuAssets(sub));
    } catch {
      setMsg('资产列表加载失败');
    } finally {
      setLoading(false);
    }
  }, [sub]);

  useEffect(() => {
    setExpanded(null);
    setDetail(null);
    void reload();
  }, [reload]);

  const toggleDetail = async (id: string): Promise<void> => {
    if (expanded === id) {
      setExpanded(null);
      setDetail(null);
      return;
    }
    setExpanded(id);
    setDetail(null);
    try {
      setDetail(await getDuanjuAsset<AssetDetail>(sub, id));
    } catch {
      setMsg('详情加载失败');
    }
  };

  const importOne = async (id: string, name: string): Promise<void> => {
    setMsg(`正在导入「${name}」…`);
    try {
      await duanjuAssetToWork(sub, id, workId);
      setMsg(`「${name}」已导入作品（同名不覆盖，列表见对应分区）`);
      onImported?.();
    } catch {
      setMsg(`「${name}」导入失败`);
    }
  };

  const extractAll = async (): Promise<void> => {
    setMsg('正在提取当前作品资产…');
    try {
      const r = await importDuanjuAssets(workId, sub);
      setMsg(`提取完成：${r.imported.join('、') || '无可提取内容'}`);
      void reload();
    } catch {
      setMsg('提取失败');
    }
  };

  const detailImages = detail?.sheetImages ?? detail?.images ?? [];

  return (
    <div className="mx-auto w-full max-w-3xl p-3" data-testid="duanju-assets-pane">
      <div className="flex items-center gap-1">
        {SUBTABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setSub(t.id)}
            className={`${btn} ${sub === t.id ? 'bg-[hsl(var(--accent))] text-[hsl(var(--accent-fg))]' : 'text-[hsl(var(--fg-muted))] hover:text-[hsl(var(--fg))]'}`}
          >
            {t.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => void extractAll()}
          className={`${btn} ml-auto border border-[hsl(var(--border-soft))]`}
          data-testid="duanju-assets-extract"
        >
          从当前作品提取入库
        </button>
      </div>

      {msg && <p className="mt-2 text-xs text-[hsl(var(--fg-muted))]">{msg}</p>}
      {loading && <p className="py-16 text-center text-sm text-[hsl(var(--fg-muted))]">加载中…</p>}
      {!loading && items.length === 0 && (
        <p className="py-16 text-center text-sm text-[hsl(var(--fg-muted))]">
          资产库为空——先在其他作品打开本面板，点「从当前作品提取入库」
        </p>
      )}

      <ul className="mt-3 flex flex-col gap-2">
        {items.map((it) => (
          <li key={it.id} className={cardCls}>
            <button
              type="button"
              onClick={() => void toggleDetail(it.id)}
              className="min-w-0 flex-1 text-left"
              data-testid={`duanju-asset-item-${it.id}`}
            >
              <p className="truncate text-sm font-medium">{it.name}</p>
              <p className="text-xs text-[hsl(var(--fg-muted))]">{expanded === it.id ? '收起' : '展开详情'}</p>
            </button>
            <button
              type="button"
              onClick={() => void importOne(it.id, it.name)}
              className={`${btn} shrink-0 bg-[hsl(var(--accent))] text-[hsl(var(--accent-fg))]`}
              data-testid={`duanju-asset-import-${it.id}`}
            >
              导入到本作品
            </button>
          </li>
        ))}
      </ul>

      {expanded && detail && (
        <div className="mt-2 rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] p-3">
          {detail.profile && <p className="whitespace-pre-wrap text-xs leading-5">{detail.profile}</p>}
          {detail.spec && <p className="whitespace-pre-wrap text-xs leading-5">{detail.spec}</p>}
          {detail.style && (
            <p className="text-xs leading-5">
              画风：{detail.style}／签名：{detail.visualSignature}
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            {detailImages.map((im) => (
              <img
                key={im.id}
                src={duanjuAssetFileUrl(sub, detail.id, im.path)}
                alt={detail.name}
                className="h-28 w-auto rounded-lg border border-[hsl(var(--border-soft))]"
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
