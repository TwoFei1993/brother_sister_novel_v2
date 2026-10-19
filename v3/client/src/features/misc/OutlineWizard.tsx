/**
 * 大纲向导（最小版，Task 32）：粘贴网文大纲 → 正则抽取预览（人物/背景/势力/矛盾）
 * → 一键生成角色卡与世界书草稿（POST /api/characters、/api/worldbooks 直接入库）
 * → 成功跳 /library。路由 /wizard（App.tsx）；导航入口由协调者统一挂载。
 */
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { apiFetch } from '../../api/client';
import { parseSheetDocument, type SheetDocument } from '../../lib/outline-sheet';
import {
  buildCardDraft,
  buildWorldbookDraft,
  extractFromOutline,
  type ExtractedOutline,
} from '../../lib/outline-wizard';
import { suggestBookTitles } from '../../lib/export';
import SheetImportPanel from './wizard/SheetImportPanel';

type Toast = { kind: 'ok' | 'err'; text: string } | null;

export default function OutlineWizard() {
  const navigate = useNavigate();
  const [outline, setOutline] = useState('');
  const [extracted, setExtracted] = useState<ExtractedOutline | null>(null);
  const [sheet, setSheet] = useState<SheetDocument | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<Toast>(null);

  const titles = useMemo(() => (extracted ? suggestBookTitles(outline) : []), [extracted, outline]);

  const notify = (kind: 'ok' | 'err', text: string) => setToast({ kind, text });

  /** 粘贴即探测：编号展板条目 ≥3 → 批量人设导入模式；否则保留旧抽取路径 */
  const onOutlineChange = (value: string) => {
    setOutline(value);
    setExtracted(null);
    const doc = parseSheetDocument(value);
    setSheet(doc.entries.length >= 3 ? doc : null);
  };

  const onExtract = () => {
    const out = extractFromOutline(outline);
    setExtracted(out);
    const found = out.characters.length + (out.background ? 1 : 0) + (out.conflict ? 1 : 0);
    notify(found > 0 ? 'ok' : 'err', found > 0 ? `识别出 ${out.characters.length} 位人物及设定要素` : '未识别出有效要素，请检查大纲格式（如"哥哥（名字）：特质"）');
  };

  const postJson = async (path: string, body: unknown): Promise<void> => {
    await apiFetch(path, { method: 'POST', body: JSON.stringify(body) });
  };

  const onCreateCards = async () => {
    if (!extracted) return;
    const names = extracted.characters.map((c) => c.name);
    if (names.length === 0) {
      notify('err', '未抽取到人物，无法生成角色卡');
      return;
    }
    setBusy(true);
    try {
      for (const name of names) {
        await postJson('/api/characters', { name, card: buildCardDraft(extracted, name) });
      }
      notify('ok', `已生成 ${names.length} 张角色卡草稿，正在跳转资产库…`);
      window.setTimeout(() => navigate('/library'), 800);
    } catch (err) {
      notify('err', err instanceof Error ? err.message : '角色卡生成失败');
    } finally {
      setBusy(false);
    }
  };

  const onCreateWorldbook = async () => {
    if (!extracted) return;
    setBusy(true);
    try {
      const draft = buildWorldbookDraft(extracted);
      if (Object.keys(draft.raw.entries).length === 0) {
        notify('err', '未抽取到背景/势力/矛盾，无法生成世界书');
        return;
      }
      await postJson('/api/worldbooks', draft);
      notify('ok', '已生成世界书草稿，正在跳转资产库…');
      window.setTimeout(() => navigate('/library'), 800);
    } catch (err) {
      notify('err', err instanceof Error ? err.message : '世界书生成失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="safe-top safe-bottom mx-auto min-h-screen w-full max-w-2xl bg-[hsl(var(--bg))] px-4 pb-16 text-[hsl(var(--fg))]">
      <header className="mb-4 flex items-center gap-3 pt-2">
        <Link
          to="/"
          aria-label="返回书架"
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-[hsl(var(--border-soft))] text-lg transition-colors hover:border-[hsl(var(--accent))]"
        >
          ←
        </Link>
        <h1 className="text-xl font-semibold">大纲向导</h1>
        <span className="text-xs text-[hsl(var(--fg-muted))]">粘贴大纲，一键生成角色卡与世界书草稿</span>
      </header>

      {toast && (
        <div
          role="status"
          className={`mb-4 rounded-lg border px-3 py-2 text-sm ${
            toast.kind === 'ok'
              ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-500'
              : 'border-red-400/40 bg-red-400/10 text-red-400'
          }`}
        >
          {toast.text}
        </div>
      )}

      <section className="mb-4">
        <textarea
          aria-label="大纲文本"
          value={outline}
          onChange={(e) => onOutlineChange(e.target.value)}
          placeholder={'粘贴网文大纲或「编号人设展板」文档，例如：\n一、故事背景：灵气复苏的大周王朝…\n哥哥（林昭）：天赋觉醒古龙血脉，性格沉稳…\n——或——\n01. 沈清晏｜镇国公府嫡长女（女主）\n正向 prompt：\n…（批量人设将自动识别）'}
          rows={10}
          className="w-full rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] p-3 text-sm leading-relaxed outline-none focus:border-[hsl(var(--accent))]"
        />
        {!sheet && (
          <button
            type="button"
            onClick={onExtract}
            disabled={!outline.trim()}
            className="mt-2 min-h-[36px] rounded-lg bg-[hsl(var(--accent))] px-4 text-sm font-medium text-white disabled:opacity-40"
          >
            智能抽取
          </button>
        )}
      </section>

      {sheet && (
        <SheetImportPanel
          sheet={sheet}
          onFinished={(ok, failed) => {
            notify(
              failed.length > 0 ? 'err' : 'ok',
              failed.length > 0 ? `成功 ${ok} 张，失败：${failed.join('、')}` : `已生成 ${ok} 张角色卡，正在跳转资产库…`,
            );
            if (failed.length === 0) window.setTimeout(() => navigate('/library'), 800);
          }}
        />
      )}

      {!sheet && extracted && (
        <section aria-label="抽取预览" className="flex flex-col gap-3">
          {extracted.characters.length > 0 && (
            <div className="rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] p-3">
              <p className="mb-2 text-sm font-medium">人物（{extracted.characters.length}）</p>
              <ul className="flex flex-col gap-2">
                {extracted.characters.map((c) => (
                  <li key={c.name} className="rounded-lg border border-[hsl(var(--border-soft))] px-3 py-2 text-xs">
                    <p className="text-sm font-medium">
                      {c.name}
                      {c.role !== c.name && <span className="ml-2 text-[hsl(var(--fg-muted))]">（{c.role}）</span>}
                    </p>
                    {c.traits.length > 0 && (
                      <p className="mt-1 text-[hsl(var(--fg-muted))]">{c.traits.join(' · ')}</p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {extracted.background && (
            <div className="rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] p-3 text-xs">
              <p className="mb-1 text-sm font-medium">背景</p>
              <p className="text-[hsl(var(--fg-muted))]">{extracted.background}</p>
            </div>
          )}
          {extracted.factions.length > 0 && (
            <div className="rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] p-3 text-xs">
              <p className="mb-1 text-sm font-medium">势力</p>
              <p className="text-[hsl(var(--fg-muted))]">{extracted.factions.join('；')}</p>
            </div>
          )}
          {extracted.conflict && (
            <div className="rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] p-3 text-xs">
              <p className="mb-1 text-sm font-medium">核心矛盾</p>
              <p className="text-[hsl(var(--fg-muted))]">{extracted.conflict}</p>
            </div>
          )}
          {titles.length > 0 && (
            <div className="rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] p-3 text-xs">
              <p className="mb-1 text-sm font-medium">书名建议</p>
              <p className="text-[hsl(var(--fg-muted))]">{titles.join(' / ')}</p>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void onCreateCards()}
              disabled={busy}
              className="min-h-[36px] rounded-lg bg-[hsl(var(--accent))] px-4 text-sm font-medium text-white disabled:opacity-40"
            >
              生成角色卡草稿
            </button>
            <button
              type="button"
              onClick={() => void onCreateWorldbook()}
              disabled={busy}
              className="min-h-[36px] rounded-lg border border-[hsl(var(--border-soft))] px-4 text-sm font-medium text-[hsl(var(--fg))] hover:border-[hsl(var(--accent))] disabled:opacity-40"
            >
              生成世界书草稿
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
