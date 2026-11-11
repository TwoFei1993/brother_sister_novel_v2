/**
 * 角色提取 prompt（Phase 2）：剧本 + 人物关系 → 角色档案列表 JSON
 */
import type { GenerateMessage } from '../../../api/llm';
import { extractJsonArray } from './json-extract';

const SYSTEM = `你是短剧角色设计师。从剧本中提取全部有名有姓/有戏份的角色，输出角色档案。
只输出 JSON 数组，不要 markdown 代码块、不要解释。每项：
{"name": "角色名", "profile": "外观档案（80-150字，逐项写全）：年龄性别身份｜发型发色（长度/造型）｜瞳色｜脸型五官特征｜体型身高｜服装（款式/颜色/材质）｜标志性配饰｜气质神态"}
要求：
1. 生图模型看不到剧本——档案必须自足完整，每个角色照搬下面的字段顺序写全，缺一处生图就会跑偏；
2. 剧本可推断处写死，推断不出的按题材合理补全并保持该角色前后一致；
3. **动物/机器人角色也算，且档案开头必须明确声明形态**——真实动物写「一只真实形态的{品种}{动物}（非拟人、非卡通）」并写全品种/毛色花纹/眼睛/体型；拟人或机器人角色同理写明形态与材质；群演路人不提取。
好例子（照这个具体程度写）：
"28岁女程序员，身形清瘦。深棕色齐肩直发微乱微湿，浅棕色瞳，薄框银边眼镜，鹅蛋脸眉眼清秀但眼下有熬夜青黑；身高162cm偏瘦；深藏青色连帽外套配白衬衫与深灰直筒裤，黑色帆布鞋；总挎一台贴满贴纸的旧电脑包，指节因常年敲键盘偏粗；气质疲惫而警觉。"`;

export function buildCharacterExtractMessages(
  scriptText: string,
  characterRelations: string,
  protagonists: string,
): GenerateMessage[] {
  return [
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content: [
        protagonists ? `主角设定：${protagonists}` : '',
        characterRelations ? `人物关系（审核卡）：${characterRelations}` : '',
        `剧本：\n${scriptText}`,
      ]
        .filter(Boolean)
        .join('\n\n'),
    },
  ];
}

export interface ExtractedCharacter {
  name: string;
  profile: string;
}

/** 单角色档案重生成（用户需求 2026-11-11：重新生成的是文字描述而非图片）——在现有档案上修正补全 */
export function rebuildCharacterProfileMessages(
  scriptText: string,
  name: string,
  currentProfile: string,
  characterRelations: string,
): GenerateMessage[] {
  const SYSTEM = `你是短剧角色设计师。为指定角色重写一份「可直接用于 AI 生图」的外观档案。
只输出档案文本本身（纯文本，不要 JSON、不要 markdown、不要解释）。
要求：
1. 在现有档案基础上修正与补全——保留正确的锚点，充实缺漏的维度；
2. 逐项写全：年龄性别身份｜发型发色（长度/造型）｜瞳色｜脸型五官特征｜体型身高｜服装（款式/颜色/材质）｜标志性配饰｜气质神态（80-150字）；
3. 以剧本描写为准，剧本未提及处按题材合理补全，并保持该角色前后一致；
4. 生图模型看不到剧本——档案必须自足完整。`;
  return [
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content: [
        `角色：${name}`,
        currentProfile ? `当前档案：${currentProfile}` : '',
        characterRelations ? `人物关系：${characterRelations}` : '',
        `剧本：\n${scriptText}`,
      ]
        .filter(Boolean)
        .join('\n\n'),
    },
  ];
}

export function parseCharacterExtract(raw: string): ExtractedCharacter[] | null {
  const arr = extractJsonArray(raw);
  if (!arr) return null;
  return arr
    .filter(
      (x): x is { name: string; profile?: string } =>
        typeof x === 'object' && x !== null && typeof (x as { name?: unknown }).name === 'string',
    )
    .map((x) => ({ name: x.name, profile: typeof x.profile === 'string' ? x.profile : '' }))
    .filter((x) => x.name.trim());
}
