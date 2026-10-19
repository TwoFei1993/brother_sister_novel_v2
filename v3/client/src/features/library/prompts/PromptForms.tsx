/**
 * 提示词管理器配套表单：新建自定义提示词 + 从预设 JSON 粘贴导入
 *
 * 粘贴导入走「新建资产」路径：前端把粘贴文本包装成 File，
 * 复用与文件导入相同的 multipart 端点（/api/io/presets/import），
 * 服务端 normalize（prompt_order 取 character_id=100001）后入库为新预设。
 */
import { useState } from 'react';

import type { TavernPrompt } from '@shared/tavern';

import { importAsset } from '../../../api/library';
import { OPTION_CLS, SELECT_TONE_CLS } from '../../../components/ui-select';

const ROLES = ['system', 'user', 'assistant'] as const;

// ---------- 新建提示词 ----------

export interface NewPromptFormProps {
  onCreate: (prompt: Pick<TavernPrompt, 'name' | 'content' | 'role'>) => void;
}

export function NewPromptForm({ onCreate }: NewPromptFormProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [role, setRole] = useState<(typeof ROLES)[number]>('system');
  const [content, setContent] = useState('');

  const submit = () => {
    if (!name.trim() || !content.trim()) return;
    onCreate({ name: name.trim(), role, content });
    setName('');
    setContent('');
    setRole('system');
    setOpen(false);
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-[36px] rounded-lg border border-[hsl(var(--border-soft))] px-3 text-sm text-[hsl(var(--fg))] hover:border-[hsl(var(--accent))]"
      >
        ＋ 新建提示词
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] p-3">
      <div className="flex gap-2">
        <input
          aria-label="新提示词名称"
          placeholder="名称"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="min-h-[36px] flex-1 rounded-lg border border-[hsl(var(--border-soft))] bg-transparent px-2 text-sm text-[hsl(var(--fg))]"
        />
        <select
          aria-label="新提示词角色"
          value={role}
          onChange={(e) => setRole(e.target.value as (typeof ROLES)[number])}
          className={`min-h-[36px] w-28 rounded-lg border border-[hsl(var(--border-soft))] px-2 text-sm ${SELECT_TONE_CLS}`}
        >
          {ROLES.map((r) => (
            <option key={r} value={r} className={OPTION_CLS}>
              {r}
            </option>
          ))}
        </select>
      </div>
      <textarea
        aria-label="新提示词内容"
        placeholder="内容"
        rows={3}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        className="w-full rounded-lg border border-[hsl(var(--border-soft))] bg-transparent px-2 py-1.5 text-sm text-[hsl(var(--fg))]"
      />
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="min-h-[36px] rounded-lg px-3 text-sm text-[hsl(var(--fg-muted))]"
        >
          取消
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!name.trim() || !content.trim()}
          className="min-h-[36px] rounded-lg bg-[hsl(var(--accent))] px-3 text-sm font-medium text-white disabled:opacity-40"
        >
          添加
        </button>
      </div>
    </div>
  );
}

// ---------- 从预设 JSON 粘贴导入 ----------

export interface PasteImportFormProps {
  onImported: (id: string, name: string) => void;
  onError: (message: string) => void;
}

export function PasteImportForm({ onImported, onError }: PasteImportFormProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      onError('粘贴的内容不是合法 JSON');
      return;
    }
    if (typeof parsed !== 'object' || parsed === null) {
      onError('粘贴的内容不是预设 JSON 对象');
      return;
    }
    setBusy(true);
    try {
      const file = new File([text], `paste-${Date.now()}.json`, { type: 'application/json' });
      const asset = await importAsset('presets', file);
      setText('');
      setOpen(false);
      onImported(asset.id, asset.name);
    } catch (err) {
      onError(err instanceof Error ? err.message : '粘贴导入失败');
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-[36px] rounded-lg border border-[hsl(var(--border-soft))] px-3 text-sm text-[hsl(var(--fg))] hover:border-[hsl(var(--accent))]"
      >
        📋 从 JSON 粘贴导入
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] p-3">
      <p className="text-xs text-[hsl(var(--fg-muted))]">
        粘贴酒馆预设 JSON（prompts + prompt_order），将作为新预设导入。
      </p>
      <textarea
        aria-label="粘贴预设 JSON"
        rows={6}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder='{"prompts": [...], "prompt_order": [...]}'
        className="w-full rounded-lg border border-[hsl(var(--border-soft))] bg-transparent px-2 py-1.5 font-mono text-xs text-[hsl(var(--fg))]"
      />
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="min-h-[36px] rounded-lg px-3 text-sm text-[hsl(var(--fg-muted))]"
        >
          取消
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={busy || !text.trim()}
          className="min-h-[36px] rounded-lg bg-[hsl(var(--accent))] px-3 text-sm font-medium text-white disabled:opacity-40"
        >
          {busy ? '导入中…' : '导入为新预设'}
        </button>
      </div>
    </div>
  );
}
