/**
 * TTS 段落说话人路由（设计 §7.3 / Task 29）
 *
 * 把整章/整段文本切成 TTS 段落并为每段选声：
 * - 切分：\n 切行、过滤空行、剥离 #/## 标题前缀（对齐旧站 parseTextForTTS）
 * - 引号跨行合并：未闭合引号段吸收后续行（「」/『』/“” 三种引号）
 * - 说话人识别：`名字：` 前缀 → 该角色声；无前缀引号段 → 前文最近说话人；其余 → 旁白
 * - 声音来源：speakers（运行时补充，如激活角色）先入表，voiceMap（作品级显式配置）同名覆盖；
 *   缺失一律回退 defaultVoice（旁白声）
 */

/** 可用声音（Edge 免费声全量目录：普通话 12 + 粤语 3 + 台湾国语 3） */
export interface VoiceOption {
  id: string;
  name: string;
  /** easyvoice 底层声音名（POST /generate body.voice） */
  voice: string;
  gender: 'female' | 'male';
}

export const VOICES: readonly VoiceOption[] = [
  // 普通话
  { id: 'xiaoxiao', name: '晓晓', voice: 'zh-CN-XiaoxiaoNeural', gender: 'female' },
  { id: 'xiaoyi', name: '小艺', voice: 'zh-CN-XiaoyiNeural', gender: 'female' },
  { id: 'yunxia', name: '云夏', voice: 'zh-CN-YunxiaNeural', gender: 'female' },
  { id: 'xiaobei', name: '小贝', voice: 'zh-CN-liaoning-XiaobeiNeural', gender: 'female' },
  { id: 'xiaoni', name: '小妮', voice: 'zh-CN-shaanxi-XiaoniNeural', gender: 'female' },
  { id: 'yunxi', name: '云希', voice: 'zh-CN-YunxiNeural', gender: 'male' },
  { id: 'yunjian', name: '云健', voice: 'zh-CN-YunjianNeural', gender: 'male' },
  { id: 'yunyang', name: '云扬', voice: 'zh-CN-YunyangNeural', gender: 'male' },
  { id: 'yunze', name: '云泽', voice: 'zh-CN-YunzeNeural', gender: 'male' },
  { id: 'yunfeng', name: '云枫', voice: 'zh-CN-YunfengNeural', gender: 'male' },
  { id: 'yunhao', name: '云皓', voice: 'zh-CN-YunhaoNeural', gender: 'male' },
  { id: 'yunye', name: '云野', voice: 'zh-CN-YunyeNeural', gender: 'male' },
  // 粤语
  { id: 'hiumaan', name: '曉曼', voice: 'zh-HK-HiuMaanNeural', gender: 'female' },
  { id: 'hiugaai', name: '曉佳', voice: 'zh-HK-HiuGaaiNeural', gender: 'female' },
  { id: 'wanlung', name: '雲龍', voice: 'zh-HK-WanLungNeural', gender: 'male' },
  // 台湾国语
  { id: 'hsiaochen', name: '晓臻', voice: 'zh-TW-HsiaoChenNeural', gender: 'female' },
  { id: 'hsiaoyu', name: '晓雨', voice: 'zh-TW-HsiaoYuNeural', gender: 'female' },
  { id: 'yunhui', name: '雲慧', voice: 'zh-TW-YunHuiNeural', gender: 'male' },
];

/** 旁白默认声 id */
export const DEFAULT_VOICE_ID = 'xiaoxiao';

// ---------- MiniMax 音色目录 + 自动分声（安卓 app，speech-2.8-hd） ----------

/** TTS 引擎标记：easyvoice（Edge 音色）/ minimax（speech-2.8，走 /api/tts/minimax 服务端转发） */
export type VoiceEngine = 'easyvoice' | 'minimax';

const MM_PREFIX = 'mm:';

