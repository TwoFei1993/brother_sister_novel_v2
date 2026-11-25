/**
 * novel-chapter 后台任务 hook（2026-11-21 M2 Chunk 4：书页章节生成切换 server 任务）
 *
 * 提交（per-work 防重入；409 GEN_BUSY → 槽 fail「该书已有生成任务进行中」）→ 1.5s 增量轮询
 * （progressText → appendChunk 打字机视图回流）→ 终态：按 resultMessageIds 拉取入库消息
 * upsertLocal 同步本地视图（done/failed 都同步——failed 亦携带已完成章，D6）；done 且非用户
 * 停止 → finish+reset 收束本书槽。
 *
 * stop()：POST cancel + 槽 fail(null, partialKept)（UI 立即可交互；server 当前段跑完即停——D6；
 * 轮询继续到终态，已完成章仍同步本地；buffer 保留供「继续」）。
 *
 * 页面切换恢复：slot 键 novel-gen-${workId} 存 taskId 于 localStorage，mount/workId 变化时
 * 重启轮询（任务在 server 继续）。恢复统一 since=0 重收当前章全文（buffer 重置为当前章
 * 从头流式）：不推断 server 端 progress.text 与本地 buffer 的对齐（续写轮 finalize 会重写
 * text、翻章边界难判定），上一章已入库不丢——切页回来当前章从头回放一遍是可接受取舍。
 *
 * 跨章增量（缝②修复）：server progress.text 换章清零（TaskProgress 语义）→ progressLen
 * 回落（含 0 边界）即翻章。buffer 只承载当前章流式显示——翻章拍重置槽 buffer 为新章开头
 * 并 since 归零，下一拍 ?since=0 重收当前章全文（翻章拍 progressText 按旧 since 切片越界
 * 为空/残片，语义不可靠不回流）。
 */
import { useCallback, useEffect, useRef } from 'react';
import type { Message } from '@shared/message';
import type { Work } from '@shared/work';

import { listMessages } from '../api/works';
import {
  cancelTask,
  pollNovelProgress,
  submitNovelChapter,
  taskPrefsOf,
  type NovelChapterSubmitBody,
  type NovelTaskProgressPayload,
} from '../lib/llmTask';
import { getGenSlot, useGenerationStore } from '../stores/generation';
import { useSettingsStore } from '../stores/settings';
import { useWorkStore } from '../stores/work';

import { toGenerationError } from './generation-flow';

/** 轮询间隔（1.5s：进度节流落盘 1s，略滞后一拍保证每拍都有增量） */
const POLL_MS = 1500;

/** 任务恢复的 localStorage 槽键（页面切换/刷新后 mount 重启轮询的锚点） */
export const novelTaskSlotKey = (workId: string): string => `novel-gen-${workId}`;

/** 一次任务提交的编排入参（prefs 从 settings store 现读——非敏感字段全量透传） */
export interface NovelTaskRunInput {
  work: Work;
  mode: NovelChapterSubmitBody['mode'];
  directive: string;
  chapters?: number;
  outline?: boolean;
  /** swipe/append/expand 目标消息 id（chapter 模式不传；Chunk 5 起重roll/加长任务消费） */
  targetId?: string;
  /** continue 半成品基底（Chunk 5 起断流续写任务消费） */
  partial?: string;
  /** 批量进度回调（轮询 done 计数驱动 setBatch） */
  onProgress?: (p: { done: number; chapterTotal: number; phase: NovelTaskProgressPayload['phase'] }) => void;
}

/** 任务终局：messages=入库消息（按 resultMessageIds 序，已 upsertLocal）；stopped=用户取消 */
export interface NovelTaskOutcome {
  messages: Message[];
  stopped: boolean;
  failed: boolean;
}

