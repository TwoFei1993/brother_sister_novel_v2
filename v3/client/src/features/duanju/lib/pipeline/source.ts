/**
 * 原文性质、按集切片定位、本集剧本取值（设计共识 2026-11-26 第 3.3 节）——纯函数，无 IO。
 *
 * - inferScriptScope：原文像「整本小说」还是「只有第 1 集」
 * - sliceEpisodes：两遍算法——逐集找「首句 + 末句」完整对（顺次搜索、前缀降级匹配），
 *   再给未定位的集按邻集夹出范围
 * - assembleEpisodeSource：给提示词组装用的本集来源（原文切片 / 上一集结尾 / 下一集梗概）
 */
import type { DuanjuEpisode, DuanjuProject } from '@shared/duanju';
import { inferScriptScope, scriptScopeOf } from '@shared/duanju';

// ---------- 原文性质 ----------
// 推断规则在 shared（inferScriptScope / scriptScopeOf）：服务端导出也要按同一规则判断「只有第 1 集」的作品。
// 这里原样转出，调用方不变。
export { inferScriptScope, scriptScopeOf };

// ---------- 本集剧本 ----------

/** 空白内容不算有剧本 */
export function hasEpisodeScript(ep: Pick<DuanjuEpisode, 'script'>): boolean {
  return Boolean(ep.script?.trim());
}

/**
 * 本集剧本正文：已保存的用它；「只有第 1 集」作品的第 1 集直接读原文（不另存副本——
 * 改原文后仍按原规则提醒待刷新）；其余没有（整本小说的全文不是任何一集的剧本）。
 */
export function effectiveEpisodeScript(
  project: Pick<DuanjuProject, 'script'>,
  ep: Pick<DuanjuEpisode, 'index' | 'script'>,
): string | undefined {
  if (hasEpisodeScript(ep)) return ep.script;
  if (ep.index === 1 && scriptScopeOf(project) === 'episode1' && project.script.text.trim()) return project.script.text;
  return undefined;
}

// ---------- 按集切片定位 ----------

export interface EpisodeAnchor {
  sourceStart?: string;
  sourceEnd?: string;
}

export interface EpisodeSlice {
  /** 集序（1 起，对应传入锚点的下标 + 1） */
  index: number;
  from: number;
  to: number;
  /** exact=首末句都定位到 / estimated=未定位，按邻集夹出 / full=一个集都没定位，回退全文 */
  mode: 'exact' | 'estimated' | 'full';
  /** 首句或末句靠前缀降级匹配命中（模型抄录时改写了锚点后半） */
  degraded: boolean;
}

/** 前缀降级匹配长度：精确 → 前 12 字 → 前 8 字 → 前 5 字 */
const PREFIX_STEPS: readonly number[] = [12, 8, 5];

interface Hit {
  at: number;
  len: number;
  degraded: boolean;
}

function findAnchor(text: string, anchor: string | undefined, from: number): Hit | null {
  const a = (anchor ?? '').trim();
  if (!a) return null;
  const exact = text.indexOf(a, from);
  if (exact >= 0) return { at: exact, len: a.length, degraded: false };
  for (const n of PREFIX_STEPS) {
    if (a.length <= n) continue; // 锚点本身不比前缀长：精确匹配已覆盖
    const prefix = a.slice(0, n);
    const at = text.indexOf(prefix, from);
    if (at >= 0) return { at, len: prefix.length, degraded: true };
  }
  return null;
}

/** 收缩范围：跳过两端的空白（夹出来的空隙常以换行开头或结尾） */
function trimRange(text: string, from: number, to: number): [number, number] {
  let f = from;
  let t = to;
  while (f < t && /\s/.test(text[f]!)) f += 1;
  while (t > f && /\s/.test(text[t - 1]!)) t -= 1;
  return [f, t];
}

/**
 * 两遍切片：
 * 第一遍逐集找「首句 + 末句」——从前一个命中的末句之后开始找首句（顺次搜索，同一句不会
 * 重复命中），末句在其后找且必须晚于首句；范围超过全文平均集长 4 倍的按未定位处理
 * （防降级匹配串到很靠后的位置）。首尾都找到才算定位成功。
 * 第二遍定界：定位成功的取首句到末句；未定位的夹在前一个定位成功的集的末句与后一个
 * 定位成功的集的首句之间（没有则文首 / 文末），相邻几个未定位的集共用中间这一段。
 */
