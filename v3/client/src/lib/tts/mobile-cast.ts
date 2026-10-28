/**
 * 移动端 TTS 音色管理（创作+阅读共用）：
 *
 * - ALL_VOICES：Edge 免费音色（6）+ MiniMax 预置音色（8）= 全部可选
 * - 自动分声：按角色名性别线索（autoAssignVoices）自动匹配男女声，旁白固定主持人
 * - 持久化：localStorage 'm-tts-cast'（角色名→音色 id 映射），「自动分配」可重置
 */
import { MINIMAX_VOICES, VOICES } from './voice-route';

export interface CastVoiceOption {
  /** 唯一 id：Edge 直接用 easyvoice 音色名；MiniMax 加 mm: 前缀 */
  id: string;
  name: string;
  gender: 'female' | 'male';
  /** 引擎标记（决定 /api/tts/minimax 还是 easyvoice 路由） */
  engine: 'easyvoice' | 'minimax';
}

export const ALL_VOICES: readonly CastVoiceOption[] = [
  ...VOICES.map((v) => ({ id: v.voice, name: v.name, gender: v.gender, engine: 'easyvoice' as const })),
  ...MINIMAX_VOICES.map((v) => ({ id: `mm:${v.voice}`, name: v.name, gender: v.gender, engine: 'minimax' as const })),
];

/** 音色 id → 引擎 */
export function engineOf(id: string): 'easyvoice' | 'minimax' {
  return id.startsWith('mm:') ? 'minimax' : 'easyvoice';
}

/** 音色 id → 底层合成用音色名 */
export function synthVoiceOf(id: string): string {
  return id.startsWith('mm:') ? id.slice(3) : id;
}

/** 角色名性别线索（与 autoCastVoices 同表） */
const FEMALE_HINTS = ['妹', '姐', '娘', '女', '婉', '月', '雪', '莹', '霞', '妃', '后', '嫔', '嬷', '嫂', '姨', '姬', '妲', '鸾'];
const MALE_HINTS = ['哥', '兄', '爷', '王', '帝', '君', '叔', '爸', '爹', '公', '侯', '帅', '郎', '殿下'];

export function guessGender(name: string): 'male' | 'female' {
  for (const h of MALE_HINTS) if (name.includes(h)) return 'male';
  for (const h of FEMALE_HINTS) if (name.includes(h)) return 'female';
  return 'female';
}

/**
 * 自动分声：按角色名性别线索分配男女声，同池轮替不重声；旁白固定主持人女。
 * 返回角色名→音色 id 映射（可直接存 work.voiceMap）。
 */
export function autoAssignVoices(names: readonly string[]): Record<string, string> {
  const male = ALL_VOICES.filter((v) => v.gender === 'male');
  const female = ALL_VOICES.filter((v) => v.gender === 'female');
  let mi = 0;
  let fi = 0;
  const map: Record<string, string> = {};
  for (const name of names) {
    const gender = guessGender(name);
    const pool = gender === 'male' ? male : female;
    const idx = Math.min(gender === 'male' ? mi : fi, pool.length - 1);
    map[name] = pool[idx]!.id;
    if (gender === 'male') mi += 1;
    else fi += 1;
  }
  return map;
}

/** 旁白默认音色 id */
export const NARRATOR_CAST_ID = 'mm:presenter-female';

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
