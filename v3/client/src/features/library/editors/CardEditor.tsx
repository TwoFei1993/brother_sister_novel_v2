/**
 * 角色卡编辑器（Task 27）
 *
 * V2/V3 卡 data 全字段表单：基础人设五件套 + 备用问候（alternate_greetings 增删）
 * + creator_notes/system_prompt/post_history_instructions + 深度人设
 * （extensions.depth_prompt: prompt/depth/role）。
 * 保存：PATCH /api/characters/:id 整体替换 card，并同步壳层 name
 * （server 导入约定：name 冗余自 card.data.name）。
 */
import { useEffect, useRef, useState } from 'react';
import type { TavernCardV2 } from '@shared/tavern';
import type { CharacterAsset } from '@shared/card';

import { apiFetch } from '../../../api/client';

import EditorShell, { NumberField, SelectField, TextField } from './EditorShell';

const getCharacter = (id: string): Promise<CharacterAsset> => apiFetch<CharacterAsset>(`/api/characters/${id}`);

const updateCharacter = (id: string, card: TavernCardV2, name: string): Promise<CharacterAsset> =>
  apiFetch<CharacterAsset>(`/api/characters/${id}`, { method: 'PATCH', body: JSON.stringify({ card, name }) });

/** depth_prompt.role：V2 spec 为字符串枚举 */
const DP_ROLE_OPTIONS = [
  { value: 'system', label: 'system' },
  { value: 'user', label: 'user' },
  { value: 'assistant', label: 'assistant' },
] as const;

export interface CardEditorProps {
  characterId: string;
  onClose: () => void;
  /** 保存成功后回调（父级刷新列表摘要） */
  onSaved: () => void;
  notify: (kind: 'ok' | 'err', text: string) => void;
}

