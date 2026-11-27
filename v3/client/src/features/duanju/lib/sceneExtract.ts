/**
 * 场景提取（反馈 #9）：剧本 → 场景档案列表 JSON——初始生成就该有，不应手填
 */
import type { GenerateMessage } from '../../../api/llm';
import { extractJsonArray } from './json-extract';

const SYSTEM = `你是短剧美术指导。从剧本中提取全部出现过的场景/地点，输出场景档案。
只输出 JSON 数组，不要 markdown 代码块、不要解释。每项：
{"name": "场景名（简短，如：深夜食堂/货舱/紫色荒原）", "spec": "视觉档案（80-150字，逐项写全）：空间布局与尺度｜建筑/陈设材质细节｜主光源方向与色温｜时间与天气氛围｜色彩基调（2-3个主色）｜固定陈设与道具（只写这个场所本来就有的）"}
要求：
1. spec 必须可视化可画——生图模型看不到剧本，照搬下面的字段顺序写全；
2. 同一地点多次出现只提取一次；心理空间/纯转场不算。
3. 场景档案只写「这个地点本来长什么样」的稳定视觉信息。**不写随剧情变化的物件状态**（如某道具被摆在桌上、灯被弄灭、雨伞靠在门边）、不写剧情事件与人物动作——同一场景在前面集数出图时也会套用这份档案，写了剧情状态会让前面集数穿帮；剧情道具由每集自己的剧本带入。
好例子（照这个具体程度写）：
"4平米深夜小食店操作间：灶台沿墙一字排开，不锈钢台面油亮反光，头顶一盏冷白吊灯微微晃动；蒸汽自汤锅升腾照亮半壁白瓷砖；深夜雨夜，室外湿冷、室内燥热；暖褐与油烟灰为主调，点缀葱花绿；墙上挂褪色价目表与条形订单钩，案板角落常备葱花与酱料碗。"
坏例子（不要这样写）：
"……桌角摆着客人落下的铁盒，墙上纸条被辣椒罐压住，后门的灯不亮。"（这些是某一刻的剧情状态，不是场所本来的样子）`;

export function buildSceneExtractMessages(scriptText: string): GenerateMessage[] {
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `剧本：\n${scriptText}` },
  ];
}

export interface ExtractedScene {
  name: string;
  spec: string;
}

/** 单场景视觉档案重生成（用户需求 2026-11-11）——在现有描述上修正补全，可直接用于生图 */
export function rebuildSceneSpecMessages(
  scriptText: string,
  sceneName: string,
  currentSpec: string,
): GenerateMessage[] {
  const SYSTEM = `你是短剧美术指导。为指定场景重写一份「可直接用于 AI 生图」的视觉档案。
只输出档案文本本身（纯文本，不要 JSON、不要 markdown、不要解释）。
要求：
1. 在现有描述基础上修正与补全——保留正确的细节，充实缺漏的维度；
2. 逐项写全：空间布局与尺度｜建筑/陈设材质细节｜主光源方向与色温｜时间与天气氛围｜色彩基调（2-3个主色）｜固定陈设与道具（80-150字，只写这个场所本来就有的）；
3. 以剧本为准，剧本未提及处按题材合理补全；
4. 场景档案只写「这个地点本来长什么样」的稳定视觉信息：不写随剧情变化的物件状态（某道具被摆在桌上、灯灭、雨伞靠门）、不写剧情事件与人物动作——同一场景在前面集数出图时也会套用这份档案，写了剧情状态会让前面集数穿帮；剧情道具由每集自己的剧本带入；
5. 场景概念图无人物出现。`;
  return [
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content: [
        `场景：${sceneName}`,
        currentSpec ? `当前描述：${currentSpec}` : '',
        `剧本：\n${scriptText}`,
      ]
        .filter(Boolean)
        .join('\n\n'),
    },
  ];
}

export function parseSceneExtract(raw: string): ExtractedScene[] | null {
  const arr = extractJsonArray(raw);
  if (!arr) return null;
  return arr
    .filter(
      (x): x is { name: string; spec?: string } =>
        typeof x === 'object' && x !== null && typeof (x as { name?: unknown }).name === 'string',
    )
    .map((x) => ({ name: x.name, spec: typeof x.spec === 'string' ? x.spec : '' }))
    .filter((x) => x.name.trim());
}
