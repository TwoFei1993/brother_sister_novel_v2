/**
 * 短剧剧本环节 prompt 模板（共识 D5 / 资料第 2 课）
 *
 * - buildScriptGenMessages：AI 生成剧本（竖屏短剧规格，60-120 秒/集、强钩子）
 * - buildBreakdownMessages：剧本 → 结构化拆解 JSON（审核卡数据源 + 违审替换建议）
 * - parseBreakdown：模型输出 → BreakdownResult（容错：剥围栏/截大括号/字段过滤）
 */
import type { GenerateMessage } from '../../../api/llm';
import { extractJsonObject } from './json-extract';

/** 剧本生成系统词：竖屏短剧规格（资料第 1-2 课的形态要求） */
const SCRIPT_SYSTEM = `你是资深竖屏短剧编剧。你写的剧本符合以下规格：
- 每集 60-120 秒，约 8-12 个镜头
- 开头 3 秒强钩子，结尾留悬念钩子
- 台词口语化、短句、情绪浓度高
- 动作描写全部可视化（可拍成画面），不写心理独白
- 以「镜头」为最小单位组织：场景、人物、动作、台词分明`;

export interface ScriptGenInput {
  /** 题材描述（自由文本） */
  genre: string;
  /** 基调文风 */
  tone: string;
  /** 一句话想法 / 故事梗概 */
  idea: string;
  /** 主角设定（新建时可留空） */
  protagonists: string;
  /** 目标集数 */
  targetEpisodes: number;
}

export function buildScriptGenMessages(input: ScriptGenInput): GenerateMessage[] {
  const user = [
    `题材：${input.genre}`,
    `基调：${input.tone}`,
    input.protagonists ? `主角设定：${input.protagonists}` : '主角设定：（由你构思，保持精简鲜明）',
    `目标集数：${input.targetEpisodes} 集（本次先写第 1 集完整剧本，结尾附第 2 集钩子预告）`,
    `故事想法：${input.idea}`,
  ].join('\n');
  return [
    { role: 'system', content: SCRIPT_SYSTEM },
    {
      role: 'user',
      content: `${user}\n\n请输出第 1 集完整剧本。格式：每行一个镜头，形如「场景｜人物｜动作｜台词」。`,
    },
  ];
}

/** 拆解系统词：严格 JSON 输出（planner 惯例：不包 markdown 代码块） */
const BREAKDOWN_SYSTEM = `你是短剧制片审核助手。把给定剧本拆解为结构化审核卡，用于后续角色/场景/分镜制作。
只输出一个 JSON 对象，不要 markdown 代码块、不要解释文字。字段：
{
  "summary": "剧情概括（100字内）",
  "eventChain": ["事件1", "事件2"],
  "conflict": "主要冲突",
  "characterRelations": "人物关系描述",
  "emotionPoints": ["情绪点1"],
  "visualActions": ["把心理描写转成的可见动作"],
  "riskReplacements": [{"original": "高风险表达", "replacement": "中性可视化描述"}],
  "episodes": [{"index": 1, "title": "集名", "synopsis": "本集梗概(50字内)"}]
}
要求：episodes 覆盖剧本中的全部集，按剧本顺序；riskReplacements 只挑真正有平台审核风险的表达（暴力直写/血腥细节/敏感词），没有则空数组；visualActions 把剧本里的心理独白转成可拍摄的动作。`;

export interface BreakdownResult {
  summary: string;
  eventChain: string[];
  conflict: string;
  characterRelations: string;
  emotionPoints: string[];
  visualActions: string[];
  riskReplacements: { original: string; replacement: string }[];
  episodes: { index: number; title: string; synopsis: string }[];
}

/**
 * 拆解产出的集列表与现有 episodes 按 index 合并：已存在的集**保留原 id**
 * （深度测试抓出：全量重建新 id 会让旧集的 shots 成孤儿——数据留存但 UI 永不显示）；
 * 新 index 才新建 id。
 * 防丢数据：旧集中**挂有镜头**的（用户手动建过镜头），即使模型本次未提及也追加保留。
 */
export function mergeEpisodes(
  existing: ReadonlyArray<{ id: string; index: number; title: string; synopsis: string }>,
  parsed: ReadonlyArray<{ index: number; title: string; synopsis: string }>,
  shotsWithEp: ReadonlyArray<{ episodeId: string }> = [],
): Array<{ id: string; index: number; title: string; synopsis: string }> {
  const now = Date.now();
  const merged = parsed.map((e) => {
    const found = existing.find((x) => x.index === e.index);
    return found
      ? { ...found, title: e.title, synopsis: e.synopsis }
      : { id: `ep-${now}-${e.index}`, index: e.index, title: e.title, synopsis: e.synopsis };
  });
  const mergedIds = new Set(merged.map((e) => e.id));
  for (const ep of existing) {
    if (mergedIds.has(ep.id)) continue;
    const hasShots = shotsWithEp.some((s) => s.episodeId === ep.id);
    if (hasShots) merged.push(ep); // 用户投过镜头的集不因模型未提及而丢
  }
  return merged;
}

export function buildBreakdownMessages(scriptText: string, targetEpisodes: number): GenerateMessage[] {
  return [
    { role: 'system', content: BREAKDOWN_SYSTEM },
    { role: 'user', content: `目标集数：${targetEpisodes} 集\n\n剧本原文：\n${scriptText}` },
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
          .map((x) => ({
            index: x.index,
            title: x.title,
            synopsis: typeof x.synopsis === 'string' ? x.synopsis : '',
          }))
      : [],
  };
}