export interface MiniMaxVoiceOption {
  /** 存 voiceMap/speakers 用的 id（带 mm: 前缀） */
  id: string;
  name: string;
  /** MiniMax voice_setting.voice_id */
  voice: string;
  gender: 'female' | 'male';
  /** 适配方向：哥哥/妹妹/旁白候选 */
  fit: string;
}

/** MiniMax 候选音色（试听样本通过的 8 个；霸道青年 ID 无效已剔除） */
export const MINIMAX_VOICES: readonly MiniMaxVoiceOption[] = [
  { id: 'mm:male-qn-qingse', name: '青涩青年', voice: 'male-qn-qingse', gender: 'male', fit: '哥哥' },
  { id: 'mm:male-qn-jingying', name: '精英青年', voice: 'male-qn-jingying', gender: 'male', fit: '哥哥' },
  { id: 'mm:male-qn-daxuesheng', name: '大学生', voice: 'male-qn-daxuesheng', gender: 'male', fit: '哥哥' },
  { id: 'mm:female-shaonv', name: '少女婉婉', voice: 'female-shaonv', gender: 'female', fit: '妹妹' },
  { id: 'mm:female-yujie', name: '御姐', voice: 'female-yujie', gender: 'female', fit: '女性角色' },
  { id: 'mm:female-chengshu', name: '成熟', voice: 'female-chengshu', gender: 'female', fit: '女性角色' },
  { id: 'mm:presenter_female', name: '主持人女', voice: 'presenter_female', gender: 'female', fit: '旁白' },
  { id: 'mm:presenter_male', name: '主持人男', voice: 'presenter_male', gender: 'male', fit: '旁白' },
];

/** 声音 id 是否为 MiniMax 音色 */
export function isMinimaxVoice(id: string): boolean {
  return id.startsWith(MM_PREFIX);
}

/** 声音 id → MiniMax voice_id（非 MiniMax 音色返回 null） */
export function minimaxVoiceOf(id: string): string | null {
  if (!isMinimaxVoice(id)) return null;
  return id.slice(MM_PREFIX.length);
}

const FEMALE_HINTS = ['妹', '姐', '娘', '女', '婉', '月', '雪', '莹', '霞', '妃', '后', '嫔', '嬷', '嫂', '姨', '姬', '妲', '鸾'];
const MALE_HINTS = ['哥', '兄', '爷', '王', '帝', '君', '叔', '爸', '爹', '公', '侯', '帅', '郎', '殿下'];

/** 按名字性别线索猜池（先男表后女表；都未命中默认女池——人名用字女性偏多） */
function guessPool(name: string): 'male' | 'female' {
  for (const h of MALE_HINTS) if (name.includes(h)) return 'male';
  for (const h of FEMALE_HINTS) if (name.includes(h)) return 'female';
  return 'female';
}

/**
 * 自动分声（联测需求）：按出场角色名自动分配 MiniMax 音色——
 * 名字性别线索决定池（男池/女池），池内按出现顺序轮替（同池不重声）；
 * 旁白固定主持人声。返回可直接存 voiceMap 的绑定表。
 */
export function autoCastVoices(names: readonly string[]): Array<{ name: string; voice: string }> {
  const male = MINIMAX_VOICES.filter((v) => v.gender === 'male');
  const female = MINIMAX_VOICES.filter((v) => v.gender === 'female');
  const maleCount = { n: 0 };
  const femaleCount = { n: 0 };
  return names.map((name) => {
    const isMale = guessPool(name) === 'male';
    const pool = isMale ? male : female;
    const voice = pool[Math.min(isMale ? maleCount.n : femaleCount.n, pool.length - 1)] ?? pool[0];
    if (isMale) maleCount.n += 1;
    else femaleCount.n += 1;
    return { name, voice: MM_PREFIX + voice.voice };
  });
}

/** 旁白声（自动分声场景固定主持人女） */
export const AUTOCAST_NARRATOR_VOICE = 'mm:presenter_female';

/** 运行时说话人绑定（如 chat 模式激活成员）；voice 为 VOICES 的 id */
export interface SpeakerBinding {
  name: string;
  voice: string;
}

