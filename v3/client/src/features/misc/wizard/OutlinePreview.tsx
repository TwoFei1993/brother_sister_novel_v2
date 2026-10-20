/**
 * 普通大纲抽取预览：人物 / 背景 / 势力 / 矛盾 / 书名建议展示 + 生成按钮。
 * 规则来源只读（与既有行为一致）；AI 来源（editable）字段可编辑修正后再生成的
 * 卡片与世界书使用修正后的值。编辑即时回调父级（onChange 更新 llmResult）。
 */
import type { ExtractedOutline } from '../../../lib/outline/wizard';

interface Props {
  extracted: ExtractedOutline;
  /** AI 来源时可编辑（规则来源保持只读） */
  editable: boolean;
  titles: string[];
  busy: boolean;
  onChange: (next: ExtractedOutline) => void;
  onCreateCards: () => void;
  onCreateWorldbook: () => void;
}

const inputCls =
  'w-full rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] p-2 text-xs outline-none focus:border-[hsl(var(--accent))]';

export default function OutlinePreview({
  extracted,
  editable,
  titles,
  busy,
  onChange,
  onCreateCards,
  onCreateWorldbook,
}: Props) {
  const patch = (p: Partial<ExtractedOutline>): void => onChange({ ...extracted, ...p });

  return (
    <section aria-label="抽取预览" className="flex flex-col gap-3">
      {extracted.characters.length > 0 && (
        <div className="rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] p-3">
          <p className="mb-2 text-sm font-medium">人物（{extracted.characters.length}）</p>
          <ul className="flex flex-col gap-2">
            {extracted.characters.map((c, i) => (
              <li key={`${c.name}-${i}`} className="rounded-lg border border-[hsl(var(--border-soft))] px-3 py-2 text-xs">
                {editable ? (
                  <div className="flex flex-col gap-1.5">
                    <div className="flex gap-2">
                      <input
                        aria-label={`第${i + 1}位人物名`}
                        value={c.name}
                        onChange={(e) =>
                          patch({ characters: extracted.characters.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })
                        }
                        className={`${inputCls} max-w-[8rem] font-medium`}
                      />
                      <input
                        aria-label={`第${i + 1}位人物身份`}
                        value={c.role}
                        onChange={(e) =>
                          patch({ characters: extracted.characters.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)) })
                        }
                        className={`${inputCls} max-w-[8rem]`}
                      />
                    </div>
                    <input
                      aria-label={`第${i + 1}位人物特质（顿号分隔）`}
                      value={c.traits.join('、')}
                      onChange={(e) =>
                        patch({
                          characters: extracted.characters.map((x, j) =>
                            j === i ? { ...x, traits: e.target.value.split(/[、,，]/).map((s) => s.trim()).filter(Boolean) } : x,
                          ),
                        })
                      }
                      className={inputCls}
                    />
                  </div>
                ) : (
                  <>
                    <p className="text-sm font-medium">
                      {c.name}
                      {c.role !== c.name && <span className="ml-2 text-[hsl(var(--fg-muted))]">（{c.role}）</span>}
                    </p>
                    {c.traits.length > 0 && <p className="mt-1 text-[hsl(var(--fg-muted))]">{c.traits.join(' · ')}</p>}
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {(extracted.background || editable) && (
        <div className="rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] p-3 text-xs">
          <p className="mb-1 text-sm font-medium">背景</p>
          {editable ? (
            <textarea
              aria-label="背景编辑"
              value={extracted.background}
              onChange={(e) => patch({ background: e.target.value })}
              rows={3}
              className={inputCls}
            />
          ) : (
            <p className="text-[hsl(var(--fg-muted))]">{extracted.background}</p>
          )}
        </div>
      )}
      {(extracted.ability || editable) && (
        <div className="rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] p-3 text-xs">
          <p className="mb-1 text-sm font-medium">金手指/特殊能力</p>
          {editable ? (
            <textarea
              aria-label="金手指/特殊能力编辑"
              value={extracted.ability ?? ''}
              onChange={(e) => patch({ ability: e.target.value })}
              rows={3}
              className={inputCls}
            />
          ) : (
            <p className="text-[hsl(var(--fg-muted))]">{extracted.ability}</p>
          )}
        </div>
      )}
      {(extracted.chapters?.length ?? 0) > 0 && (
        <div className="rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] p-3 text-xs">
          <p className="mb-1 text-sm font-medium">章节大纲（识别到 {extracted.chapters?.length} 章）</p>
          <ul className="flex flex-col gap-0.5 text-[hsl(var(--fg-muted))]">
            {extracted.chapters?.slice(0, 5).map((c) => (
              <li key={c.index}>
                第{c.index}章 {c.title}
              </li>
            ))}
            {(extracted.chapters?.length ?? 0) > 5 && <li>…等共 {extracted.chapters?.length} 章</li>}
          </ul>
        </div>
      )}
      {extracted.factions.length > 0 && (
        <div className="rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] p-3 text-xs">
          <p className="mb-1 text-sm font-medium">势力</p>
          {editable ? (
            <input
              aria-label="势力编辑（分号分隔多条）"
              value={extracted.factions.join('；')}
              onChange={(e) => patch({ factions: e.target.value.split(/[；;]/).map((s) => s.trim()).filter(Boolean) })}
              className={inputCls}
            />
          ) : (
            <p className="text-[hsl(var(--fg-muted))]">{extracted.factions.join('；')}</p>
          )}
        </div>
      )}
      {(extracted.conflict || editable) && (
        <div className="rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] p-3 text-xs">
          <p className="mb-1 text-sm font-medium">核心矛盾</p>
          {editable ? (
            <textarea
              aria-label="核心矛盾编辑"
              value={extracted.conflict}
              onChange={(e) => patch({ conflict: e.target.value })}
              rows={3}
              className={inputCls}
            />
          ) : (
            <p className="text-[hsl(var(--fg-muted))]">{extracted.conflict}</p>
          )}
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
          onClick={onCreateCards}
          disabled={busy}
          className="min-h-[36px] rounded-lg bg-[hsl(var(--accent))] px-4 text-sm font-medium text-white disabled:opacity-40"
        >
          生成角色卡草稿
        </button>
        <button
          type="button"
          onClick={onCreateWorldbook}
          disabled={busy}
          className="min-h-[36px] rounded-lg border border-[hsl(var(--border-soft))] px-4 text-sm font-medium text-[hsl(var(--fg))] hover:border-[hsl(var(--accent))] disabled:opacity-40"
        >
          生成世界书草稿
        </button>
      </div>
    </section>
  );
}
