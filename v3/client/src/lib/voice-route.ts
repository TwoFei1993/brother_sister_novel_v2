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

/** 可用声音（对齐旧站 useEasyTTS 的 6 声：3 女 3 男） */
export interface VoiceOption {
  id: string;
  name: string;
  /** easyvoice 底层声音名（POST /generate body.voice） */
  voice: string;
  gender: 'female' | 'male';
}

export const VOICES: readonly VoiceOption[] = [
  { id: 'xiaoxiao', name: '晓晓', voice: 'zh-CN-XiaoxiaoNeural', gender: 'female' },
  { id: 'xiaoyi', name: '小艺', voice: 'zh-CN-XiaoyiNeural', gender: 'female' },
  { id: 'xiaobei', name: '小贝', voice: 'zh-CN-liaoning-XiaobeiNeural', gender: 'female' },
  { id: 'yunxi', name: '云希', voice: 'zh-CN-YunxiNeural', gender: 'male' },
  { id: 'yunjian', name: '云健', voice: 'zh-CN-YunjianNeural', gender: 'male' },
  { id: 'yunyang', name: '云扬', voice: 'zh-CN-YunyangNeural', gender: 'male' },
];

/** 旁白默认声 id */
export const DEFAULT_VOICE_ID = 'xiaoxiao';

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

/** 切分：\n 切行 → 去标题 → trim → 滤空行 → 未闭合引号段吸收后续行 */
function splitParagraphs(text: string): string[] {
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
