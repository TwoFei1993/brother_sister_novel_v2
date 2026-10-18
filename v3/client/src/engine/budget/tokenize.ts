/**
 * token 近似估算（设计 §5.4 前端轨）
 *
 * 启发式分桶（目标锚点：与 GPT 系列 tokenizer 对中文样本的比值 ≈ 1.5 token/汉字，
 * 对常见中英混合文本误差 <15%）：
 * - CJK 表意字符（汉字/假名等）× 1.5/字
 * - 拉丁单词 × 1.3/词
 * - 数字与其余符号（含中英文标点、全角符号）× 1/字符
 * - 空白（空格/换行/制表）不计
 */

/** CJK 权重：token/汉字（对齐 r50k/p50k 一档 tokenizer 的保守估计，宁高勿低防超预算） */
const CJK_WEIGHT = 1.5;
/** 拉丁词权重：token/词 */
const LATIN_WORD_WEIGHT = 1.3;
/** 数字与符号权重：token/字符 */
const OTHER_WEIGHT = 1;

/** CJK 表意字符：日文假名、汉字扩展 A、CJK 统一汉字、兼容汉字 */
const CJK_RE = /[぀-ヿ㐀-䶿一-鿿豈-﫿]/;
/** 拉丁单词（含撇号缩写，如 don't） */
const LATIN_WORD_RE = /[A-Za-z][A-Za-z']*/g;
/** 其余单字符符号：非空白、非拉丁字母、非 CJK（数字、中英文标点、全角符号等） */
const OTHER_RE = /[^\sA-Za-z぀-ヿ㐀-䶿一-鿿豈-﫿]/g;

/** 统计正则全部匹配次数（g 正则经 String.match 使用，lastIndex 由规范保证重置） */
function matchCount(text: string, re: RegExp): number {
  return text.match(re)?.length ?? 0;
}

/** 向上取整保证估算不低估 */
function ceil(n: number): number {
  return Math.ceil(n);
}

/**
 * 近似估算文本 token 数。
 * 纯启发式、零依赖，用于实时预算显示与装填判断；
 * 发送前的精确校验走服务端 `POST /api/tokenize`（设计 §5.4 双轨）。
 */
export function countTokensApprox(text: string): number {
  if (!text) return 0;
  const cjk = matchCount(text, new RegExp(CJK_RE.source, 'g'));
  const words = matchCount(text, LATIN_WORD_RE);
  const others = matchCount(text, OTHER_RE);
  return ceil(cjk * CJK_WEIGHT + words * LATIN_WORD_WEIGHT + others * OTHER_WEIGHT);
}
