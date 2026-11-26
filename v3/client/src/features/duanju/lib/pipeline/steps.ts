/**
 * 流水线各步骤的实现（设计共识 2026-11-26 第 3.6 节）。主循环与对外 API 见 runner.ts。
 *
 * 每个步骤拿到的 ctx 是这一次运行的可变上下文：cp（断点）随进度更新并落盘，
 * project 在每次写入后替换，ctx.stop 为真时在当前这一步跑完后返回 'stop'。
 *
 * 「已有内容不覆盖」（D8）靠两道：每一集开始前重读作品（运行期间用户可能在别处写了剧本、加了镜头），
 * 真正写入时在 mutate 回调里按最新的数据再判一次（读与写之间还有一段模型生成的时间）。
 */
import type { DuanjuEpisode, DuanjuProject, PipelineCheckpoint, PipelineStep } from '@shared/duanju';

import { apiFetch } from '../../../../api/client';
import { useSettingsStore } from '../../../../stores/settings';
import { useDuanjuStore } from '../../store';
import { buildCharacterExtractMessages, parseCharacterExtract } from '../characterExtract';
import { buildSceneExtractMessages, parseSceneExtract } from '../sceneExtract';
import { buildStoryboardMessages, parseStoryboard } from '../prompts/prompts-storyboard';
import { runBgTask } from './bgTask';
import { writeCheckpoint } from './checkpoint';
import { episodeGenMode, generateEpisodeScript } from './episodeGen';
import { mergeExtractedCharacters, mergeExtractedScenes, withEpisodeScript } from './merge';
import { assembleEpisodeSource, effectiveEpisodeScript, hasEpisodeScript } from './source';
import { STEP_LABELS, usePipelineStore, type PipelineRun } from './stores';

export interface RunCtx {
  workId: string;
  /** 断点：步骤内随进度更新并落盘 */
  cp: PipelineCheckpoint;
  prefs: { source: string; model: string };
  /** 最新作品数据：每次写入后替换 */
  project: DuanjuProject;
  /** 停止请求（stopPipeline 置位）：当前这一步跑完后停下 */
  stop: boolean;
}

export type StepResult = 'next' | 'stop';

// ---------- 界面快照与断点 ----------

export function setRun(workId: string, patch: Partial<PipelineRun>): void {
  const base: PipelineRun = { status: 'running', step: 'script', episodeIndex: 0, label: '', failed: [], message: '' };
  usePipelineStore.getState().setRun(workId, { ...base, ...usePipelineStore.getState().runOf(workId), ...patch });
}

/** 更新断点并落盘（时间戳取当前） */
export function save(ctx: RunCtx, patch: Partial<PipelineCheckpoint>): void {
  Object.assign(ctx.cp, patch, { updatedAt: Date.now() });
  writeCheckpoint(ctx.cp);
}

// ---------- 作品读写 ----------

export async function readProject(workId: string): Promise<DuanjuProject> {
  return apiFetch<DuanjuProject>(`/api/works/${workId}/duanju`);
}

/**
 * 读最新 → 改 → PATCH；成功后同步进界面（版本号只增不减）；撞版本冲突重读重试。
 * mutate 返回 null = 看过最新数据后决定不写（例如用户已经自己写了这一集）。
 */
async function mutateProject(
  workId: string,
  mutate: (cur: DuanjuProject) => Partial<DuanjuProject> | null,
  tries = 3,
): Promise<DuanjuProject> {
  for (let i = 1; ; i += 1) {
    const cur = await readProject(workId);
    const patch = mutate(cur);
    if (patch === null) return cur;
    try {
      const next = await apiFetch<DuanjuProject>(`/api/works/${workId}/duanju`, {
        method: 'PATCH',
        body: JSON.stringify({ revision: cur.revision, ...patch }),
      });
      useDuanjuStore.getState().adopt(workId, next);
      return next;
    } catch (err) {
      const conflict = (err as { status?: number }).status === 409;
      if (!conflict || i >= tries) {
        throw new Error(conflict ? '保存失败（版本反复冲突），请刷新后重试' : (err as Error).message);
      }
    }
  }
}

/** 每一集开始前重读作品：「已有 / 未写」的判断要以最新的为准 */
async function refreshProject(ctx: RunCtx): Promise<void> {
  ctx.project = await readProject(ctx.workId);
  useDuanjuStore.getState().adopt(ctx.workId, ctx.project);
}

// ---------- 角色 / 场景：只补缺失 ----------

