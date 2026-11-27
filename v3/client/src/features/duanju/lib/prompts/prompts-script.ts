/**
 * 短剧剧本环节 prompt 模板（共识 D5 / 资料第 2 课）
 *
 * - buildScriptGenMessages：AI 生成剧本（竖屏短剧规格，60-120 秒/集、强钩子）
 * - buildBreakdownMessages：剧本 → 结构化拆解 JSON（审核卡数据源 + 违审替换建议 + 分集与原文锚点）
 * - parseBreakdown：模型输出 → BreakdownResult（容错：剥围栏/截大括号/字段过滤）
 * - mergeEpisodes：拆解产出的集列表与现有集合并（保留原 id；挂镜头或已有剧本的旧集不丢）
 */
import type { DuanjuEpisode } from '@shared/duanju';
import type { GenerateMessage } from '../../../../api/llm';
import { extractJsonObject } from '../json-extract';

/** C2 剧本标签规范段（生成/拆解两端共用）：结构化标注画内文字与音效，拆镜头时透传到 onScreenText/sound */
const TAG_RULES = `
结构化标签（需要时使用，无则不写）：
- [画面文字]内容[/画面文字]：画面内需逐字可读的文字（手机屏/招牌/纸条/匾额）——拆镜头时逐字透传；
- [SFX]音效描述[/SFX]：关键音效标注（玻璃碎裂/惊雷/门轴吱呀）——拆镜头时并入该镜声音要求；
标签内不写动作与台词，每标签只标一处。`;

/** 剧本生成系统词：竖屏短剧规格（资料第 1-2 课的形态要求） */
const SCRIPT_SYSTEM = `你是资深竖屏短剧编剧。你写的剧本符合以下规格：
- 每集 60-120 秒，约 8-12 个镜头
- 开头 3 秒强钩子，结尾留悬念钩子
- 台词口语化、短句、情绪浓度高
- 动作描写全部可视化（可拍成画面），不写心理独白
- 以「镜头」为最小单位组织：场景、人物、动作、台词分明${TAG_RULES}`;

export interface ScriptGenInput {
  /** 题材描述（自由文本） */
  genre: string;
  /** 基调文风 */
  tone: string;
  /** 一句话想法 / 完整故事素材（用户反馈 2026-11-27：常贴整段故事，不是第 1 集专用原料） */
  idea: string;
  /** 主角设定（新建时可留空） */
  protagonists: string;
  /** 全剧目标集数 */
  targetEpisodes: number;
  /** 本次从第几集写起（缺省 1） */
  startEpisode?: number;
  /** 本次连续写几集（缺省 1） */
  episodeCount?: number;
}

export function buildScriptGenMessages(input: ScriptGenInput): GenerateMessage[] {
  const start = Math.max(1, Math.floor(input.startEpisode ?? 1));
  const count = Math.max(1, Math.floor(input.episodeCount ?? 1));
  const list = Array.from({ length: count }, (_, i) => `第${start + i}集`).join('、');
  const user = [
    `题材：${input.genre}`,
    `基调：${input.tone}`,
    input.protagonists ? `主角设定：${input.protagonists}` : '主角设定：（由你构思，保持精简鲜明）',
    `故事想法：${input.idea}`,
    `全剧规划 ${input.targetEpisodes} 集；本次从第 ${start} 集起连续写 ${count} 集（${list}）。`,
  ].join('\n');
  return [
    { role: 'system', content: SCRIPT_SYSTEM },
    {
      role: 'user',
      content: `${user}\n\n故事想法可能是完整故事、故事梗概或剧情片段——把它**改编**成短剧剧情（不要逐字搬用原文；素材覆盖不到的地方合理扩充配角冲突与细节）。请依次输出 ${list} 的完整剧本：每集先写一行集标题（形如「第${start}集 集名」），随后每行一个镜头，形如「场景｜人物｜动作｜台词」；每集开头 3 秒强钩子、结尾留悬念钩子衔接下一集。`,
    },
  ];
}

/**
 * 拆解系统词：严格 JSON 输出（planner 惯例：不包 markdown 代码块）。
 * 每集梗概加厚到 150 字内并按结构写（续写没有原文可依，全靠它）；每集另给原文首末句锚点，
 * 供改编时按集截取原文（设计共识 2026-11-26 第 3.2 节）。
 */
const BREAKDOWN_SYSTEM = `你是竖屏短剧的制片策划兼编剧。用户给你的「剧本原文」是一段故事素材——可能是完整故事、故事梗概或剧情片段，你的任务不是把它按原文切分，而是**把它改编扩充成多集竖屏短剧**：以原文的人物、关系与核心冲突为骨架，重新创作每一集——扩充戏剧冲突、增加配角与支线钩子、把概要展开成有起伏的具体情节。
只输出一个 JSON 对象，不要 markdown 代码块、不要解释文字。字段：
{
  "summary": "改编后全剧剧情概括（100字内）",
  "eventChain": ["事件1", "事件2"],
  "conflict": "主要冲突",
  "characterRelations": "人物关系描述",
  "emotionPoints": ["情绪点1"],
  "visualActions": ["把心理描写转成的可见动作"],
  "riskReplacements": [{"original": "高风险表达", "replacement": "中性可视化描述"}],
  "episodes": [{"index": 1, "title": "集名", "synopsis": "本集梗概（150字内，依次写：进入状态 → 本集目标 → 转折 → 结果 → 结尾钩子）", "sourceStart": "本集对应原文的第一句（逐字抄录，20字内；本集为全新创作时写空字符串）", "sourceEnd": "本集对应原文的最后一句（逐字抄录，20字内；本集为全新创作时写空字符串）"}]
}
要求：episodes 集数等于目标集数（不足时基于原故事合理扩充新冲突与新支线，风格与人物保持一致）；按顺序推进，每集剧情不重叠、相邻集衔接；每集都必须基于整段故事改编创作，而不是复述原文片段；riskReplacements 只挑真正有平台审核风险的表达（暴力直写/血腥细节/敏感词），没有则空数组；visualActions 把剧本里的心理独白转成可拍摄的动作。
原文位置：sourceStart 与 sourceEnd 是原文锚点（程序按它们截取本集对应的原文参考段），对应不上原文的集写空字符串。`;

