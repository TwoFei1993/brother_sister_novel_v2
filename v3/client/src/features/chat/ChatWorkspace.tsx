/**
 * chat 模式工作区（设计 §4.3 / §7.1）：ChatView + MemberBar + useChatGenerate 集成层
 *
 * - 成员：work.characterIds 绑定卡（按绑定顺序）；lastSpeakerId=最后 assistant name 匹配成员
 * - onSend：pickSpeaker（手动指定 > 提及 > 轮换）→ sendMessage → upsertLocal 成对同步
 * - 轮换可见化（四问①）：MemberBar「下一位/已指定：XX」；发送完成后 manualPick 复位
 * - 回复长度（四问③）：三档切换 PATCH settings；生成侧 chat-flow 统一注入长度 hint
 * - 快速回复（四问④）：每轮 chips 点选即发，括号指令隐式引导（进上下文不入库）
 * - 自动连播（四问④）：回复完成 1.5s 后自动续发（轮换下一位+空引导），连发
 *   members.length 条暂停；出错/关闭即停（localStorage 作品内记忆）
 * - 断流「继续」：半成品 + 本轮发送文本重组上下文（review #2：发送文本自存 ref）
 * - 空成员：引导去作品设置绑定角色卡（不渲染对话视图）
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChatReplyLength, Work } from '@shared/work';

import { listCharacters } from '../../api/library';
import { updateWork } from '../../api/works';
import { pickSpeaker, type ChatMember } from '../../engine/prompt/chat/activation';
import { createTtsEngine } from '../../hooks/useTts';
import { useGenerationStore } from '../../stores/generation';
import { useWorkStore } from '../../stores/work';

import ChatView from './ChatView';
import {
  AUTO_CHAT_DELAY_MS, INITIAL_AUTO_STATE, autoConsume, autoOnManualSend, autoShouldSend, autoToggle,
  type AutoChatState, type ChatTurn,
} from './chat-flow';
import { pickQuickDirectives } from './chat-directives';
import { useChatGenerate } from './useChatGenerate';

/** 成员加载失败/为空时的引导态 */
function EmptyMembers(): React.ReactElement {
  return (
    <div className="flex flex-1 items-center justify-center px-6 text-center" data-testid="chat-no-members">
      <p className="text-sm text-[hsl(var(--fg-muted))]">还没有可对话的角色——请打开右上角 ⚙ 作品设置，绑定至少一张角色卡</p>
    </div>
  );
}

/** 轮换基准：消息流中最后一条 assistant 的 name 匹配成员（不匹配视为无基准） */
function lastSpeakerFrom(msgs: { role: string; name?: string }[], list: ChatMember[]): string | null {
  for (let i = msgs.length - 1; i >= 0; i -= 1) {
    const m = msgs[i]!;
    if (m.role !== 'assistant') continue;
    return list.find((mem) => mem.name === m.name)?.id ?? null;
  }
  return null;
}

const autoPlayKey = (workId: string): string => `v3-auto-chat-${workId}`;

