/**
 * 单集剧本生成（设计共识 2026-11-26 第 3.3 节）：组装提示词 → 后台任务 → 清洗与校验。
 * 手动入口（剧本 tab 的改编 / 续写 / 重写）与流水线共用；结果先进草稿还是直接落库由调用方决定。
 */
import type { DuanjuEpisode, DuanjuProject } from '@shared/duanju';

import {
  buildAdaptMessages,
  buildContinueMessages,
  buildRewriteMessages,
  cleanEpisodeScript,
  validateEpisodeScript,
} from '../prompts/prompts-episode';
import { runBgTask, type BgTaskBody, type PollOptions } from './bgTask';
import { assembleEpisodeSource, effectiveEpisodeScript } from './source';

export interface LlmPrefsLite {
  source: string;
  model: string;
}

/** rewrite=按作者意见重写现有剧本；缺省=按本集来源自动选择改编或续写 */
export interface EpisodeGenOptions extends PollOptions {
  kind?: 'rewrite';
  /** 重写时的修改意见 */
  directive?: string;
  /** 断点里的在途任务：先查它的状态，不盲目重提 */
  existingTaskId?: string;
  onSubmitted?: (taskId: string) => void;
}

/** 本集用哪种方式写（给按钮与进度文案用） */
export function episodeGenMode(project: DuanjuProject, ep: DuanjuEpisode): 'adapt' | 'continue' {
  return assembleEpisodeSource(project, ep).mode;
}

export function episodeTaskBody(project: DuanjuProject, ep: DuanjuEpisode, prefs: LlmPrefsLite, opts: EpisodeGenOptions = {}): BgTaskBody {
  let messages: BgTaskBody['messages'];
  let action: string;
  if (opts.kind === 'rewrite') {
    messages = buildRewriteMessages(project, ep, effectiveEpisodeScript(project, ep) ?? '', opts.directive ?? '');
    action = '重写剧本';
  } else {
    const src = assembleEpisodeSource(project, ep);
    messages = src.mode === 'continue' ? buildContinueMessages(project, ep, src) : buildAdaptMessages(project, ep, src);
    action = src.mode === 'continue' ? '续写剧本' : '改编剧本';
  }
  return {
    source: prefs.source,
    model: prefs.model,
    messages,
    thinking: false,
    params: { max_tokens: 32000 },
    label: `${action}·第${ep.index}集`,
  };
}

/** 生成某一集的剧本，返回清洗后的正文；模型没给出可用剧本时抛人话错误 */
export async function generateEpisodeScript(
  project: DuanjuProject,
  ep: DuanjuEpisode,
  prefs: LlmPrefsLite,
  opts: EpisodeGenOptions = {},
): Promise<string> {
  const text = cleanEpisodeScript(await runBgTask(episodeTaskBody(project, ep, prefs, opts), opts));
  const problem = validateEpisodeScript(text);
  if (problem) throw new Error(problem);
  return text;
}
