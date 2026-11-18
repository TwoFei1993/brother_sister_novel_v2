/**
 * 物品道具编辑器（用户需求：物品资料卡描述具体到质感/形状/颜色/功能/承载感情）
 *
 * 新建（itemId=null）与编辑共用；EditorShell 全屏弹层 + TextField 字段原语，
 * 与世界书/角色卡一致的保存动线。name 必填，其余可留空（注入时只拼非空段）。
 */
import { useEffect, useState } from 'react';

import { createItem, getItem, updateItem, type ItemAsset } from '../../../api/library';

import EditorShell, { TextField } from '../editors/EditorShell';

interface ItemEditorProps {
  /** null=新建 */
  itemId: string | null;
  notify: (kind: 'ok' | 'err', text: string) => void;
  onClose: () => void;
  onSaved: () => void;
}

type ItemDraft = Omit<ItemAsset, 'id' | 'createdAt' | 'origin'>;

const EMPTY: ItemDraft = { name: '', summary: '', texture: '', shape: '', color: '', usage: '', emotion: '', notes: '' };

export default function ItemEditor({ itemId, notify, onClose, onSaved }: ItemEditorProps) {
  const [draft, setDraft] = useState<ItemDraft>(EMPTY);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(itemId !== null);

  useEffect(() => {
    if (itemId === null) return;
    let alive = true;
    getItem(itemId)
      .then((it) => {
        if (!alive) return;
        const { id: _id, createdAt: _at, origin: _origin, ...rest } = it;
        setDraft({ ...EMPTY, ...rest });
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        notify('err', '物品加载失败');
        onClose();
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);

  const set = (patch: Partial<ItemDraft>): void => {
    setDraft((prev) => ({ ...prev, ...patch }));
    setDirty(true);
  };

  async function save(): Promise<void> {
    if (!draft.name.trim()) {
      notify('err', '物品名不能为空');
      return;
    }
    setSaving(true);
    try {
      if (itemId === null) {
        await createItem(draft);
        notify('ok', `已创建物品「${draft.name}」`);
      } else {
        await updateItem(itemId, draft);
        notify('ok', `已保存「${draft.name}」`);
      }
      onSaved();
      onClose();
    } catch (err) {
      notify('err', err instanceof Error ? err.message : '保存失败，请重试');
    } finally {
      setSaving(false);
    }
  }

  return (
    <EditorShell title={itemId === null ? '新建物品道具' : '编辑物品道具'} dirty={dirty} saving={saving} onClose={onClose} onSave={() => void save()}>
      <div className="mx-auto flex max-w-2xl flex-col gap-3 p-4">
        {loading ? (
          <p className="py-6 text-center text-sm text-[hsl(var(--fg-muted))]">加载中…</p>
        ) : (
          <>
            <TextField label="物品名" value={draft.name} onChange={(v) => set({ name: v })} placeholder="如：母亲的银锁" />
            <TextField
              label="一句话定位"
              tip="这是什么、特殊在哪；生成时的引导句"
              value={draft.summary}
              onChange={(v) => set({ summary: v })}
              textarea
              rows={2}
              placeholder="如：妹妹随身携带的旧银锁，锁内藏着母亲留下的字条"
            />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <TextField label="质感" tip="触感/材质" value={draft.texture ?? ''} onChange={(v) => set({ texture: v })} placeholder="温润的羊脂玉触感" />
              <TextField label="形状" tip="外形/尺寸/结构" value={draft.shape ?? ''} onChange={(v) => set({ shape: v })} placeholder="拇指大小的圆锁，环刻缠枝纹" />
              <TextField label="颜色" tip="色彩与光泽" value={draft.color ?? ''} onChange={(v) => set({ color: v })} placeholder="月白色，泛淡银光" />
            </div>
            <TextField
              label="功能"
              tip="用途/能力/机制（含限制与代价）"
              value={draft.usage ?? ''}
              onChange={(v) => set({ usage: v })}
              textarea
              rows={2}
              placeholder="如：贴身佩戴时能安抚异能反噬；离开身体超过一炷香即失效"
            />
            <TextField
              label="承载的感情"
              tip="情感意义/回忆/羁绊——驱动剧情的钩子"
              value={draft.emotion ?? ''}
              onChange={(v) => set({ emotion: v })}
              textarea
              rows={2}
              placeholder="如：母亲唯一的遗物，妹妹视为不能失去的护身符"
            />
            <TextField label="其他备注" tip="来历/禁忌/伏笔等自由补充" value={draft.notes ?? ''} onChange={(v) => set({ notes: v })} textarea rows={2} placeholder="" />
          </>
        )}
      </div>
    </EditorShell>
  );
}