export default function ChatWorkspace({ work }: { work: Work }) {
  const messages = useWorkStore((s) => s.messages);
  const upsertLocal = useWorkStore((s) => s.upsertLocal);
  const chat = useChatGenerate(work, messages);
  const [members, setMembers] = useState<ChatMember[]>([]);
  const [manualPickId, setManualPickId] = useState<string | null>(null);
  // 本轮发送文本（review #2）：发送即记录，断流「继续」时使用（user 消息可能未入库，反查会拿错轮次）
  const lastSentTextRef = useRef('');
  // 流式生成中的实际激活角色（自动连播空引导时消息流反查会取错提及者，显式传递）
  const [streamingSpeakerId, setStreamingSpeakerId] = useState<string | null>(null);
  // 自动连播状态（作品内记忆：enabled 恢复、remaining 归零待重新起跑）
  const [auto, setAuto] = useState<AutoChatState>(() => {
    try {
      return localStorage.getItem(autoPlayKey(work.id)) === '1' ? { enabled: true, remaining: 0 } : INITIAL_AUTO_STATE;
    } catch {
      return INITIAL_AUTO_STATE;
    }
  });
  const autoRef = useRef(auto);
  autoRef.current = auto;
  const autoTimerRef = useRef<number | null>(null);
  const [lengthPatching, setLengthPatching] = useState(false); // 长度档 PATCH 进行中（防 revision 竞态连点）
  const [settingsError, setSettingsError] = useState<string | null>(null);
  // 消息点读引擎（chat 与 novel 互斥挂载，独占全局 tts store 无冲突）
  const ttsEngine = useMemo(() => createTtsEngine(), []);

  // members/manualPick 的 ref 镜像：定时器回调与 async 流程内读最新值（避免闭包陈旧数组）
  const membersRef = useRef(members);
  membersRef.current = members;
  const manualPickRef = useRef(manualPickId);
  manualPickRef.current = manualPickId;

  // 卸载清理：停止点读 + 清掉未触发的自动连播定时器
  useEffect(
    () => () => {
      ttsEngine.stop();
      if (autoTimerRef.current !== null) window.clearTimeout(autoTimerRef.current);
    },
    [ttsEngine],
  );

  // 自动开关持久化（作品内记忆；localStorage 不可用时仅影响记忆）
  useEffect(() => {
    try {
      localStorage.setItem(autoPlayKey(work.id), auto.enabled ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [auto.enabled, work.id]);

  // 出错即停自动连播（任务定义：直到用户关闭或出错），并清掉未触发的定时器
  useEffect(() => {
    if (!chat.error) return;
    if (autoTimerRef.current !== null) window.clearTimeout(autoTimerRef.current);
    setAuto((s) => (s.enabled ? INITIAL_AUTO_STATE : s));
  }, [chat.error]);

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

  // 自然轮换基准（渲染值）；currentLastSpeakerId() 供定时器/async 流程读 store 最新值
  //（1.5s 延迟期间消息流已更新，渲染闭包里的 lastSpeakerId 慢一拍会导致轮换错位）
  const lastSpeakerId = useMemo<string | null>(() => lastSpeakerFrom(messages, members), [messages, members]);

  function currentLastSpeakerId(list: ChatMember[]): string | null {
    return lastSpeakerFrom(useWorkStore.getState().messages, list);
  }

  /** 轮换提示（四问①）：手动指定优先，否则按 lastSpeaker 轮换出「下一位」 */
  const nextSpeakerName = useMemo(() => {
    if (members.length === 0) return '';
    try {
      return pickSpeaker(members, lastSpeakerId, '', manualPickId).name;
    } catch {
      return '';
    }
  }, [members, lastSpeakerId, manualPickId]);

  /** 快速回复 chips：settings.quickDirectives 非空优先；按 assistant 轮次轮换取一组 */
  const quickDirectives = useMemo(() => {
    const round = messages.reduce((n, m) => (m.role === 'assistant' ? n + 1 : n), 0);
    return pickQuickDirectives(work.settings.quickDirectives, round);
  }, [messages, work.settings.quickDirectives]);

  function syncTurn(turn: ChatTurn | null): void {
    if (!turn) return;
    if (turn.user) upsertLocal(turn.user);
    upsertLocal(turn.assistant);
  }

  /** 统一发送入口：text 为空串或括号指令时为隐式引导（进上下文不入库） */
  async function doSend(text: string, opts: { implicit?: boolean; fromAuto?: boolean } = {}): Promise<void> {
    const list = membersRef.current;
    if (list.length === 0) return;
    lastSentTextRef.current = text;
    const speaker = pickSpeaker(list, currentLastSpeakerId(list), text, manualPickRef.current);
    setStreamingSpeakerId(speaker.id);
    if (!opts.fromAuto) setAuto((s) => autoOnManualSend(s, list.length));
    try {
      const turn = await chat.sendMessage(text, speaker, opts.implicit ? { implicit: true } : undefined);
      if (turn) {
        syncTurn(turn);
        setManualPickId(null); // 发送完成即清除手动指定（四问①）：流式期间保留保证头像正确
        scheduleAutoNext(autoRef.current); // await 期间已重渲染，ref 为最新状态
      }
    } finally {
      setStreamingSpeakerId(null);
    }
  }

  /** 自动连播下一步：配额未用尽则延迟 1.5s 以「轮换下一位+空引导」续发。
   *  状态显式传入（toggle 后 autoRef.current 尚未随重渲染更新，读旧值会漏启动） */
  function scheduleAutoNext(s: AutoChatState): void {
    if (!autoShouldSend(s)) return;
    if (autoTimerRef.current !== null) window.clearTimeout(autoTimerRef.current);
    autoTimerRef.current = window.setTimeout(() => {
      autoTimerRef.current = null;
      if (!autoShouldSend(autoRef.current) || useGenerationStore.getState().streaming) return;
      setAuto((cur) => autoConsume(cur));
      void doSend('', { implicit: true, fromAuto: true });
    }, AUTO_CHAT_DELAY_MS);
  }

  function handleAutoToggle(): void {
    const next = autoToggle(autoRef.current, membersRef.current.length);
    setAuto(next);
    if (next.enabled && !useGenerationStore.getState().streaming) scheduleAutoNext(next);
  }

  function handleContinue(): void {
    if (membersRef.current.length === 0) return;
    const partial = useGenerationStore.getState().buffer;
    const fallbackText = [...useWorkStore.getState().messages].reverse().find((m) => m.role === 'user')?.content ?? '';
    const lastUserText = lastSentTextRef.current || fallbackText;
    const list = membersRef.current;
    const speaker = pickSpeaker(list, currentLastSpeakerId(list), lastUserText, manualPickRef.current);
    void chat.continueFromPartial(partial, lastUserText, speaker).then((turn) => {
      syncTurn(turn);
      scheduleAutoNext(autoRef.current);
    });
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
    if (chat.streaming || membersRef.current.length === 0) return;
    const target = useWorkStore.getState().messages.find((x) => x.id === messageId);
    if (!target) return;
    const list = membersRef.current;
    const speaker =
      list.find((m) => m.name === target.name) ??
      pickSpeaker(list, currentLastSpeakerId(list), target.content, manualPickRef.current);
    const turn = await chat.swipeRegenerate(target, speaker);
    syncTurn(turn);
  }

  // 长度三档切换：PATCH settings 持久化（生成侧由 chat-flow 后处理统一消费）
  async function handleReplyLengthChange(len: ChatReplyLength): Promise<void> {
    if (lengthPatching) return;
    setLengthPatching(true);
    setSettingsError(null);
    try {
      const updated = await updateWork(work.id, {
        revision: work.revision,
        settings: { ...work.settings, chatReplyLength: len },
      });
      useWorkStore.getState().setWork(updated);
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : '长度档保存失败，请重试');
    } finally {
      setLengthPatching(false);
    }
  }

  if (members.length === 0) return <EmptyMembers />;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {(chat.error || settingsError) && (
        <div className="fixed inset-x-0 top-0 z-[60] flex items-center gap-2 border-b border-[hsl(var(--border-soft))] bg-[hsl(var(--danger))]/10 px-4 py-2 text-xs text-[hsl(var(--danger))] backdrop-blur-sm">
          <span className="min-w-0 flex-1">{chat.error?.message ?? settingsError}</span>
          {chat.error ? (
            <>
              {chat.partialKept && (
                <button type="button" onClick={handleContinue} className="shrink-0 underline" data-testid="chat-continue-btn">
                  继续
                </button>
              )}
              <button type="button" onClick={chat.clearError} className="shrink-0 underline">
                知道了
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setSettingsError(null)} className="shrink-0 underline">
              知道了
            </button>
          )}
        </div>
      )}
      <ChatView
        messages={messages}
        members={members}
        lastSpeakerId={lastSpeakerId}
        manualPickId={manualPickId}
        onSend={(text, opts) => void doSend(text, opts)}
        onPick={setManualPickId}
        streaming={chat.streaming}
        buffer={chat.buffer}
        onSwipe={(id, dir) => void handleSwipe(id, dir)}
        onRegenerate={(id) => void handleRegenerate(id)}
        onSpeak={(content) => ttsEngine.speakOne(content, { voiceMap: work.voiceMap })}
        regexScripts={chat.regexScripts}
        quickDirectives={quickDirectives}
        nextSpeakerName={nextSpeakerName}
        replyLength={work.settings.chatReplyLength ?? 'medium'}
        onReplyLengthChange={(len) => void handleReplyLengthChange(len)}
        autoPlay={auto.enabled}
        onAutoPlayToggle={handleAutoToggle}
        streamingSpeakerId={streamingSpeakerId}
      />
    </div>
  );
}