export default function CardEditor({ characterId, onClose, onSaved, notify }: CardEditorProps) {
  const [card, setCard] = useState<TavernCardV2 | null>(null);
  const [avatar, setAvatar] = useState<string | undefined>(undefined);
  const [fallbackName, setFallbackName] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const notifyRef = useRef(notify);
  notifyRef.current = notify;

  useEffect(() => {
    let alive = true;
    setCard(null);
    setDirty(false);
    getCharacter(characterId)
      .then((asset) => {
        if (!alive) return;
        setCard(asset.card);
        setAvatar(asset.avatar);
        setFallbackName(asset.name);
      })
      .catch((err: unknown) => {
        notifyRef.current('err', err instanceof Error ? err.message : '角色卡加载失败');
      });
    return () => {
      alive = false;
    };
  }, [characterId]);

  const data = card?.data;

  const patchData = (patch: Partial<NonNullable<TavernCardV2['data']>>) => {
    setCard((prev) => (prev ? { ...prev, data: { ...prev.data, ...patch } } : prev));
    setDirty(true);
  };

  const patchDepthPrompt = (patch: { prompt?: string; depth?: number; role?: string }) => {
    setCard((prev) => {
      if (!prev) return prev;
      const dp = prev.data.extensions?.depth_prompt ?? {};
      return {
        ...prev,
        data: {
          ...prev.data,
          extensions: {
            ...prev.data.extensions,
            depth_prompt: {
              prompt: patch.prompt ?? dp.prompt ?? '',
              depth: patch.depth ?? (typeof dp.depth === 'number' ? dp.depth : 4),
              role: patch.role ?? (typeof dp.role === 'string' ? dp.role : 'system'),
            },
          },
        },
      };
    });
    setDirty(true);
  };

  // ---------- alternate_greetings 增删改 ----------
  const greetings = data?.alternate_greetings ?? [];

  const setGreetings = (next: string[]) => {
    patchData({ alternate_greetings: next });
  };

  const handleSave = async () => {
    if (!card) return;
    setSaving(true);
    try {
      await updateCharacter(characterId, card, typeof data?.name === 'string' && data.name ? data.name : fallbackName);
      setDirty(false);
      notifyRef.current('ok', '角色卡已保存');
      onSaved();
    } catch (err) {
      notifyRef.current('err', err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const s = (v: string | null | undefined): string => (typeof v === 'string' ? v : '');

  return (
    <EditorShell
      title={`角色卡 · ${s(data?.name) || fallbackName || characterId}`}
      dirty={dirty}
      saving={saving}
      onClose={onClose}
      onSave={() => void handleSave()}
    >
      {!card || !data ? (
        <p className="p-8 text-center text-sm text-[hsl(var(--fg-muted))]">角色卡加载中…</p>
      ) : (
        <div className="mx-auto flex max-w-2xl flex-col gap-3 p-4">
          {avatar && (
            <img
              src={avatar}
              alt={`${s(data.name) || fallbackName} 头像`}
              data-testid="card-avatar"
              onError={(e) => setAvatar(undefined)}
              className="h-16 w-16 rounded-full object-cover"
            />
          )}

          <TextField label="名字" tip="角色名（data.name），保存后同步列表显示名" value={s(data.name)} onChange={(name) => patchData({ name })} />
          <TextField label="人设描述" tip="角色卡描述：角色的外貌/性格/背景设定，每轮注入给 AI（description）" textarea rows={8} value={s(data.description)} onChange={(description) => patchData({ description })} />
          <TextField label="性格" tip="性格摘要（personality）" textarea rows={3} value={s(data.personality)} onChange={(personality) => patchData({ personality })} />
          <TextField label="场景" tip="开场场景设定（scenario）" textarea rows={3} value={s(data.scenario)} onChange={(scenario) => patchData({ scenario })} />
          <TextField label="开场白" tip="第一条消息：对话开场时角色说的第一段话（first_mes）" textarea rows={6} value={s(data.first_mes)} onChange={(first_mes) => patchData({ first_mes })} />

          {/* 备用问候 */}
          <fieldset data-testid="alternate-greetings" className="rounded-xl border border-[hsl(var(--border-soft))] p-3">
            <legend className="px-1 text-xs text-[hsl(var(--fg-muted))]">备用开场白（alternate_greetings，swipe 切换）</legend>
            <div className="flex flex-col gap-3">
              {greetings.map((g, i) => (
                <div key={i} data-testid="alternate-greeting" className="flex flex-col gap-1">
                  <TextField
                    label={`备用开场白 ${i + 1}`}
                    textarea
                    rows={4}
                    value={g}
                    onChange={(v) => setGreetings(greetings.map((old, j) => (j === i ? v : old)))}
                  />
                  <button
                    type="button"
                    aria-label={`删除备用开场白 ${i + 1}`}
                    onClick={() => setGreetings(greetings.filter((_, j) => j !== i))}
                    className="self-start rounded-lg border border-red-400/40 px-3 py-1 text-xs text-red-400 hover:bg-red-400/10"
                  >
                    删除
                  </button>
                </div>
              ))}
              <button
                type="button"
                data-testid="greeting-add"
                onClick={() => setGreetings([...greetings, ''])}
                className="self-start rounded-lg border border-[hsl(var(--border-soft))] px-3 py-1.5 text-xs text-[hsl(var(--fg))] hover:border-[hsl(var(--accent))]"
              >
                + 添加备用开场白
              </button>
            </div>
          </fieldset>

          <TextField label="对话示例" tip="few-shot 对话样例（mes_example），<START> 分隔" textarea rows={5} value={s(data.mes_example)} onChange={(mes_example) => patchData({ mes_example })} />
          <TextField label="创作者注释" tip="卡片作者给使用者的说明（creator_notes）" textarea rows={3} value={s(data.creator_notes)} onChange={(creator_notes) => patchData({ creator_notes })} />
          <TextField label="系统提示词覆写" tip="作用：整段替换预设的主提示词（system_prompt），一般留空以使用预设默认" textarea rows={3} value={s(data.system_prompt)} onChange={(system_prompt) => patchData({ system_prompt })} />
          <TextField label="历史后注入" tip="作用：注入在聊天历史之后的收尾指令（post_history_instructions），离生成最近、影响最大" textarea rows={3} value={s(data.post_history_instructions)} onChange={(post_history_instructions) => patchData({ post_history_instructions })} />

          {/* 深度人设 extensions.depth_prompt */}
          <fieldset data-testid="depth-prompt" className="rounded-xl border border-[hsl(var(--border-soft))] p-3">
            <legend className="px-1 text-xs text-[hsl(var(--fg-muted))]">深度人设（depth_prompt，按深度注入对话）</legend>
            <div className="flex flex-col gap-3">
              <TextField
                label="内容"
                tip="注入的补充人设文本"
                textarea
                rows={3}
                value={s(data.extensions?.depth_prompt?.prompt)}
                onChange={(prompt) => patchDepthPrompt({ prompt })}
              />
              <div className="grid grid-cols-2 gap-3">
                <NumberField
                  label="深度"
                  tip="距对话末尾的层数"
                  value={typeof data.extensions?.depth_prompt?.depth === 'number' ? data.extensions.depth_prompt.depth : 4}
                  onChange={(depth) => patchDepthPrompt({ depth: depth ?? 4 })}
                  min={0}
                />
                <SelectField
                  label="角色"
                  tip="注入消息的角色"
                  value={typeof data.extensions?.depth_prompt?.role === 'string' ? data.extensions.depth_prompt.role : 'system'}
                  onChange={(role) => patchDepthPrompt({ role })}
                  options={DP_ROLE_OPTIONS}
                />
              </div>
            </div>
          </fieldset>
        </div>
      )}
    </EditorShell>
  );
}
