/**
 * 移动端 TTS 音色管理（创作+阅读共用）：
 *
 * - ALL_VOICES：Edge 免费音色（18）+ MiniMax 预置音色（8）= 全部可选
 * - 段落说话人路由：routeMobileParas（跨段延续说话人；自动分声用 voice-route 的 autoCastVoices）
 * - 持久化：作品级 voiceMap（VoiceCastPane 写 PATCH；localStorage 仅旧版 cast 兼容读取）
 */
import { MINIMAX_VOICES, NARRATOR_SPEAKER, NARRATOR_VOICE_KEY, SPEAKER_NAME_PREFIX, VOICES, routeParagraphs } from './voice-route';

/** 正文识别出的候选角色（说话人前缀命中，按出现次数降序） */
export interface DetectedSpeaker {
  name: string;
  count: number;
}

/** 叙述尾巴（「崔氏笑道」「丫鬟急道」这类 叙述+冒号 误报）：叠代裁剪后归一为角色名 */
const NARRATION_TAIL =
  /(?:低声|大声|连忙|急忙|轻声|又|再|在旁边|心中)?(?:说道?|笑道|笑着?|问道?|喊道?|劝道?|叹道?|答道?|吩咐|念叨|嘟囔|嘀咕|开口|急道|笑)$/;

/** 场景词/代词开头的明显非角色名 */
const NOT_A_NAME = /^[她它]|旁边|心里|顿时|随即|一眼|点头|摇头/;

/** 归一化说话人：裁掉尾部叙述动词（崔氏笑道→崔氏；叠代 ≤3 次处理「低声劝道」叠加） */
function normalizeSpeaker(raw: string): string {
  let name = raw;
  for (let i = 0; i < 3; i += 1) {
    const next = name.replace(NARRATION_TAIL, '');
    if (next === name) break;
    name = next;
  }
  return name;
}

/**
 * 从章节正文扫描说话人（与 routeParagraphs 同一前缀规则 + 叙述尾巴归一/过滤）：
 * 返回不在 known 集合里的角色名及出现次数（降序），供「识别正文角色」一键配声。
 */
export function scanSpeakers(paras: readonly string[], known: ReadonlySet<string>): DetectedSpeaker[] {
  const counts = new Map<string, number>();
  for (const para of paras) {
    const m = SPEAKER_NAME_PREFIX.exec(para.trim());
    if (!m) continue;
    const name = normalizeSpeaker(m[1]!);
    if (!name || name.length > 8 || NOT_A_NAME.test(name)) continue;
    if (known.has(name)) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

/** 音色展示分组（选择器分节渲染） */
export type CastGroup = 'edge' | 'cast' | 'narrator' | 'cantonese';

export interface CastVoiceOption {
  /** 唯一 id：Edge 直接用 easyvoice 音色名；MiniMax 加 mm: 前缀 */
  id: string;
  name: string;
  gender: 'female' | 'male';
  /** 引擎标记（决定 /api/tts/minimax 还是 easyvoice 路由） */
  engine: 'easyvoice' | 'minimax';
  /** 展示分组 */
  group: CastGroup;
}

const fitGroup = (fit: string): CastGroup => (fit === '粤语' ? 'cantonese' : fit === '旁白' ? 'narrator' : 'cast');

export const ALL_VOICES: readonly CastVoiceOption[] = [
  ...VOICES.map((v) => ({ id: v.voice, name: v.name, gender: v.gender, engine: 'easyvoice' as const, group: 'edge' as const })),
  ...MINIMAX_VOICES.map((v) => ({
    id: `mm:${v.voice}`,
    name: v.name,
    gender: v.gender,
    engine: 'minimax' as const,
    group: fitGroup(v.fit),
  })),
];

/** 音色 id → 引擎 */
export function engineOf(id: string): 'easyvoice' | 'minimax' {
  return id.startsWith('mm:') ? 'minimax' : 'easyvoice';
}

/** 音色 id → 底层合成用音色名 */
export function synthVoiceOf(id: string): string {
  return id.startsWith('mm:') ? id.slice(3) : id;
}

/** 旁白默认音色 id */
export const NARRATOR_CAST_ID = 'mm:presenter_female';

/** 旧数据兼容：主持人音色曾误存连字符 id（与 MiniMax 官方 voice_id 不符，合成必败） */
const LEGACY_ID_FIX: Record<string, string> = {
  'mm:presenter-female': 'mm:presenter_female',
  'mm:presenter-male': 'mm:presenter_male',
};

/** 单个音色 id 规范化（旧连字符 id → 真实 id） */
export function normalizeCastId(id: string): string {
  return LEGACY_ID_FIX[id] ?? id;
}

/** 整表规范化（routeMobileParas 与配音面板读入时自愈旧数据） */
export function normalizeVoiceMap(voiceMap: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  let changed = false;
  for (const [name, id] of Object.entries(voiceMap)) {
    const fixed = normalizeCastId(id);
    if (fixed !== id) changed = true;
    out[name] = fixed;
  }
  return changed ? out : voiceMap;
}

/** 移动端路由后段落（text 送合成；speaker 供展示，旁白为 'narrator'） */
export interface MobileRoutedPara {
  text: string;
  voice: string;
  speaker: string;
}

/** 引号开字符（无前缀引号对白 = 延续上一说话人，与 voice-route 同表） */
const QUOTE_OPENERS: readonly string[] = ['「', '『', '“'];

/**
 * 移动端段落说话人路由：入参已切好的段落逐段走 routeParagraphs，
 * 并把「前文最近说话人」跨段传递——routeParagraphs 的引号延续只在段内生效，
 * 无前缀引号开头的段在此显式归属上一说话人。旁白声取 voiceMap 的 narrator 键，缺省主持人女。
 */
export function routeMobileParas(
  paras: readonly string[],
  voiceMap: Record<string, string>,
): MobileRoutedPara[] {
  const vm = normalizeVoiceMap(voiceMap);
  const narrator = vm[NARRATOR_VOICE_KEY] || NARRATOR_CAST_ID;
  const out: MobileRoutedPara[] = [];
  let lastSpeaker: string | null = null;
  for (const text of paras) {
    const [routed] = routeParagraphs(text, vm, [], narrator);
    if (!routed) continue;
    const carried =
      routed.speaker === NARRATOR_SPEAKER &&
      lastSpeaker !== null &&
      QUOTE_OPENERS.some((q) => text.startsWith(q));
    if (carried && lastSpeaker !== null) {
      out.push({ text, voice: vm[lastSpeaker] ?? narrator, speaker: lastSpeaker });
    } else {
      out.push(routed);
      if (routed.speaker !== NARRATOR_SPEAKER) lastSpeaker = routed.speaker;
    }
  }
  return out;
}

const CAST_KEY = 'm-tts-cast-v1';

export function loadCast(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(CAST_KEY) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

export function saveCast(cast: Record<string, string>): void {
  try {
    localStorage.setItem(CAST_KEY, JSON.stringify(cast));
  } catch {
    /* 隐私模式静默 */
  }
}