/** 提取角色档案或场景档案：已有非空档案的不动，档案为空的补上，新名字追加 */
export async function extractStep(ctx: RunCtx, kind: 'character' | 'scene'): Promise<void> {
  const { workId } = ctx;
  setRun(workId, { step: kind, label: STEP_LABELS[kind] });
  const prefs = useSettingsStore.getState().llmPrefs;
  const text = ctx.project.script.text;
  const messages =
    kind === 'character'
      ? buildCharacterExtractMessages(text, ctx.project.reviewCards.characterRelations, ctx.project.protagonists)
      : buildSceneExtractMessages(text);
  // 失败时不清 taskId：轮询超时的旧任务可能还在服务端跑，留着它重试时能直接取回结果（任务真没了会得到 404，那时自动重提）
  const raw = await runBgTask(
    { source: prefs.source, model: prefs.model, messages, thinking: false, params: { max_tokens: 16000 }, label: `流水线·${STEP_LABELS[kind]}` },
    { existingTaskId: ctx.cp.taskId, onSubmitted: (taskId) => save(ctx, { taskId }) },
  );
  const now = Date.now();
  if (kind === 'character') {
    const list = parseCharacterExtract(raw) ?? [];
    if (list.length === 0) throw new Error('提取角色档案失败（模型未返回有效结果）');
    ctx.project = await mutateProject(workId, (cur) => ({ characters: mergeExtractedCharacters(cur.characters, list, now) }));
  } else {
    const list = parseSceneExtract(raw) ?? [];
    if (list.length === 0) throw new Error('提取场景档案失败（模型未返回有效结果）');
    ctx.project = await mutateProject(workId, (cur) => ({ scenes: mergeExtractedScenes(cur.scenes, list, now) }));
  }
}

// ---------- 分集剧本：逐集 ----------

/**
 * 生成并写入一集剧本；返回 null=成功，'stop'=停止请求，其余=失败原因。
 * 两类情况直接抛出、交给外层按「步骤级失败」处理（停下并保留断点）：
 * - 提交都没成功（断网 / 额度用尽）：环境问题，逐集硬试只会把剩下的集全记成失败；
 * - 生成成功但保存失败：断点里的任务号指向那个已完成的任务，重试时直接取回结果，不重新生成。
 */
async function writeOneEpisode(ctx: RunCtx, ep: DuanjuEpisode, mode: 'adapt' | 'continue'): Promise<'stop' | string | null> {
  if (!ep.synopsis.trim()) return '没有本集梗概';
  let reason = '模型没有输出剧本';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (ctx.stop) return attempt === 0 ? 'stop' : reason;
    const existingTaskId = attempt === 0 ? ctx.cp.taskId : undefined;
    let gotTask = Boolean(existingTaskId); // 拿到了任务号（复用在途的 / 新提交的）才算这一集真的试过
    let text: string | null = null;
    try {
      text = await generateEpisodeScript(ctx.project, ep, ctx.prefs, {
        existingTaskId,
        onSubmitted: (taskId) => {
          gotTask = true;
          save(ctx, { taskId });
        },
      });
    } catch (err) {
      if (!gotTask) throw err;
      reason = err instanceof Error ? err.message : '生成失败';
      continue;
    }
    ctx.project = await mutateProject(ctx.workId, (cur) => {
      const latest = cur.episodes.find((e) => e.id === ep.id);
      // 运行期间用户已经写了这一集（保存并采用）：以用户的为准，模型的结果丢弃
      if (!latest || hasEpisodeScript(latest) || assembleEpisodeSource(cur, latest).skip) return null;
      return { episodes: withEpisodeScript(cur.episodes, ep.id, text!, mode === 'continue' ? 'continued' : 'adapted', Date.now()) };
    });
    return null;
  }
  return reason;
}

/** 已有剧本的集跳过；「只有第 1 集」作品的第 1 集原文即剧本，跳过 */
export async function scriptStep(ctx: RunCtx): Promise<StepResult> {
  const { workId } = ctx;
  const start = Math.max(0, ctx.project.episodes.findIndex((e) => e.index >= ctx.cp.cursor));
  const targets = ctx.project.episodes.slice(start);
  for (const target of targets) {
    if (ctx.stop) return 'stop';
    await refreshProject(ctx);
    const ep = ctx.project.episodes.find((e) => e.id === target.id);
    if (!ep) continue; // 运行期间这一集被删了
    const mode = episodeGenMode(ctx.project, ep);
    // 这里不清 taskId：断点里记着的在途任务属于游标指向的这一集，留给它首次尝试时复用
    save(ctx, { cursor: ep.index });
    setRun(workId, {
      step: 'script',
      episodeIndex: ep.index,
      label: `${mode === 'continue' ? '续写剧本' : '改编剧本'}·第 ${ep.index} 集《${ep.title}》`,
    });
    if (!hasEpisodeScript(ep) && !assembleEpisodeSource(ctx.project, ep).skip) {
      const result = await writeOneEpisode(ctx, ep, mode);
      if (result === 'stop') return 'stop';
      if (result) ctx.cp.failed = [...ctx.cp.failed, { step: 'script', index: ep.index, reason: result }];
    }
    save(ctx, { taskId: undefined });
    if (ctx.stop) return 'stop'; // 最后一集跑完时才收到停止请求：也按「停止」收尾，不接着进拆镜头或停靠
  }
  return 'next';
}

