/**
 * novel 空态引导（写作台，设计 §7.1；自 WorkViewRouter 拆出）
 *
 * 无章节且未在生成时展示：引导输入剧情指令开更第一章；
 * 含角色卡备选开场（alternate_greetings）一键入库（幂等 upsert）。
 */
import { useEffect, useState } from 'react';
import { aiVersion, type Message } from '@shared/message';
import type { Work } from '@shared/work';

import { upsertMessage } from '../../../api/works';
import { loadAssembleAssets } from '../../../hooks/generation-pipeline';

import { uuid } from '../../../lib/uuid';
interface EmptyGuideProps {
  work: Work;
  onCreated: (m: Message) => void;
}

export default function EmptyGuide({ work, onCreated }: EmptyGuideProps) {
  const [greetings, setGreetings] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    let alive = true;
    loadAssembleAssets(work)
      .then((a) => {
        if (alive) setGreetings(a.cards[0]?.data.alternate_greetings ?? []);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [work]);

  async function importGreeting(text: string): Promise<void> {
    setImporting(true);
    const createdAt = Date.now();
    const message: Message = {
      id: uuid(),
      role: 'assistant',
      name: '小说家',
      content: text,
      createdAt,
      swipes: [aiVersion(text, 'v1', createdAt)],
      swipeId: 0,
      chapter: { index: 1, title: '序章' },
      extra: {},
    };
    try {
      await upsertMessage(work.id, message);
      onCreated(message);
    } catch {
      console.warn('[EmptyGuide] 备选开场上传失败');
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center" data-testid="empty-guide">
      <p className="text-lg font-semibold">《{work.title}》</p>
      <p className="text-sm text-[hsl(var(--fg-muted))]">
        在下方输入剧情指令（可留空），点击「▶ 续写」开始创作第一章
      </p>
      {greetings.length > 0 && (
        <div className="mt-4 w-full max-w-md space-y-2">
          <p className="text-xs text-[hsl(var(--fg-muted))]">或使用角色卡备选开场：</p>
          {greetings.map((g, i) => (
            <button
              key={i}
              type="button"
              disabled={importing}
              onClick={() => importGreeting(g)}
              className="line-clamp-2 w-full rounded-lg border border-[hsl(var(--border-soft))] p-3 text-left text-xs transition-colors hover:border-[hsl(var(--accent))] disabled:opacity-40"
            >
              {g}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
