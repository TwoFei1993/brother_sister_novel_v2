/**
 * 分集剧本与流水线的数据契约（设计共识 2026-11-26 第 3.1 / 3.6 节）。
 *
 * 独立成文件：这组契约只被剧本 tab 与流水线使用，且 shared/duanju.ts 已过行数上限。
 * 本文件不反向依赖 duanju.ts（主文件 import 本文件，避免循环）。
 */
import { z } from 'zod';

/** 分集剧本来源：adapted=从原文改编 / continued=按梗概续写 / manual=手写、采用或原文 */
export const EPISODE_SCRIPT_SOURCES = ['adapted', 'continued', 'manual'] as const;
export const EpisodeScriptSourceSchema = z.enum(EPISODE_SCRIPT_SOURCES);
export type EpisodeScriptSource = z.infer<typeof EpisodeScriptSourceSchema>;

/** 原文性质：full=整本小说（各集改编）/ episode1=只有第 1 集（第 2 集起续写） */
export const SCRIPT_SCOPES = ['full', 'episode1'] as const;
export const ScriptScopeSchema = z.enum(SCRIPT_SCOPES);
export type ScriptScope = z.infer<typeof ScriptScopeSchema>;

const ts = z.number().int().nonnegative();

/**
 * 出图时的上游态快照：客户端发起生成时取、随请求带给服务端写进镜头的 BuiltFrom
 * （此前两端各写一份内联类型且客户端侧是 unknown）。
 */
export const BuiltFromHintSchema = z.strictObject({
  scriptAt: ts.optional(),
  /** characterId → 该角色当时的 updatedAt */
  charAt: z.record(z.string(), ts).optional(),
  /** sceneId → 该场景当时的 updatedAt */
  sceneAt: z.record(z.string(), ts).optional(),
  /** 本集剧本正文当时的更新时刻（没有分集剧本记 0） */
  episodeScriptAt: ts.optional(),
});
export type BuiltFromHint = z.infer<typeof BuiltFromHintSchema>;

/** 流水线偏好（按作品，存在 project.pipeline） */
export const DuanjuPipelineSchema = z.strictObject({
  /** 剧本写完后先停下等审，不自动接着拆镜头（默认关） */
  pauseAfterScripts: z.boolean().optional(),
});
export type DuanjuPipeline = z.infer<typeof DuanjuPipelineSchema>;

/** 流水线阶段（顺序即执行顺序） */
export const PIPELINE_STEPS = ['character', 'scene', 'script', 'storyboard'] as const;
export const PipelineStepSchema = z.enum(PIPELINE_STEPS);
export type PipelineStep = z.infer<typeof PipelineStepSchema>;

/** 单集失败条目（逐集阶段某集失败不中断，结束时汇总） */
export const PipelineFailureSchema = z.strictObject({
  step: z.enum(['script', 'storyboard']),
  /** 集号（从 1 起） */
  index: z.number().int().positive(),
  reason: z.string(),
});
export type PipelineFailure = z.infer<typeof PipelineFailureSchema>;

/**
 * 流水线断点（存 localStorage）：页面被回收或刷新后，下次打开该作品从断点接着跑。
 * 主动停止会删除断点（不再续跑）；停靠保留断点并标 paused（不自动续跑，等用户点继续）。
 */
export const PipelineCheckpointSchema = z.strictObject({
  workId: z.string(),
  step: PipelineStepSchema,
  /** 集序号游标：逐集阶段下一个要处理的集号（从 1 起；非逐集阶段无意义，记 1） */
  cursor: z.number().int().positive(),
  /** 在途后台任务 id：续跑先查它的状态——已完成直接取结果，运行中接着轮询，失败或丢失才重提 */
  taskId: z.string().optional(),
  failed: z.array(PipelineFailureSchema),
  paused: z.boolean().optional(),
  /** 只写剧本、不拆镜头（剧本 tab 的「一键改编全部未写集」）。写进断点：被动中断后续跑照旧只写剧本 */
  onlyScript: z.boolean().optional(),
  updatedAt: ts,
});
export type PipelineCheckpoint = z.infer<typeof PipelineCheckpointSchema>;

/**
 * 原文性质推断（设计 3.3）：行首出现 2 次及以上「第 N 章 / 回 / 节 / 卷」标题（N 为阿拉伯或中文数字；「第 N 集」不算），
 * 或超过 1.5 万字 → full；否则 → episode1。客户端的切片定位与服务端的导出都用这一份，两边判断一致。
 */
const FULL_TEXT_CHARS = 15_000;
const CHAPTER_HEADING = /^\s*第\s*[0-9０-９一二三四五六七八九十百千两零〇]+\s*[章回节卷]/gm;

export function inferScriptScope(text: string): ScriptScope {
  if (text.length > FULL_TEXT_CHARS) return 'full';
  let headings = 0;
  for (const _ of text.matchAll(CHAPTER_HEADING)) headings += 1;
  return headings >= 2 ? 'full' : 'episode1';
}

/** 已保存的性质优先；没有则按原文推断 */
export function scriptScopeOf(project: { script: { text: string; scope?: ScriptScope } }): ScriptScope {
  return project.script.scope ?? inferScriptScope(project.script.text);
}
