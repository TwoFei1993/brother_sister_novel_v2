/**
 * chat 模式工作区（设计 §4.3 / §7.1）：ChatView + MemberBar + useChatGenerate 集成层
 *
 * - 成员：work.characterIds 绑定的角色卡（按绑定顺序），listCharacters 解析 {id,name}
 * - lastSpeakerId：最后一条 assistant 消息 name 匹配成员（自然轮换基准）
 * - onSend：pickSpeaker（手动指定 > 提及 > 轮换）→ sendMessage → turn.user/assistant 依次 upsertLocal
 * - swipe：store updateSwipe（本地 + PATCH，失败回滚）；重roll：swipeRegenerate 追加候选
 * - 断流「继续」：半成品 + 最后一条用户消息重组上下文（§9.1/§9.2）
 * - 空成员：引导去作品设置绑定角色卡（不渲染对话视图）
 */
import { useEffect, useMemo, useState } from 'react';
import type { Work } from '@shared/work';

import { listCharacters } from '../../api/library';
import { pickSpeaker, type ChatMember } from '../../engine/prompt/activation';
import { useGenerationStore } from '../../stores/generation';
import { useWorkStore } from '../../stores/work';

import ChatView from './ChatView';
import type { ChatTurn } from './chat-flow';
import { useChatGenerate } from './useChatGenerate';

/** 成员加载失败/为空时的引导态 */
function EmptyMembers(): React.ReactElement {
  return (
    <div className="flex flex-1 items-center justify-center px-6 text-center" data-testid="chat-no-members">
      <p className="text-sm text-[hsl(var(--fg-muted))]">
        还没有可对话的角色——请打开右上角 ⚙ 作品设置，绑定至少一张角色卡
      </p>
    </div>
  );
}

export default function ChatWorkspace({ work }: { work: Work }) {
  const messages = useWorkStore((s) => s.messages);
  const upsertLocal = useWorkStore((s) => s.upsertLocal);
  const chat = useChatGenerate(work, messages);
  const [members, setMembers] = useState<ChatMember[]>([]);
  const [manualPickId, setManualPickId] = useState<string | null>(null);

  // 解析绑定角色为对话成员（按绑定顺序；失败静默 → 空成员引导态）
  useEffect(() => {
    let alive = true;
    listCharacters()
      .then((list) => {
        if (!alive) return;
        const byId = new Map(list.map((c) => [c.id, c]));
        setMembers(
          work.characterIds
            .map((id) => byId.get(id))
            .filter((c): c is NonNullable<typeof c> => c !== undefined)
            .map((c) => ({ id: c.id, name: c.name })),
        );
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [work.characterIds]);

  // 自然轮换基准：最后一条 assistant 消息的 name 匹配成员（不匹配视为无基准）
  const lastSpeakerId = useMemo<string | null>(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i];
      if (m.role !== 'assistant') continue;
      return members.find((mem) => mem.name === m.name)?.id ?? null;
    }
    return null;
  }, [messages, members]);

  /** 生成完成后本地同步：user 先 assistant 后（与入库时序一致） */
  function syncTurn(turn: ChatTurn | null): void {
    if (!turn) return;
    if (turn.user) upsertLocal(turn.user);
    upsertLocal(turn.assistant);
  }

  async function handleSend(text: string): Promise<void> {
    if (members.length === 0) return;
    const speaker = pickSpeaker(members, lastSpeakerId, text, manualPickId);
    syncTurn(await chat.sendMessage(text, speaker));
  }

  /** 断流继续：半成品 + 最后一条用户消息（轮换基准不变） */
  async function handleContinue(): Promise<void> {
    if (members.length === 0) return;
    const partial = useGenerationStore.getState().buffer;
    const lastUserText = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
    const speaker = pickSpeaker(members, lastSpeakerId, lastUserText, manualPickId);
    syncTurn(await chat.continueFromPartial(partial, lastUserText, speaker));
  }

  /** ◀▶ 切候选：updateSwipe 本地即改 + PATCH（失败回滚在 store 内） */
  async function handleSwipe(messageId: string, dir: 1 | -1): Promise<void> {
    if (chat.streaming) return;
    const m = useWorkStore.getState().messages.find((x) => x.id === messageId);
    if (!m || m.swipes.length < 2) return;
    const n = m.swipes.length;
    await useWorkStore.getState().updateSwipe(messageId, (m.swipeId + dir + n) % n);
  }

  /** ↻ 重roll：激活角色 = 原消息 name 匹配成员（缺失回退 pickSpeaker），候选追加 */
  async function handleRegenerate(messageId: string): Promise<void> {
    if (chat.streaming || members.length === 0) return;
    const target = useWorkStore.getState().messages.find((x) => x.id === messageId);
    if (!target) return;
    const speaker =
      members.find((m) => m.name === target.name) ?? pickSpeaker(members, lastSpeakerId, target.content, manualPickId);
    syncTurn(await chat.swipeRegenerate(target, speaker));
  }

  if (members.length === 0) return <EmptyMembers />;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {chat.error && (
        <div className="flex items-center gap-2 border-b border-[hsl(var(--border-soft))] bg-[hsl(var(--danger))]/10 px-4 py-2 text-xs text-[hsl(var(--danger))]">
          <span className="min-w-0 flex-1">{chat.error.message}</span>
          {chat.partialKept && (
            <button type="button" onClick={() => void handleContinue()} className="shrink-0 underline" data-testid="chat-continue-btn">
              继续
            </button>
          )}
          <button type="button" onClick={chat.clearError} className="shrink-0 underline">
            知道了
          </button>
        </div>
      )}
      <ChatView
        messages={messages}
        members={members}
        lastSpeakerId={lastSpeakerId}
        manualPickId={manualPickId}
        onSend={(text) => void handleSend(text)}
        onPick={setManualPickId}
        streaming={chat.streaming}
        buffer={chat.buffer}
        onSwipe={(id, dir) => void handleSwipe(id, dir)}
        onRegenerate={(id) => void handleRegenerate(id)}
      />
    </div>
  );
}
