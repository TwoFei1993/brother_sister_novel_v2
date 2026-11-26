/**
 * 分集剧本三种模式的提示词组装与产出校验（设计共识 2026-11-26 第 3.3 节）：
 * - buildAdaptMessages：从原文切片改编
 * - buildContinueMessages：按梗概续写（沿用前文格式）
 * - buildRewriteMessages：按作者意见重写
 * 本集的数据来源统一由 lib/pipeline/source 的 assembleEpisodeSource 给出；系统词文本见 prompts-episode-rules。
 */
import type { GenerateMessage } from '../../../../api/llm';
import type { DuanjuEpisode, DuanjuProject } from '@shared/duanju';
import { effectiveEpisodeScript, type EpisodeSource } from '../pipeline/source';
import { stripModelWrapper } from '../output-clean';
import { ADAPT_SYSTEM, CONTINUE_SYSTEM, REWRITE_SYSTEM } from './prompts-episode-rules';

/** 人物档案 / 场景档案带进提示词的截断长度 */
const PROFILE_CHARS = 80;
const SPEC_CHARS = 40;
/** 续写时格式范例取前文的开头多少字 */
const FORMAT_SAMPLE_CHARS = 400;
/** 更早各集只带结尾多少字 */
const EARLIER_TAIL_CHARS = 300;
/** 续写时全文带入的最近几集 */
const RECENT_FULL = 2;
/** 产出的最短正文（少于此视为没写完） */
const MIN_SCRIPT_CHARS = 200;

function castList(project: DuanjuProject): string {
  if (project.characters.length === 0) return '（暂无角色档案——人名沿用原文 / 前文里的写法）';
  return project.characters.map((c) => `- ${c.name}：${c.profile.slice(0, PROFILE_CHARS)}`).join('\n');
}

function sceneList(project: DuanjuProject): string {
  if (project.scenes.length === 0) return '（暂无场景档案——地点名沿用原文 / 前文里的写法）';
  return project.scenes.map((s) => `- ${s.name}：${s.spec.slice(0, SPEC_CHARS)}`).join('\n');
}

/** 全剧背景：审核卡 + 人物 / 场景清单（人名与场景名以档案写法为准——拆镜头按名精确匹配） */
function seriesBlock(project: DuanjuProject): string {
  const rc = project.reviewCards;
  return [
    `全剧：目标 ${project.targetEpisodes} 集。`,
    rc.summary ? `剧情概括：${rc.summary}` : '',
    rc.conflict ? `主要冲突：${rc.conflict}` : '',
    rc.characterRelations ? `人物关系：${rc.characterRelations}` : '',
    `人物清单：\n${castList(project)}`,
    `场景清单：\n${sceneList(project)}`,
  ]
    .filter(Boolean)
    .join('\n');
}

function episodeBlock(ep: DuanjuEpisode, src: EpisodeSource): string {
  return [
    `【本集】第 ${ep.index} 集《${ep.title}》`,
    `本集梗概：${ep.synopsis.trim() || '（无）'}`,
    src.prevTail ? `上一集结尾（开场承接它的状态，不复述）：\n…${src.prevTail}` : '',
    src.nextSynopsis ? `下一集梗概（不要写进去）：${src.nextSynopsis}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

const user = (parts: Array<string | false | undefined>): GenerateMessage => ({
  role: 'user',
  content: parts.filter((p): p is string => Boolean(p)).join('\n\n'),
});

export function buildAdaptMessages(project: DuanjuProject, ep: DuanjuEpisode, src: EpisodeSource): GenerateMessage[] {
  return [
    { role: 'system', content: ADAPT_SYSTEM },
    user([
      seriesBlock(project),
      episodeBlock(ep, src),
      src.source
        ? [src.anchorsNote ? `范围说明：${src.anchorsNote}` : '', `【本集对应原文】\n${src.source.text}`]
            .filter(Boolean)
            .join('\n')
        : '（没有可用的原文——按本集梗概写，不自行发明主线之外的事件）',
      `请输出第 ${ep.index} 集完整剧本。`,
    ]),
  ];
}

/** 本集之前已有剧本的集：最近几集（全文带入）与更早的集（只带结尾） */
function previousScripts(
  project: DuanjuProject,
  ep: DuanjuEpisode,
): { recent: DuanjuEpisode[]; earlier: DuanjuEpisode[]; scriptOf: (e: DuanjuEpisode) => string } {
  const before = project.episodes.filter((e) => e.index < ep.index && effectiveEpisodeScript(project, e));
  return {
    recent: before.slice(-RECENT_FULL),
    earlier: before.slice(0, -RECENT_FULL),
    scriptOf: (e) => effectiveEpisodeScript(project, e)!.trim(),
  };
}

export function buildContinueMessages(project: DuanjuProject, ep: DuanjuEpisode, src: EpisodeSource): GenerateMessage[] {
  const { recent, earlier, scriptOf } = previousScripts(project, ep);
  const latest = recent.at(-1);
  return [
    { role: 'system', content: CONTINUE_SYSTEM },
    user([
      seriesBlock(project),
      episodeBlock(ep, src),
      recent.length > 0
        ? `【最近剧本（全文）】\n${recent.map((e) => `第 ${e.index} 集《${e.title}》：\n${scriptOf(e)}`).join('\n\n')}`
        : '',
      earlier.length > 0
        ? `【更早各集结尾】\n${earlier.map((e) => `第 ${e.index} 集：…${scriptOf(e).slice(-EARLIER_TAIL_CHARS)}`).join('\n')}`
        : '',
      latest
        ? `【前文格式范例】（排版与写法照此）\n${scriptOf(latest).slice(0, FORMAT_SAMPLE_CHARS)}`
        : '（没有前文范例：用场次式——每场以「场1 内·地点·日」这样的场次行开头，对白写成「角色名：台词」）',
      `请输出第 ${ep.index} 集完整剧本。`,
    ]),
  ];
}

export function buildRewriteMessages(
  project: DuanjuProject,
  ep: DuanjuEpisode,
  currentScript: string,
  directive: string,
): GenerateMessage[] {
  return [
    { role: 'system', content: REWRITE_SYSTEM },
    user([
      seriesBlock(project),
      `【本集】第 ${ep.index} 集《${ep.title}》\n本集梗概：${ep.synopsis.trim() || '（无）'}`,
      `【作者修改意见】\n${directive.trim()}`,
      `【本集现有剧本】\n${currentScript.trim()}`,
      `请输出修订后的第 ${ep.index} 集完整剧本。`,
    ]),
  ];
}

/** 模型输出 → 剧本正文（剥代码块围栏与首尾解释行） */
export const cleanEpisodeScript = stripModelWrapper;

/** 产出的剧本是否可用：不可用返回人话原因 */
export function validateEpisodeScript(text: string): string | null {
  if (!text.trim()) return '模型没有输出剧本';
  if (text.trim().length < MIN_SCRIPT_CHARS) return `剧本过短（${text.trim().length} 字），可能没写完`;
  return null;
}