export interface BreakdownResult {
  summary: string;
  eventChain: string[];
  conflict: string;
  characterRelations: string;
  emotionPoints: string[];
  visualActions: string[];
  riskReplacements: { original: string; replacement: string }[];
  episodes: { index: number; title: string; synopsis: string; sourceStart?: string; sourceEnd?: string }[];
}

/** 锚点最长保留字数（模型偶发抄整段；过长时截断——切片定位用前缀降级匹配） */
const ANCHOR_MAX = 60;
const clipAnchor = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, ANCHOR_MAX) : undefined;

/**
 * 拆解产出的集列表与现有 episodes 按 index 合并：已存在的集**保留原 id 与其余字段**
 * （深度测试抓出：全量重建新 id 会让旧集的 shots 成孤儿——数据留存但 UI 永不显示）。
 * 防丢数据：旧集中**挂有镜头或已有剧本**的（用户投过镜头 / 写过这一集），即使模型本次未提及也追加保留。
 */
export function mergeEpisodes(
  existing: ReadonlyArray<DuanjuEpisode>,
  parsed: BreakdownResult['episodes'],
  shotsWithEp: ReadonlyArray<{ episodeId: string }> = [],
): DuanjuEpisode[] {
  const now = Date.now();
  const anchorsOf = (e: BreakdownResult['episodes'][number]): Partial<DuanjuEpisode> => ({
    ...(e.sourceStart ? { sourceStart: e.sourceStart } : {}),
    ...(e.sourceEnd ? { sourceEnd: e.sourceEnd } : {}),
  });
  const merged = parsed.map((e): DuanjuEpisode => {
    const found = existing.find((x) => x.index === e.index);
    return found
      ? { ...found, title: e.title, synopsis: e.synopsis, ...anchorsOf(e) }
      : { id: `ep-${now}-${e.index}`, index: e.index, title: e.title, synopsis: e.synopsis, ...anchorsOf(e) };
  });
  const mergedIds = new Set(merged.map((e) => e.id));
  for (const ep of existing) {
    if (mergedIds.has(ep.id)) continue;
    const hasShots = shotsWithEp.some((s) => s.episodeId === ep.id);
    if (hasShots || ep.script?.trim()) merged.push(ep); // 投过镜头 / 写过剧本的集不因模型未提及而丢
  }
  return merged;
}

export function buildBreakdownMessages(scriptText: string, targetEpisodes: number): GenerateMessage[] {
  return [
    { role: 'system', content: BREAKDOWN_SYSTEM },
    { role: 'user', content: `目标集数：${targetEpisodes} 集\n\n【改编要求】下面的文字是一段故事素材（可能是完整故事、梗概或片段）。请把它改编扩充成 ${targetEpisodes} 集竖屏短剧：保留人物与核心冲突，但每集的情节要有新的发展与钩子，素材不够的地方合理扩充（加配角冲突、支线、细节），不要照搬原文切分。\n\n故事素材：\n${scriptText}` },
  ];
}

/** 从模型输出解析拆解 JSON（容错提取：围栏/解说/尾逗号/注释等污染逐级降级修复） */
export function parseBreakdown(raw: string): BreakdownResult | null {
  const obj = extractJsonObject(raw);
  if (!obj) return null;
  const strArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  return {
    summary: typeof obj.summary === 'string' ? obj.summary : '',
    eventChain: strArr(obj.eventChain),
    conflict: typeof obj.conflict === 'string' ? obj.conflict : '',
    characterRelations: typeof obj.characterRelations === 'string' ? obj.characterRelations : '',
    emotionPoints: strArr(obj.emotionPoints),
    visualActions: strArr(obj.visualActions),
    riskReplacements: Array.isArray(obj.riskReplacements)
      ? obj.riskReplacements
          .filter(
            (x): x is { original: string; replacement: string } =>
              typeof x === 'object' &&
              x !== null &&
              typeof (x as { original?: unknown }).original === 'string' &&
              typeof (x as { replacement?: unknown }).replacement === 'string',
          )
          .map((x) => ({ original: x.original, replacement: x.replacement }))
      : [],
    episodes: Array.isArray(obj.episodes)
      ? obj.episodes
          .filter(
            (x): x is { index: number; title: string; synopsis?: unknown } =>
              typeof x === 'object' &&
              x !== null &&
              typeof (x as { index?: unknown }).index === 'number' &&
              typeof (x as { title?: unknown }).title === 'string',
          )
          .map((x) => {
            const sourceStart = clipAnchor((x as { sourceStart?: unknown }).sourceStart);
            const sourceEnd = clipAnchor((x as { sourceEnd?: unknown }).sourceEnd);
            return {
              index: x.index,
              title: x.title,
              synopsis: typeof x.synopsis === 'string' ? x.synopsis : '',
              ...(sourceStart ? { sourceStart } : {}),
              ...(sourceEnd ? { sourceEnd } : {}),
            };
          })
      : [],
  };
}