/** 路由后段落：text 送合成，voice 为声音 id，speaker 供高亮展示（旁白为 'narrator'） */
export interface RoutedParagraph {
  text: string;
  voice: string;
  speaker: string;
}

/** 旁白说话人占位名 */
export const NARRATOR_SPEAKER = 'narrator';

/** voiceMap 中旁白默认声的约定键（VoiceMapEditor 保存旁白声用；优先于全局 store.voice） */
export const NARRATOR_VOICE_KEY = 'narrator';

/** 声音 id → easyvoice 底层名（未知 id 回退默认声） */
export function voiceIdToName(id: string): string {
  return VOICES.find((v) => v.id === id)?.voice ?? VOICES[0].voice;
}

/** `名字：` / `名字:` 前缀（名字限 1-16 位常见字符，避免把「他说：」这类整句误判） */
const NAME_PREFIX = /^([A-Za-z0-9一-龥·]{1,16})[：:]\s*/;

/** 引号开字符与闭字符配对（合并判定按对计数） */
const QUOTE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['「', '」'],
  ['『', '』'],
  ['“', '”'], // “ ”
];

const QUOTE_OPENERS: readonly string[] = QUOTE_PAIRS.map(([open]) => open);

function countOf(text: string, ch: string): number {
  let n = 0;
  for (const c of text) if (c === ch) n += 1;
  return n;
}

/** 段落引号是否未闭合（某对引号开计数 > 闭计数） */
function hasOpenQuote(text: string): boolean {
  return QUOTE_PAIRS.some(([open, close]) => countOf(text, open) > countOf(text, close));
}

/** 剥离 markdown 标题前缀（对齐旧站：# / ##） */
function stripHeading(line: string): string {
  if (line.startsWith('## ')) return line.slice(3);
  if (line.startsWith('# ')) return line.slice(2);
  return line;
}

/** 切分：\n 切行 → 去标题 → trim → 滤空行 → 未闭合引号段吸收后续行
 * （导出供 ReadingView 播放高亮按同一切分渲染段落，保证高亮段与朗读段对齐） */
export function splitParagraphs(text: string): string[] {
  const lines = text
    .split('\n')
    .map((l) => stripHeading(l).trim())
    .filter((l) => l.length > 0);

  const merged: string[] = [];
  for (const line of lines) {
    const prev = merged.length > 0 ? merged[merged.length - 1] : undefined;
    if (prev !== undefined && hasOpenQuote(prev)) merged[merged.length - 1] = `${prev}\n${line}`;
    else merged.push(line);
  }
  return merged;
}

/**
 * 段落说话人路由主入口。
 * speakers 先建表、voiceMap 同名覆盖（作品级显式配置优先于运行时补充）。
 */
export function routeParagraphs(
  text: string,
  voiceMap: Record<string, string>,
  speakers: SpeakerBinding[],
  defaultVoice: string,
): RoutedParagraph[] {
  const voiceBy: Record<string, string> = {};
  for (const s of speakers) voiceBy[s.name] = s.voice;
  for (const [name, voice] of Object.entries(voiceMap)) voiceBy[name] = voice;

  const out: RoutedParagraph[] = [];
  let lastSpeaker: string | null = null;

  for (const para of splitParagraphs(text)) {
    const matched = NAME_PREFIX.exec(para);
    if (matched) {
      const name = matched[1];
      lastSpeaker = name;
      out.push({ text: para, voice: voiceBy[name] ?? defaultVoice, speaker: name });
    } else if (lastSpeaker !== null && QUOTE_OPENERS.some((q) => para.startsWith(q))) {
      // 无前缀引号对白：归属前文最近说话人
      out.push({ text: para, voice: voiceBy[lastSpeaker] ?? defaultVoice, speaker: lastSpeaker });
    } else {
      out.push({ text: para, voice: defaultVoice, speaker: NARRATOR_SPEAKER });
    }
  }
  return out;
}