// ---------- 拆镜头：逐集 ----------

/** 已有镜头的集跳过；没有分集剧本的集不拆（不再即兴拆） */
export async function storyboardStep(ctx: RunCtx): Promise<StepResult> {
  const { workId } = ctx;
  const start = Math.max(0, ctx.project.episodes.findIndex((e) => e.index >= ctx.cp.cursor));
  const targets = ctx.project.episodes.slice(start);
  const mechanisms = await loadMechanisms();
  for (const target of targets) {
    if (ctx.stop) return 'stop';
    await refreshProject(ctx);
    const ep = ctx.project.episodes.find((e) => e.id === target.id);
    if (!ep) continue;
    save(ctx, { cursor: ep.index }); // 同上：留给本集首次尝试复用在途任务
    setRun(workId, { step: 'storyboard', episodeIndex: ep.index, label: `拆镜头·第 ${ep.index} 集《${ep.title}》` });
    const fail = (message: string): void => {
      ctx.cp.failed = [...ctx.cp.failed, { step: 'storyboard', index: ep.index, reason: message }];
    };
    const script = effectiveEpisodeScript(ctx.project, ep);
    if (script && !ctx.project.shots.some((s) => s.episodeId === ep.id)) {
      let gotTask = Boolean(ctx.cp.taskId);
      let raw: string;
      try {
        raw = await runBgTask(
          {
            source: ctx.prefs.source,
            model: ctx.prefs.model,
            messages: buildStoryboardMessages(`${ep.title}：${ep.synopsis}`, script,
              ctx.project.characters,
              ctx.project.scenes,
              ctx.project.props,
              mechanisms.filter((m) => (ep.mechanisms ?? []).includes(m.id)),
            ),
            thinking: false,
            params: { max_tokens: 32000 },
            label: `流水线·拆镜头第${ep.index}集`,
          },
          {
            existingTaskId: ctx.cp.taskId,
            onSubmitted: (taskId) => {
              gotTask = true;
              save(ctx, { taskId });
            },
          },
        );
      } catch (err) {
        if (!gotTask) throw err; // 提交都没成功（断网 / 额度）：环境问题，停下来保留断点
        fail(err instanceof Error ? err.message : '拆镜头失败');
        save(ctx, { taskId: undefined });
        continue;
      }
      let list: ReturnType<typeof parseStoryboard> = [];
      try {
        list = parseStoryboard(raw, ep.id, ctx.project);
        if (list.length === 0) throw new Error('模型未返回合法镜头');
      } catch (err) {
        fail(err instanceof Error ? err.message : '拆镜头失败');
      }
      if (list.length > 0) {
        // 保存失败抛到外层：断点里的任务号指向已完成的任务，重试时直接取回这批镜头
        ctx.project = await mutateProject(workId, (cur) => {
          if (cur.shots.some((s) => s.episodeId === ep.id)) return null; // 运行期间用户已给这一集加了镜头：不覆盖
          return { shots: [...cur.shots.filter((s) => s.episodeId !== ep.id), ...list] };
        });
      }
    }
    save(ctx, { taskId: undefined });
    if (ctx.stop) return 'stop';
  }
  return 'next';
}

// ---------- 叙事机制库 ----------

interface Mechanism {
  id: string;
  title: string;
  summary: string;
}

let mechanismsCache: Promise<Mechanism[]> | null = null;

/** 机制库全表（public/duanju-mechanisms.json，按集筛选）；读不到按空处理，不阻塞拆镜头 */
function loadMechanisms(): Promise<Mechanism[]> {
  mechanismsCache ??= fetch('/duanju-mechanisms.json')
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => ((j?.items ?? []) as Mechanism[]).filter((m) => typeof m?.id === 'string'))
    .catch(() => [] as Mechanism[]);
  return mechanismsCache;
}

/** 阶段的中文步骤名（进度条展示用）；逐集阶段的更细文案在各步骤内设置 */
export const stepLabel = (step: PipelineStep): string => STEP_LABELS[step];
