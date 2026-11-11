/**
 * TTS 段落说话人路由（设计 §7.3 / Task 29；声库目录见 voice-catalog.ts，此处 re-export 兼容旧引用）
 *
 * 把整章/整段文本切成 TTS 段落并为每段选声：
 * - 切分：\n 切行、过滤空行、剥离 #/## 标题前缀（对齐旧站 parseTextForTTS）
 * - 引号跨行合并：未闭合引号段吸收后续行（「」/『』/“” 三种引号）
 * - 说话人识别优先级：段首`名字：` → 段尾名字+说话动词 → 段中`…名字：“对白”` →
 *   无前缀引号段延续前文最近说话人 → 旁白
 * - 声音来源：speakers（运行时补充，如激活角色）先入表，voiceMap（作品级显式配置）同名覆盖；
 *   缺失一律回退 defaultVoice（旁白声）
 */
export * from './voice-catalog';
import { VOICES } from './voice-catalog';

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

/** 说话人前缀正则（导出供正文角色识别复用，保证路由与识别同规则） */
export const SPEAKER_NAME_PREFIX = NAME_PREFIX;

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
 * 名字带叙述尾巴（「崔氏笑道：」）且表内无此名时，裁尾再查（崔氏→命中）。
 */
const SPEECH_TAIL =
  /(?:低声|大声|连忙|急忙|轻声|又|再)?(?:说道?|笑道|笑着?|问道?|喊道?|劝道?|叹道?|答道?|吩咐|念叨|嘟囔|嘀咕|开口|笑)$/;

function resolveVoice(name: string, voiceBy: Record<string, string>): string | undefined {
  const direct = voiceBy[name];
  if (direct !== undefined) return direct;
  const stem = name.replace(SPEECH_TAIL, '');
  return stem !== name && stem.length >= 2 ? voiceBy[stem] : undefined;
}

/**
 * 段中/段尾说话人标记（自然小说文风「“……”小明淡淡地说道，转身离开。」）：
 * 取段中最后一个「名字 + (修饰词)?地? + 说话动词」，动词后允许 ≤10 个非引号尾随字符。
 * 名字组不含引号与标点（「，说道」前是逗号则该处不匹配——叙述句「他说话很温柔」因动词离段尾远而不命中）。
 */
const TAIL_SPEAKER =
  /([^“”「」『』，。！？；、：\n]{1,12}?)(?:点点头?|摇了摇头|摇头|耸耸肩|眨眨眼|顿了顿|低声|大声|连忙|急忙|轻声|沉声|冷冷|淡淡|微微|小声|高声|突然|随即|笑着|激动|开心|不好意思|认真地)?地?(?:说道|说|笑道|喊道|问道|答道|应道|接道|回道|宣布|补充|回应|叹道|吩咐|念叨|嘟囔|嘀咕|开口道|开口|急道|劝道|沉道|冷道|喝道|回答|追问|反问|又道|再道|答)(?=(?:[^“”「」『』\n]{0,4})[“「]|[^“”「」『』\n]{0,10}$)/g;

/** 段中最后一个说话人标记的名字（无标记返回 null） */
function lastTailSpeaker(para: string): string | null {
  let last: string | null = null;
  for (const m of para.matchAll(TAIL_SPEAKER)) last = m[1]!;
  return last;
}

/**
 * 配音表最长前缀匹配（段尾提取名的动作尾巴收缩）：
 * 「苏棠的声音发颤」这类带状态描述的名字精确查表 miss 时，按最长 key 前缀收缩
 * （「苏棠的声音发颤」→「苏棠」命中）。只用于段尾路径；speaker 标注用收缩后的
 * 配音表 key，保证后续无标记引号段的 lastSpeaker 延续同样正确。
 */
function resolveVoiceByPrefix(
  name: string,
  voiceBy: Record<string, string>,
): { key: string; voice: string } | null {
  let best: { key: string; voice: string } | null = null;
  for (const [key, voice] of Object.entries(voiceBy)) {
    if (key !== NARRATOR_VOICE_KEY && name.startsWith(key) && (!best || key.length > best.key.length)) {
      best = { key, voice };
    }
  }
  return best;
}

/**
 * 段中冒号引号归属（盲区修复①）：「星璃收回爪子，轻轻拍了拍纸面：“……”」——
 * 名字埋在段中、对白在冒号后引号内，段首前缀/段尾动词两条规则都够不着（实测 153 段中 15 段落旁白）。
 * 策略：取段内第一个「冒号+开引号」点，在冒号前 16 字窗口里找配音表 key，
 * 命中位置最靠右者胜（天然兼容动作尾巴「笑道」「的声音发颤」——key 是子串即可）。
 * 窗口无任何 key（代词/陌生名）→ null 不归属（防误配）。
 */
function colonQuoteSpeaker(para: string, voiceBy: Record<string, string>): { key: string; voice: string } | null {
  const openerRe = /[「“]/g;
  let m: RegExpExecArray | null;
  while ((m = openerRe.exec(para)) !== null) {
    const colon = Math.max(para.lastIndexOf('：', m.index), para.lastIndexOf(':', m.index));
    if (colon < 0 || m.index - colon > 3) continue; // 冒号须紧邻引号（允许一个空白）
    const window = para.slice(Math.max(0, colon - 16), colon);
    let best: { key: string; voice: string; at: number } | null = null;
    for (const [key, voice] of Object.entries(voiceBy)) {
      if (key === NARRATOR_VOICE_KEY) continue;
      const at = window.lastIndexOf(key);
      if (at >= 0 && (!best || at + key.length > best.at + best.key.length)) best = { key, voice, at };
    }
    if (best) return { key: best.key, voice: best.voice };
    return null; // 冒号引号点存在但无配音名命中：不再尝试后续引号（首对白主导归属）
  }
  return null;
}

