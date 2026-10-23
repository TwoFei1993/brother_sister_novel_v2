/**
 * 本章新素材检测（安卓 app Phase2 P2.2，共识 D8 side-channel）
 *
 * 生成时在提示词尾部追加检测指令：模型在正文之后顺带输出
 * <new_assets>{"characters":[..],"factions":[..],"worldviews":[..]}</new_assets>；
 * 入库前剥离该块（不进正文），JSON 解析进 extra.newAssets，前端提示作者确认绑定。
 * 全程容错：块缺失/坏 JSON → 原样返回，零影响正文。
 */
import type { DetectedAsset } from '@shared/message';

/** 检测指令（追加在组装消息末尾；约 60 token，可忽略预算误差） */
export const NEW_ASSETS_HINT =
  '\n\n（写作要求之外的一项辅助任务：如果本章出现了此前章节从未出现过的、值得长期记录的新角色、新势力或新世界观设定，' +
  '请在正文全部结束后另起一行，输出一个 JSON 块，格式严格为：\n' +
  '<new_assets>{"characters":[{"name":"角色名","summary":"一句话描述"}],"factions":[{"name":"势力名","summary":"一句话描述"}],"worldviews":[{"name":"设定名","summary":"一句话描述"}]}</new_assets>\n' +
  '没有新内容就输出 <new_assets></new_assets>（空块）。除该块外不要输出任何解释。）';

const BLOCK_RE = /<new_assets>([\s\S]*?)<\/new_assets>/;

/** 单数组条目宽松解析：name 必有非空，summary 缺省空串 */
function parseList(raw: unknown, kind: DetectedAsset['kind']): DetectedAsset[] {
  if (!Array.isArray(raw)) return [];
  const out: DetectedAsset[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const name = String((item as Record<string, unknown>).name ?? '').trim();
    if (!name) continue;
    const summary = String((item as Record<string, unknown>).summary ?? '').trim();
    out.push({ kind, name, summary });
  }
  return out;
}

/**
 * 剥离 <new_assets> 块并解析清单：
 * - 无块 → { content 原文, detected: [] }
 * - 有块 → content 去块（含块前后多余换行收敛），detected = 三类合并（name 去重）
 * - 坏 JSON → detected: []（正文仍剥块，避免模型碎碎念污染正文）
 */
export function parseNewAssets(content: string): { content: string; detected: DetectedAsset[] } {
  const m = BLOCK_RE.exec(content);
  if (!m) return { content, detected: [] };
  const stripped = content.replace(BLOCK_RE, '').replace(/\n{3,}$/g, '\n\n').trimEnd();
  let detected: DetectedAsset[] = [];
  try {
    const parsed = JSON.parse(m[1]!.trim()) as Record<string, unknown>;
    const merged = [
      ...parseList(parsed.characters, 'character'),
      ...parseList(parsed.factions, 'faction'),
      ...parseList(parsed.worldviews, 'worldview'),
    ];
    const seen = new Set<string>();
    detected = merged.filter((d) => {
      const key = `${d.kind}:${d.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  } catch {
    detected = [];
  }
  return { content: stripped, detected };
}

/** 过滤已有素材名（大小写不敏感的包含匹配）：只留真正的新面孔 */
export function filterKnown(detected: readonly DetectedAsset[], knownNames: readonly string[]): DetectedAsset[] {
  const lower = knownNames.map((n) => n.toLowerCase()).filter(Boolean);
  return detected.filter((d) => !lower.some((n) => d.name.toLowerCase().includes(n) || n.includes(d.name.toLowerCase())));
}
