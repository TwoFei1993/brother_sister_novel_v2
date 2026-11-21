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
 * 重启轮询（任务在 server 继续；同会话切页 since 接 buffer 长度续流，整页刷新重建槽从 0 重放）。
 */
import { useCallback, useEffect, useRef } from 'react';
import type { Message } from '@shared/message';
import type { Work } from '@shared/work';

import { listMessages } from '../api/works';
import {
  cancelTask,
  pollNovelProgress,
  submitNovelChapter,
  type NovelChapterSubmitBody,
  type NovelTaskPrefs,
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
  /** swipe/append/expand 目标消息 id（Chunk 5 起消费；chapter 模式不传） */
  targetId?: string;
  /** continue 半成品基底（Chunk 5 起消费） */
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
  /** 本循环是否持有本书槽的 UX（回流 appendChunk/终态收束）：槽已停止/失败态时 false——
   *  只同步终态入库消息，不碰「继续」buffer（D6 半成品保留） */
  ownsSlot: boolean;
  onProgress?: NovelTaskRunInput['onProgress'];
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** settings.llmPrefs → 任务 prefs（非敏感字段全量，repetitionPenalty 治重复循环防线不可漏） */
function taskPrefsOf(prefs: ReturnType<typeof useSettingsStore.getState>['llmPrefs']): NovelTaskPrefs {
  return {
    source: prefs.source,
    model: prefs.model,
    ...(prefs.temperature !== undefined ? { temperature: prefs.temperature } : {}),
    ...(prefs.maxContext !== undefined ? { maxContext: prefs.maxContext } : {}),
    ...(prefs.maxTokens !== undefined ? { maxTokens: prefs.maxTokens } : {}),
    thinking: prefs.thinking !== false,
    ...(prefs.polishModel ? { polishModel: prefs.polishModel } : {}),
    ...(prefs.frequencyPenalty !== undefined ? { frequencyPenalty: prefs.frequencyPenalty } : {}),
    ...(prefs.presencePenalty !== undefined ? { presencePenalty: prefs.presencePenalty } : {}),
    ...(prefs.repetitionPenalty !== undefined ? { repetitionPenalty: prefs.repetitionPenalty } : {}),
  };
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

export function useNovelTask(workId?: string | null) {
  const activeRef = useRef<ActiveLoop | null>(null);

  /** 轮询循环：1.5s 一拍直到终态（轮询抖动静默重试；cancelled 随时退出） */
  const runLoop = useCallback(async (loop: ActiveLoop, since0: number): Promise<NovelTaskOutcome> => {
    const { workId: wid, taskId } = loop;
    let since = since0;
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
          if (payload.progressText && !loop.stopRequested && loop.ownsSlot) {
            useGenerationStore.getState().appendChunk(wid, payload.progressText);
          }
          since = payload.progressLen;
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
          ownsSlot: true,
          ...(input.onProgress ? { onProgress: input.onProgress } : {}),
        };
        activeRef.current = loop;
        return await runLoop(loop, 0);
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
    // 槽在流式中（同会话切页）：不重建，since 接 buffer 长度续流；
    // 槽已丢（整页刷新）：重建槽位从 since=0 重放当前章全文；
    // 槽在但已停止/失败（停止后切页）：不碰槽（半成品「继续」buffer 保留），
    //   轮询只做终态同步（取消后 server 已入库章仍回填本地视图——D6）
    const ownsSlot = !slot || slot.streaming;
    if (slot?.streaming) {
      useGenerationStore.getState().setTaskId(workId, taskId);
    } else if (!slot) {
      useGenerationStore.getState().start(workId, '', '');
    }
    const loop: ActiveLoop = { taskId, workId, stopRequested: false, cancelled: false, ownsSlot };
    activeRef.current = loop;
    void runLoop(loop, slot?.streaming ? slot.buffer.length : 0).catch(() => undefined);
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
