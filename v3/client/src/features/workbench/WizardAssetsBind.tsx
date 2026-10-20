/**
 * 绑定向导最近资产（用户实测反馈⑥追问）：读取 localStorage 中向导最近一次导入的
 * 角色卡/世界书 ids，一键合并绑定到当前作品（concat 去重，保留已有绑定）。
 * 无最近资产或已全部绑定时不渲染按钮。
 */
import { useMemo, useState } from 'react';

import { bindAssetsToWork, readLastAssets } from '../misc/wizard/importAll';
import type { Work } from '@shared/work';

interface Props {
  work: Work;
  /** 绑定成功回调（父级同步 store） */
  onSaved: (work: Work) => void;
}

export default function WizardAssetsBind({ work, onSaved }: Props) {
  const last = useMemo(() => readLastAssets(), []);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const newChars = (last?.characterIds ?? []).filter((id) => !work.characterIds.includes(id));
  const newBooks = (last?.worldbookIds ?? []).filter((id) => !work.worldbookIds.includes(id));
  if (!last || (newChars.length === 0 && newBooks.length === 0)) return null;

  const bind = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const updated = await bindAssetsToWork(work.id, {
        characterIds: newChars,
        worldbookIds: newBooks,
      });
      onSaved(updated);
      setMsg({ kind: 'ok', text: `已绑定 ${newChars.length} 张角色卡、${newBooks.length} 本世界书` });
    } catch (err) {
      setMsg({
        kind: 'err',
        text: err instanceof Error ? `绑定失败：${err.message}` : '绑定失败，请稍后重试',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-2" data-testid="wizard-assets-bind">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">绑定向导最近资产</p>
          <p className="text-xs text-[hsl(var(--fg-muted))]">
            {last.characterNames.length > 0 && `角色卡：${last.characterNames.join('、')}；`}
            {last.worldbookNames.length > 0 && `世界书：${last.worldbookNames.join('、')}`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void bind()}
          disabled={busy}
          data-testid="bind-wizard-assets"
          className="min-h-[36px] shrink-0 rounded-lg bg-[hsl(var(--accent))] px-4 text-sm font-medium text-white disabled:opacity-40"
        >
          {busy ? '绑定中…' : '一键绑定'}
        </button>
      </div>
      {msg && (
        <p role="status" className={`text-xs ${msg.kind === 'ok' ? 'text-emerald-500' : 'text-[hsl(var(--danger))]'}`}>
          {msg.text}
        </p>
      )}
    </section>
  );
}