/** 段落中最后提及的配音角色名（最靠右命中；无命中 null）——叙述段维护「最近提及」 */
function lastMentionOf(para: string, voiceBy: Record<string, string>): string | null {
  let best: { key: string; end: number } | null = null;
  for (const key of Object.keys(voiceBy)) {
    if (key === NARRATOR_VOICE_KEY) continue;
    let from = 0;
    for (;;) {
      const at = para.indexOf(key, from);
      if (at < 0) break;
      if (!best || at + key.length > best.end) best = { key, end: at + key.length };
      from = at + key.length;
    }
  }
  return best?.key ?? null;
}

/** 跨段路由状态（逐段调 routeParagraphs 的调用方传入以延续「最近说话人/最近提及」；
 * 不传则函数内部自建——整章一次性调用的既有行为不变） */
export interface RouteState {
  lastSpeaker: string | null;
  lastMention: string | null;
}

export function routeParagraphs(
  text: string,
  voiceMap: Record<string, string>,
  speakers: SpeakerBinding[],
  defaultVoice: string,
  state?: RouteState,
): RoutedParagraph[] {
  const voiceBy: Record<string, string> = {};
  for (const s of speakers) voiceBy[s.name] = s.voice;
  for (const [name, voice] of Object.entries(voiceMap)) voiceBy[name] = voice;

  const out: RoutedParagraph[] = [];
  let lastSpeaker = state?.lastSpeaker ?? null;
  let lastMention = state?.lastMention ?? null; // 最近提及的配音角色（叙述段提及；代词对白兜底）

  for (const para of splitParagraphs(text)) {
    const matched = NAME_PREFIX.exec(para);
    if (matched) {
      const name = matched[1];
      let voice = resolveVoice(name, voiceBy);
      let speaker = name;
      if (voice === undefined) {
        // 带动作/状态前缀段（「苏棠的声音发颤：」）→ 最长前缀收缩到配音表 key
        const viaPrefix = resolveVoiceByPrefix(name, voiceBy);
        if (viaPrefix) {
          voice = viaPrefix.voice;
          speaker = viaPrefix.key;
        }
      } else {
        // speaker 收缩到配音表真实 key（「老人说」裁尾命中「老人」）——
        // 保证 routeMobileParas 的 carried 延续（vm[lastSpeaker] 直查）不 miss
        const stem = name.replace(SPEECH_TAIL, '');
        if (stem !== name && voiceBy[stem] === voice) speaker = stem;
      }
      lastSpeaker = speaker;
      out.push({ text: para, voice: voice ?? defaultVoice, speaker });
      continue;
    }
    // 自然小说文风的段尾说话人标记（「“……”小明说道。」）：提取归属，命中 voiceMap 才用角色声
    // （未命中如「她说」「众人喊道」保持旁白——代词/群体不误配到具体音色）
    const tailName = para.includes('“') || para.includes('「') ? lastTailSpeaker(para) : null;
    let tailVoice = tailName ? resolveVoice(tailName, voiceBy) : undefined;
    let tailSpeaker = tailName;
    if (tailName && tailVoice === undefined) {
      // 带动作/状态尾巴（「苏棠的声音发颤」）→ 最长前缀收缩到配音表 key
      const viaPrefix = tailName ? resolveVoiceByPrefix(tailName, voiceBy) : null;
      if (viaPrefix) {
        tailVoice = viaPrefix.voice;
        tailSpeaker = viaPrefix.key;
      }
    } else if (tailName && tailVoice !== undefined && tailName) {
      // speaker 收缩到配音表真实 key（同段首分支，保证 carried 直查命中）
      const stem = tailName.replace(SPEECH_TAIL, '');
      if (stem !== tailName && voiceBy[stem] === tailVoice) tailSpeaker = stem;
    }
    if (tailName && tailVoice !== undefined && tailSpeaker) {
      lastSpeaker = tailSpeaker;
      out.push({ text: para, voice: tailVoice, speaker: tailSpeaker });
      continue;
    }
    // 盲区①：段中「叙述，名字：“对白”」——冒号引号点前找配音表 key
    const viaColon = colonQuoteSpeaker(para, voiceBy);
    if (viaColon) {
      lastSpeaker = viaColon.key;
      out.push({ text: para, voice: viaColon.voice, speaker: viaColon.key });
      continue;
    }
    if (lastSpeaker !== null && QUOTE_OPENERS.some((q) => para.startsWith(q))) {
      // 无前缀引号对白：归属前文最近说话人
      out.push({
        text: para,
        voice: (lastSpeaker && resolveVoice(lastSpeaker, voiceBy)) ?? defaultVoice,
        speaker: lastSpeaker,
      });
      lastMention = lastSpeaker;
      continue;
    }
    // 旁白兜底：叙述段更新「最近提及角色」（对白者通常刚被叙述提及）；
    // 章首无说话人时的代词对白（「“哥哥。”她奶声奶气地开口」）由最近提及兜底归属
    const mentioned = lastMentionOf(para, voiceBy);
    if (mentioned) lastMention = mentioned;
    if (QUOTE_OPENERS.some((q) => para.includes(q)) && lastMention) {
      out.push({ text: para, voice: voiceBy[lastMention] ?? defaultVoice, speaker: lastMention });
      continue;
    }
    out.push({ text: para, voice: defaultVoice, speaker: NARRATOR_SPEAKER });
  }
  if (state) {
    state.lastSpeaker = lastSpeaker;
    state.lastMention = lastMention;
  }
  return out;
}
