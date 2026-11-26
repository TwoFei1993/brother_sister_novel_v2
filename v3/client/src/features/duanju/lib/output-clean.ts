/**
 * 模型输出「剥壳」：去掉代码块围栏与首尾的解释行，留下正文本身。
 * 试验台扩写、分集剧本生成共用（系统词已要求只输出正文，这里是模型不听话时的兜底）。
 */

/** 首行是寒暄 / 说明（「以下是…」「好的，…」「提示词：」）→ 不是正文。
 *  「这是」「根据」不开头就判：剧本的第一句也可能这么写 */
const LEAD_NOISE = /^(以下是|下面是|(好的|当然)[，,。！!；;：:]|提示词[:：]|prompt[:：]|>|我来)/i;
/** 尾行以这些开头 → 可能是补充说明 */
const TAIL_LEAD = /^(希望|如需|如果需要|以上|需要我|你可以)/;
/**
 * ……并且带着客套的特征搭配才算：剧本正文也会以「希望」「注意到」开头，
 * 只看开头两个字会吃掉最后一行剧本（丢了台词和动作，比多留一句客套严重得多）。
 */
const TAIL_SERVICE =
  /如需|如果需要|需要我|你可以|符合(预期|要求|需要)|有所(帮助|启发)|帮到你|对你(的)?(有帮助|有用)|随时(告诉我|联系|调整)|可以(继续|再帮|帮忙)|告诉我/;

const isTailNoise = (line: string): boolean => /^(以上|需要我|你可以)/.test(line) || (TAIL_LEAD.test(line) && TAIL_SERVICE.test(line));

/** 剥代码块围栏、剥首尾的解释行与前缀（中间的正文原样保留；只有一行时不动，防把正文全删） */
export function stripModelWrapper(raw: string): string {
  const lines = raw.replace(/\r\n/g, '\n').trim().split('\n');
  while (lines.length > 1 && LEAD_NOISE.test(lines[0]!.trim())) lines.shift();
  while (lines.length > 1 && isTailNoise(lines[lines.length - 1]!.trim())) lines.pop();
  const text = lines.join('\n').trim();
  const fenced = /^```[a-zA-Z]*\n([\s\S]*?)\n```$/.exec(text); // 解释行剥掉后整段是围栏才剥
  return fenced ? fenced[1]!.trim() : text;
}
