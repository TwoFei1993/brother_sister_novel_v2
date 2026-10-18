/**
 * Token 计数（设计 §6 /api/tokenize）
 *
 * openai：js-tiktoken 精确计数（lazy import，encoding 实例模块级缓存；
 *   encoding_for_model 对新模型名不可靠，改手动映射：gpt-4o/o1/o3/claude 名 → o200k_base，其余 → cl100k_base；
 *   rank 加载失败（如离线环境）回退启发式并降级 approximate:true）。
 * gemini/claude：无官方 tokenizer，CJK×1.5 + 词×1.3 字符启发式，approximate:true。
 */
import type { LlmSource } from '../converters';

interface Encoding {
  encode(text: string): number[];
}

const encodings = new Map<string, Encoding>();

async function getEncoding(name: 'o200k_base' | 'cl100k_base'): Promise<Encoding> {
  let enc = encodings.get(name);
  if (!enc) {
    enc = (await import('js-tiktoken')).getEncoding(name) as Encoding;
    encodings.set(name, enc);
  }
  return enc;
}

const O200K_PATTERN = /gpt-4o|o1|o3|claude/i;

/** CJK×1.5 / 其余按空白词×1.3，向上取整（粗估供预算显示，不参与计费） */
function heuristicCount(text: string): number {
  const cjk = (text.match(/[㐀-鿿豈-﫿]/g) ?? []).length;
  const words = (text.replace(/[㐀-鿿豈-﫿]/g, ' ').match(/\S+/g) ?? []).length;
  return Math.max(text ? 1 : 0, Math.ceil(cjk * 1.5 + words * 1.3));
}

export async function countTokens(
  source: LlmSource,
  model: string | undefined,
  text: string,
): Promise<{ count: number; approximate: boolean }> {
  if (source === 'openai') {
    const name = O200K_PATTERN.test(model ?? '') ? 'o200k_base' : 'cl100k_base';
    try {
      const enc = await getEncoding(name);
      return { count: enc.encode(text).length, approximate: false };
    } catch {
      // rank 文件加载失败 → 启发式回退（approximate 降级，标注估算）
    }
  }
  return { count: heuristicCount(text), approximate: true };
}
