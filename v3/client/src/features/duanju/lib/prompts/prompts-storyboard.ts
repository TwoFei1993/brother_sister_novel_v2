/**
 * 分镜环节 prompt 库（共识 D7/D8 / 资料第 5-6 课）
 *
 * - buildStoryboardMessages：AI 按集拆镜头（输出 Shot[] JSON，含四格画面描述）
 * - parseStoryboard：容错解析 + 角色/场景名 → id 映射
 * - buildGridPrompt：四宫格生图 prompt 组装器（外观锚点∪场景∪画风∪四格）
 * - buildVideoPrompt：即梦视频提示词（独立画板/衔接/站位/景别/声音）
 */
import type { GenerateMessage } from '../../../../api/llm';
import type { DuanjuCharacter, DuanjuProject, DuanjuScene, DuanjuShot } from '@shared/duanju';
import { stylePrefix } from './prompts-image';
import { extractJsonArray } from '../json-extract';

// ---------- AI 拆镜头 ----------

const STORYBOARD_SYSTEM = `你是短剧分镜师。把给定某集剧本拆成镜头清单。
只输出 JSON 数组，不要 markdown 代码块、不要解释。每项：
{"shotSize":"景别(远景/全景/中景/近景/特写)","cameraMove":"运镜(固定/推/拉/摇/移/跟)",
 "actionStart":"动作起点","actionEnd":"动作终点","staging":"人物站位",
 "dialog":"台词(无则空串)","sound":"声音要求(环境音/动作声/对白声)",
 "gridParts":["第1格画面","第2格画面","第3格画面","第4格画面"],
 "characters":["出场角色名(须来自角色清单)"],"scene":"场景名(须来自场景清单,可空)"}
要求：gridParts 四格各画一个连续动作瞬间（每格只放一个核心动作，动作与情绪是钉点）；
一集 6-12 镜头；动作起终点可视化。`;

export function buildStoryboardMessages(
  episodeSynopsis: string,
  scriptText: string,
  characters: DuanjuCharacter[],
  scenes: DuanjuScene[],
): GenerateMessage[] {
  const charList = characters.map((c) => `- ${c.name}：${c.profile}`).join('\n') || '（无角色，按剧本人名）';
  const sceneList = scenes.map((s) => `- ${s.name}：${s.spec}`).join('\n') || '（无场景清单，按剧本场景自由命名）';
  return [
    { role: 'system', content: STORYBOARD_SYSTEM },
    {
      role: 'user',
      content: `本集梗概：${episodeSynopsis}\n\n角色清单：\n${charList}\n\n场景清单：\n${sceneList}\n\n剧本原文：\n${scriptText}`,
    },
  ];
}

