/**
 * LLM JSON 输出容错提取（用户反馈 #11：拆镜头「模型未返回合法结果」）
 *
 * 真实模型输出常见污染：markdown 围栏、前后解说文字、尾逗号、// 注释、
 * 全角引号/中文冒号、单引号键、Python 风格 True/None。逐级降级修复直至可解析。
 */

/**
 * 从首个 open 开始做括号配对扫描取完整 JSON 片段——正确处理嵌套
 * （gridParts 内层数组等）与字符串内的括号字面量。
 */
function sliceToBracket(text: string, open: '[' | '{'): string {
  const close = open === '[' ? ']' : '}';
  const start = text.indexOf(open);
  if (start < 0) return text;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (esc) {
      esc = false;
      continue;
    }
    if (ch === '\\') {
      esc = true;
      continue;
    }
    if (ch === '"') {
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return text.slice(start); // 未闭合：截到尾部交修复链
}

/** 常见格式污染修复（不可逆修复，仅在严格解析失败后使用） */
function repairCommon(text: string): string {
  let t = text;
  t = t.replace(/,\s*([}\]])/g, '$1'); // 尾逗号
  t = t.replace(/^\s*\/\/.*$/gm, ''); // 整行 // 注释
  t = t.replace(/([{,]\s*)\/\/[^\n"]*(?=\n|$)/g, '$1'); // 行内注释（键值后）
  t = t.replace(/([\[{,]\s*)'([^']+)'(\s*:)/g, '$1"$2"$3'); // 单引号键
  t = t.replace(/:(\s*)'([^']*)'/g, ':$1"$2"'); // 单引号值
  t = t.replace(/([\[:,]\s*)(True|False|None)\b/g, '$1$2'.replace('True', 'true').replace('False', 'false').replace('None', 'null')); // Python 字面量
  t = t.replace(/([\[:,]\s*)（([^（）]*)）/g, '$1"$2"'); // 中文括号值 → 字符串
  return t;
}

/** 从模型输出提取 JSON 对象；逐级降级：原文 → 剥围栏截取 → 修复 → 修复后再截 */
export function extractJsonObject(raw: string): Record<string, unknown> | null {
  const attempts = [raw, sliceToBracket(raw.trim(), '{')];
  for (const t of attempts) {
    try {
      const o = JSON.parse(t);
      if (o && typeof o === 'object') return o as Record<string, unknown>;
    } catch { /* 下一级 */ }
  }
  const sliced = sliceToBracket(raw.trim(), '{');
  for (const t of [sliced, repairCommon(sliced), repairCommon(raw)]) {
    try {
      const o = JSON.parse(t);
      if (o && typeof o === 'object') return o as Record<string, unknown>;
    } catch { /* 下一级 */ }
  }
  return null;
}

/** 从模型输出提取 JSON 数组（同款降级链） */
export function extractJsonArray(raw: string): unknown[] | null {
  const attempts = [raw, sliceToBracket(raw.trim(), '[')];
  for (const t of attempts) {
    try {
      const a = JSON.parse(t);
      if (Array.isArray(a)) return a;
    } catch { /* 下一级 */ }
  }
  const sliced = sliceToBracket(raw.trim(), '[');
  for (const t of [sliced, repairCommon(sliced), repairCommon(raw)]) {
    try {
      const a = JSON.parse(t);
      if (Array.isArray(a)) return a;
    } catch { /* 下一级 */ }
  }
  return null;
}