/** 一轮轮询循环的运行态（cancelled=挂载卸载/切书作废；stopRequested=用户取消） */
interface ActiveLoop {
  taskId: string;
  workId: string;
  stopRequested: boolean;
  cancelled: boolean;
  /** 翻章拍回填上一章进行中：期间不回流、since 保持 0（清空 buffer 后从 0 重收当前章全文） */
  resetting: boolean;
  /** 已见到的最大章序（任务内序，1 起；0=尚未收到进度）——区分「翻章」与「同章重写」 */
  chapterIndex: number;
  /** 进度回落后的下一拍：全文到达时整体替换 buffer（不追加） */
  replaceNext: boolean;
  /** 本循环是否持有本书槽的 UX（回流 appendChunk/终态收束）：槽已停止/失败态时 false——
   *  只同步终态入库消息，不碰「继续」buffer（D6 半成品保留） */
  ownsSlot: boolean;
  onProgress?: NovelTaskRunInput['onProgress'];
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 终态取回：按 resultMessageIds 拉取入库消息并 upsertLocal 同步本地视图。
 * resultMessageIds 是任务内追加序；同书任务互斥（409）保证无并发插行，tail 窗口
 * 取 ids.length+20（容错幂等覆盖场景）后按 id 匹配、按 ids 序返回。
 */
async function syncResultMessages(workId: string, ids: string[]): Promise<Message[]> {
  if (ids.length === 0) return [];
  const page = await listMessages(workId, { tail: Math.min(1000, ids.length + 20) });
  const byId = new Map(page.messages.map((m) => [m.id, m] as const));
  return ids.map((id) => byId.get(id)).filter((m): m is Message => m !== undefined);
}

/**
 * 运行中回填：把已入库的章同步进本地视图（翻章拍调用）。只追加本地没有的消息。
 * 不等任务终态——否则上一章的正文随 buffer 清空而在界面上「消失」、章数提示停在旧值
 * （用户实测 2026-11-26：生成第一章完了就消失了，随后写第二章时上面还显示在生成第一章）。
 * tail 取 done + 30：覆盖已入库的 done 章加少量非章节消息，不拉整本。
 */
async function backfillStored(workId: string, done: number): Promise<void> {
  if (done <= 0) return;
  const page = await listMessages(workId, { tail: done + 30 });
  const known = new Set(useWorkStore.getState().messages.map((m) => m.id));
  for (const m of page.messages) {
    if (!known.has(m.id)) useWorkStore.getState().upsertLocal(m);
  }
}

export function useNovelTask(workId?: string | null) {
  const activeRef = useRef<ActiveLoop | null>(null);

  /** 轮询循环：1.5s 一拍直到终态（轮询抖动静默重试；cancelled 随时退出）。since 一律从 0
   *  起步（提交与恢复都重收当前章全文，见头部注释）；翻章检测归零重启 */
  const runLoop = useCallback(async (loop: ActiveLoop): Promise<NovelTaskOutcome> => {
    const { workId: wid, taskId } = loop;
    let since = 0;
    try {
      for (;;) {
        if (loop.cancelled) return { messages: [], stopped: false, failed: false };
        await sleep(POLL_MS);
        if (loop.cancelled) return { messages: [], stopped: false, failed: false };
        let payload: Awaited<ReturnType<typeof pollNovelProgress>>;
        try {
          payload = await pollNovelProgress(taskId, since);
        } catch {
          continue; // 单次轮询抖动静默重试（网络瞬断/服务重启间隙）
        }
        if (payload.status === 'running') {
          if (loop.resetting) continue; // 上一章回填中：不回流、since 保持 0
          // 进度回落（progressLen < since）有两种来源，按章序区分；两者都 since 归零、下一拍重收全文：
          // ① 翻章（章序变大）：先把已入库的上一章回填本地视图，再清空 buffer（targetMessageId 保留——入库幂等键不变）
          // ② 同章重写（首稿无效自动重试 / 续写轮后处理改写）：旧稿不清空（否则正文闪断约一拍），
          //    标记已重试，新稿到达后整体替换（深度测试实测 2026-11-26）
          if (payload.progressLen < since) {
            since = 0;
            loop.replaceNext = true;
            const chapterChanged = payload.chapterIndex > loop.chapterIndex;
            loop.chapterIndex = Math.max(loop.chapterIndex, payload.chapterIndex);
            if (loop.ownsSlot && !loop.stopRequested) {
              if (chapterChanged) {
                loop.resetting = true;
                void backfillStored(wid, payload.done)
                  .catch(() => undefined) // 回填失败不阻塞：终态仍按 resultMessageIds 同步
                  .finally(() => {
                    loop.resetting = false;
                    // 期间已停止/卸载/到终态：不再碰槽（停止后的半成品 buffer 要保留供「继续」）
                    if (loop.cancelled || loop.stopRequested || activeRef.current !== loop) return;
                    const prevTarget = getGenSlot(wid)?.targetMessageId ?? '';
                    useGenerationStore.getState().start(wid, prevTarget, '');
                  });
              } else {
                useGenerationStore.getState().setRetried(wid, true);
              }
            }
            loop.onProgress?.({ done: payload.done, chapterTotal: payload.chapterTotal, phase: payload.phase });
            continue; // 本拍 progressText 是按旧 since 的越界切片，不回流
          }
          if (loop.ownsSlot && !loop.stopRequested) {
            const gen = useGenerationStore.getState();
            if (payload.progressText) {
              if (loop.replaceNext) {
                loop.replaceNext = false;
                gen.replaceBuffer(wid, payload.progressText);
              } else {
                gen.appendChunk(wid, payload.progressText);
              }
            }
            gen.setProgress(wid, {
              done: payload.done,
              chapterTotal: payload.chapterTotal,
              chapterIndex: payload.chapterIndex,
            });
          }
          since = payload.progressLen;
          loop.chapterIndex = Math.max(loop.chapterIndex, payload.chapterIndex);
          loop.onProgress?.({ done: payload.done, chapterTotal: payload.chapterTotal, phase: payload.phase });
          continue;
        }
        // 终态：清恢复锚点（done/failed 都清——任务已结束，回页不再恢复）
        try {
          localStorage.removeItem(novelTaskSlotKey(wid));
        } catch {
          /* 隐私模式静默 */
        }
        const synced = await syncResultMessages(wid, payload.resultMessageIds ?? []);
        for (const m of synced) useWorkStore.getState().upsertLocal(m);
        if (payload.status === 'done') {
          if (loop.ownsSlot && !loop.stopRequested) {
            // 正常完成：收束本书槽（buffer 清除——章节已入库由消息流渲染，避免双影）
            useGenerationStore.getState().finish(wid);
            useGenerationStore.getState().reset(wid);
          }
          // 用户已停止：槽保持 fail(null, partialKept)——buffer 保留供「继续」（D6）
          return { messages: synced, stopped: loop.stopRequested, failed: false };
        }
        // failed/lost/expired：槽 fail（含 server 原因）；已完成章已同步
        if (loop.ownsSlot) {
          const kept = (getGenSlot(wid)?.buffer.length ?? 0) > 0;
          useGenerationStore.getState().fail(wid, { code: 'LLM_FAILED', message: payload.error ?? '生成失败' }, kept);
        }
        return { messages: synced, stopped: false, failed: true };
      }
    } finally {
      if (activeRef.current === loop) activeRef.current = null;
    }
  }, []);

  /** 提交任务并轮询至终态（返回入库消息；失败/409 返回空 messages 且错误已进槽） */
  const submitAndWait = useCallback(
    async (input: NovelTaskRunInput): Promise<NovelTaskOutcome> => {
      const { work } = input;
      const gen = useGenerationStore.getState();
      const prefs = useSettingsStore.getState().llmPrefs;
      if (gen.slots[work.id]?.streaming) return { messages: [], stopped: false, failed: false }; // per-work 防重入
      if (!prefs.model) {
        gen.fail(work.id, { code: 'LLM_NOMODEL', message: '请先在设置页选择模型' }, false);
        return { messages: [], stopped: false, failed: true };
      }
      gen.start(work.id, input.targetId ?? '', '');
      try {
        const taskId = await submitNovelChapter({
          kind: 'novel-chapter',
          workId: work.id,
          prefs: taskPrefsOf(prefs),
          mode: input.mode,
          directive: input.directive,
          chapters: input.chapters ?? 1,
          ...(input.outline !== undefined ? { outline: input.outline } : {}),
          ...(input.targetId ? { targetId: input.targetId } : {}),
          ...(input.partial ? { partial: input.partial } : {}),
        });
        gen.setTaskId(work.id, taskId);
        try {
          localStorage.setItem(novelTaskSlotKey(work.id), taskId);
        } catch {
          /* 隐私模式静默——仅影响刷新恢复 */
        }
        const loop: ActiveLoop = {
          taskId,
          workId: work.id,
          stopRequested: false,
          cancelled: false,
          resetting: false,
          chapterIndex: 0,
          replaceNext: false,
          ownsSlot: true,
          ...(input.onProgress ? { onProgress: input.onProgress } : {}),
        };
        activeRef.current = loop;
        return await runLoop(loop);
      } catch (err) {
        if ((err as { status?: number }).status === 409) {
          gen.fail(work.id, { code: 'GEN_BUSY', message: '该书已有生成任务进行中' }, false);
        } else {
          gen.fail(work.id, toGenerationError(err), false);
        }
        // 提交失败=任务未创建：清恢复锚点（提交成功后锚点的清理由 runLoop 终态负责——
        // 页面切换 cancelled 退出时锚点必须保留供回页恢复）
        try {
          localStorage.removeItem(novelTaskSlotKey(work.id));
        } catch {
          /* 静默 */
        }
        return { messages: [], stopped: false, failed: true };
      } finally {
        gen.setTaskId(work.id, undefined);
      }
    },
    [runLoop],
  );

  /** 停止：POST cancel + 槽 fail(null, partialKept)（轮询继续到终态，已完成章仍同步——D6） */
  const stop = useCallback((): void => {
    const loop = activeRef.current;
    if (!loop || loop.stopRequested) return;
    loop.stopRequested = true;
    void cancelTask(loop.taskId).catch(() => undefined);
    if (loop.ownsSlot) {
      const buffered = (getGenSlot(loop.workId)?.buffer.length ?? 0) > 0;
      useGenerationStore.getState().fail(loop.workId, null, buffered);
    }
  }, []);

  // mount / 切书恢复：恢复锚点有 taskId → 重启轮询（页面切换/刷新安全，任务在 server 继续）。
  // 卸载/切书作废本轮询（cancelled）——回页再恢复，绝不双循环双回流。
  useEffect(() => {
    if (!workId) return;
    let taskId: string | null = null;
    try {
      taskId = localStorage.getItem(novelTaskSlotKey(workId));
    } catch {
      taskId = null;
    }
    if (!taskId || activeRef.current) return;
    const slot = getGenSlot(workId);
    // 恢复统一 since=0 重收当前章全文（缝②）：buffer 重置为当前章从头流式。不推断 server
    // 端 progress.text 与本地 buffer 的对齐（续写轮 finalize 会重写 text、切页时机跨章
    // 边界难判定），上一章已入库不丢——切页回来当前章从头回放一遍是可接受取舍；
    // 槽在但已停止/失败（停止后切页）：不碰槽（半成品「继续」buffer 保留），
    //   轮询只做终态同步（取消后 server 已入库章仍回填本地视图——D6）
    const ownsSlot = !slot || slot.streaming;
    if (ownsSlot) {
      useGenerationStore.getState().start(workId, slot?.targetMessageId ?? '', '');
      useGenerationStore.getState().setTaskId(workId, taskId);
    }
    const loop: ActiveLoop = {
      taskId,
      workId,
      stopRequested: false,
      cancelled: false,
      resetting: false,
      chapterIndex: 0,
      replaceNext: false,
      ownsSlot,
    };
    activeRef.current = loop;
    void runLoop(loop).catch(() => undefined);
    return () => {
      const cur = activeRef.current;
      if (cur) {
        cur.cancelled = true;
        if (activeRef.current === cur) activeRef.current = null;
      }
    };
  }, [workId, runLoop]);

  return { submitAndWait, stop };
}