interface RawShot {
  shotSize?: unknown;
  cameraMove?: unknown;
  actionStart?: unknown;
  actionEnd?: unknown;
  staging?: unknown;
  dialog?: unknown;
  sound?: unknown;
  gridParts?: unknown;
  characters?: unknown;
  scene?: unknown;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** 解析拆镜头输出并映射 id（角色/场景按名匹配，未匹配的忽略） */
export function parseStoryboard(
  raw: string,
  episodeId: string,
  project: DuanjuProject,
): DuanjuShot[] {
  const arr = extractJsonArray(raw);
  if (!arr) return [];
  const base = Date.now();
  return arr
    .filter((x): x is RawShot => typeof x === 'object' && x !== null)
    .map((x, i): DuanjuShot => {
      const names = Array.isArray(x.characters)
        ? x.characters.filter((n): n is string => typeof n === 'string')
        : [];
      const characterIds = names
        .map((n) => project.characters.find((c) => c.name === n)?.id)
        .filter((v): v is string => !!v);
      const sceneName = str(x.scene);
      const scene = sceneName ? project.scenes.find((s) => s.name === sceneName) : undefined;
      const parts = Array.isArray(x.gridParts)
        ? x.gridParts.filter((p): p is string => typeof p === 'string').slice(0, 4)
        : [];
      return {
        id: `shot-${base}-${i}-${Math.random().toString(36).slice(2, 6)}`,
        episodeId,
        index: i + 1,
        shotSize: str(x.shotSize) || '中景',
        cameraMove: str(x.cameraMove) || '固定',
        actionStart: str(x.actionStart),
        actionEnd: str(x.actionEnd),
        staging: str(x.staging),
        dialog: str(x.dialog),
        sound: str(x.sound),
        gridParts: parts,
        gridPrompt: '',
        frames: [],
        characterIds,
        sceneId: scene?.id ?? null,
        updatedAt: base,
      };
    })
    .map((shot) => ({ ...shot, gridPrompt: buildGridPrompt(shot, shot.gridParts, project) }));
}

/** AI 输出的四格描述按 index 对应（parse 内部用） */
function findParts(arr: unknown[], shot: DuanjuShot): string[] {
  const idx = shot.index - 1;
  const raw = arr[idx] as RawShot | undefined;
  return Array.isArray(raw?.gridParts)
    ? raw.gridParts.filter((p): p is string => typeof p === 'string').slice(0, 4)
    : [];
}

// ---------- 四宫格 prompt 组装（D7：一张 2×2 整图） ----------

export function buildGridPrompt(shot: DuanjuShot, gridParts: string[], project: DuanjuProject): string {
  const chars = shot.characterIds
    .map((cid) => project.characters.find((c) => c.id === cid))
    .filter((c): c is DuanjuCharacter => !!c);
  const scene = shot.sceneId ? project.scenes.find((s) => s.id === shot.sceneId) : undefined;
  const parts = gridParts.length > 0 ? gridParts : ['起手动作', '动作进行', '高潮瞬间', '收势定格'];
  return [
    `${stylePrefix(project.style)}，四宫格分镜图（2×2 田字布局，四格之间细白分隔线，每格画同一镜头的连续动作瞬间）`,
    chars.length > 0
      ? `【出场人物】${chars.map((c) => `${c.name}（${c.profile}）`).join('；')}——四格中同一人物形象必须完全一致`
      : '【无人物】纯场景四格',
    scene ? `【场景】${scene.name}（${scene.spec}）` : '',
    `【镜头】景别：${shot.shotSize}；站位：${shot.staging}`,
    `第1格：${parts[0] ?? ''}`,
    `第2格：${parts[1] ?? ''}`,
    `第3格：${parts[2] ?? ''}`,
    `第4格：${parts[3] ?? ''}`,
    '要求：每格只放一个核心动作，动作连贯，画面风格统一，无文字水印',
  ]
    .filter(Boolean)
    .join('\n');
}

// ---------- 分帧 prompt（成本优化：单帧生成/重roll，修一格只花 1 张钱） ----------

const DEFAULT_PARTS = ['起手动作', '动作进行', '高潮瞬间', '收势定格'];

/** 单帧生图 prompt：画风 + 人物锚点 + 场景 + 该帧画面描述（数据源 shot.gridParts，可编辑） */
export function buildFramePrompt(shot: DuanjuShot, frameIndex: number, project: DuanjuProject): string {
  const chars = shot.characterIds
    .map((cid) => project.characters.find((c) => c.id === cid))
    .filter((c): c is DuanjuCharacter => !!c);
  const scene = shot.sceneId ? project.scenes.find((s) => s.id === shot.sceneId) : undefined;
  const parts = shot.gridParts?.length ? shot.gridParts : DEFAULT_PARTS;
  const desc = parts[frameIndex - 1] ?? `第 ${frameIndex} 帧画面`;
  return [
    `${stylePrefix(project.style)}，单帧分镜图（同一镜头连续动作第 ${frameIndex}/4 帧）`,
    chars.length > 0
      ? `【出场人物】${chars.map((c) => `${c.name}（${c.profile}）`).join('；')}——与同镜头其他帧同一人物形象完全一致`
      : '【无人物】纯场景帧',
    scene ? `【场景】${scene.name}（${scene.spec}）` : '',
    `【镜头】景别：${shot.shotSize}；站位：${shot.staging}`,
    `画面内容：${desc}`,
    '要求：只画这一个动作瞬间，画面干净，构图横平竖直，无文字水印',
  ]
    .filter(Boolean)
    .join('\n');
}

// ---------- 即梦视频提示词（D8：镜头卡一键复制） ----------

export function buildVideoPrompt(shot: DuanjuShot, project: DuanjuProject): string {
  const chars = shot.characterIds
    .map((cid) => project.characters.find((c) => c.id === cid))
    .filter((c): c is DuanjuCharacter => !!c)
    .map((c) => c.name);
  const scene = shot.sceneId ? project.scenes.find((s) => s.id === shot.sceneId) : undefined;
  return [
    `以分镜参考图按顺序生成视频（图生视频，画板/图片顺序即时间顺序）`,
    `人物：${chars.join('、') || '（按图）'}；场景：${scene?.name ?? '按图'}`,
    `景别：${shot.shotSize}；运镜：${shot.cameraMove}；站位：${shot.staging}`,
    `动作：从「${shot.actionStart}」到「${shot.actionEnd}」，动作自然衔接`,
    shot.dialog ? `对白：「${shot.dialog}」` : '无对白',
    `声音：${shot.sound || '环境音与动作声，无背景音乐'}`,
    `画风：${project.style}，与参考图保持一致`,
  ].join('\n');
}