export function sliceEpisodes(text: string, anchors: readonly EpisodeAnchor[]): EpisodeSlice[] {
  const n = anchors.length;
  if (n === 0) return [];
  const maxLen = (text.length / n) * 4;
  const hits: Array<{ from: number; to: number; degraded: boolean } | null> = [];
  let cursor = 0;
  for (let i = 0; i < n; i += 1) {
    const start = findAnchor(text, anchors[i]!.sourceStart, cursor);
    const end = start ? findAnchor(text, anchors[i]!.sourceEnd, start.at + start.len) : null;
    if (!start || !end || end.at + end.len - start.at > maxLen) {
      hits.push(null);
      continue;
    }
    const to = end.at + end.len;
    hits[i] = { from: start.at, to, degraded: start.degraded || end.degraded };
    cursor = to;
  }
  if (!hits.some(Boolean)) {
    return anchors.map((_, i) => ({ index: i + 1, from: 0, to: text.length, mode: 'full' as const, degraded: false }));
  }
  return anchors.map((_, i) => {
    const hit = hits[i];
    if (hit) return { index: i + 1, from: hit.from, to: hit.to, mode: 'exact' as const, degraded: hit.degraded };
    let left = 0;
    for (let j = i - 1; j >= 0; j -= 1) {
      if (hits[j]) {
        left = hits[j]!.to;
        break;
      }
    }
    let right = text.length;
    for (let j = i + 1; j < n; j += 1) {
      if (hits[j]) {
        right = hits[j]!.from;
        break;
      }
    }
    const [from, to] = left < right ? trimRange(text, left, right) : [left, left];
    return { index: i + 1, from, to, mode: 'estimated' as const, degraded: false };
  });
}

// ---------- 给提示词组装用的本集来源 ----------

/** 上一集结尾取多少字做衔接 */
const PREV_TAIL_CHARS = 300;

export interface EpisodeSource {
  /** adapt=从原文改编 / continue=按梗概续写 */
  mode: 'adapt' | 'continue';
  /** 「只有第 1 集」作品的第 1 集：原文即剧本，不需要生成 */
  skip?: boolean;
  /** 本集对应的原文（续写没有原文） */
  source?: { text: string; mode: EpisodeSlice['mode']; degraded: boolean };
  /** 上一集结尾（开场承接用） */
  prevTail?: string;
  /** 下一集梗概（防止越界到下一集） */
  nextSynopsis?: string;
  /** 范围说明：未定位或回退时非空，提示词据此限定「只写本集」 */
  anchorsNote: string;
}

export function assembleEpisodeSource(project: DuanjuProject, ep: DuanjuEpisode): EpisodeSource {
  const idx = project.episodes.findIndex((e) => e.id === ep.id);
  const prev = idx > 0 ? project.episodes[idx - 1] : undefined;
  const next = idx >= 0 ? project.episodes[idx + 1] : undefined;
  const prevScript = prev ? effectiveEpisodeScript(project, prev) : undefined;
  const neighbours = {
    ...(prevScript?.trim() ? { prevTail: prevScript.trim().slice(-PREV_TAIL_CHARS) } : {}),
    ...(next?.synopsis?.trim() ? { nextSynopsis: next.synopsis.trim() } : {}),
  };

  if (scriptScopeOf(project) === 'episode1') {
    return { mode: 'continue', ...(ep.index === 1 ? { skip: true } : {}), ...neighbours, anchorsNote: '' };
  }

  const slice = idx >= 0 ? sliceEpisodes(project.script.text, project.episodes)[idx] : undefined;
  if (!slice) return { mode: 'adapt', ...neighbours, anchorsNote: '' };
  const anchorsNote =
    slice.mode === 'estimated'
      ? '未找到本集在原文中的确切位置，以下原文按邻集位置估算（可能含相邻集的内容）——只写本集梗概对应的情节，不写到其他集。'
      : slice.mode === 'full'
        ? '未找到原文位置，以下给出原文全文——只写本集梗概对应的情节，不写到其他集。'
        : '';
  return {
    mode: 'adapt',
    source: { text: project.script.text.slice(slice.from, slice.to), mode: slice.mode, degraded: slice.degraded },
    ...neighbours,
    anchorsNote,
  };
}
