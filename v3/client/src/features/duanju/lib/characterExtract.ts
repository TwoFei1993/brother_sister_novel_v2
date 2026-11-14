/**
 * 角色提取 prompt（Phase 2）：剧本 + 人物关系 → 角色档案列表 JSON
 */
import type { GenerateMessage } from '../../../api/llm';
import { extractJsonArray } from './json-extract';

const SYSTEM = `你是短剧角色设计师。从剧本中提取全部有名有姓/有戏份的角色，输出角色档案。
只输出 JSON 数组，不要 markdown 代码块、不要解释。每项：
{"name": "角色名", "profile": "外观档案（80-150字，逐项写全）：年龄性别身份｜发型发色（长度/造型）｜瞳色｜脸型五官特征｜体型身高｜服装（款式/颜色/材质）｜标志性配饰｜气质神态", "lockPhrase": "英文连续性锁面：跨镜不变外观的最小名词短语（发型+瞳色+服装主色形制+1-2 个标志性特征，15-30 个英文单词，不含动作/表情/剧情）"}
要求：
1. 生图模型看不到剧本——档案必须自足完整，每个角色照搬下面的字段顺序写全，缺一处生图就会跑偏；
2. 剧本可推断处写死，推断不出的按题材合理补全并保持该角色前后一致；
3. **动物/机器人角色也算，且档案开头必须明确声明形态**——真实动物写「一只真实形态的{品种}{动物}（非拟人、非卡通）」并写全品种/毛色花纹/眼睛/体型；拟人或机器人角色同理写明形态与材质；群演路人不提取。
4. lockPhrase 是该角色档案的外观压缩版（视频模型走英文提示词，中文描述每帧被转述会漂移；锁面短语逐字复用零漂移），例："long silver braid, amber eyes, navy school uniform with white collar, small mole under left eye"。
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
  lockPhrase?: string;
}

/**
 * 单角色档案重生成（增量模式·用户改动优先）：用户在角色框手改的设定（如换了颜色/品种/类型）
 * 是最高优先基准——AI 只在其上扩写补全其他字段，禁止把用户改动改回剧本原样。
 * 剧本仅作背景参考（补全用户未写的维度时取材）。
 */
export function rebuildCharacterProfileMessages(
  scriptText: string,
  name: string,
  currentProfile: string,
  characterRelations: string,
): GenerateMessage[] {
  const SYSTEM = `你是短剧角色设计师。为指定角色重写一份「可直接用于 AI 生图」的外观档案。
只输出档案文本本身（纯文本，不要 JSON、不要 markdown、不要解释）。
要求：
1. **用户改动优先（铁律）**：当前档案中的设定（颜色/品种/类型/服装/发型等一切已写明项）是最高基准——即使与剧本冲突也一律保留当前档案的版本，禁止改回剧本原样；你只做扩写与补全，不推翻用户的任何设定；
2. 在当前档案基础上逐项写全：年龄性别身份｜发型发色（长度/造型）｜瞳色｜脸型五官特征｜体型身高｜服装（款式/颜色/材质）｜标志性配饰｜气质神态（80-150字）；
3. 当前档案未写明的维度才参考剧本补全；剧本也没有的按题材合理设定；
4. 生图模型看不到剧本——档案必须自足完整。`;
  return [
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content: [
        `角色：${name}`,
        currentProfile
          ? `当前档案（用户已确认/手改，以下设定不得变更，只在其上扩写）：${currentProfile}`
          : '（当前档案为空，请按剧本从零建立）',
        characterRelations ? `人物关系：${characterRelations}` : '',
        `剧本（仅作背景参考，与当前档案冲突时以当前档案为准）：\n${scriptText}`,
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
      (x): x is { name: string; profile?: string; lockPhrase?: string } =>
        typeof x === 'object' && x !== null && typeof (x as { name?: unknown }).name === 'string',
    )
    .map((x) => ({
      name: x.name,
      profile: typeof x.profile === 'string' ? x.profile : '',
      lockPhrase: typeof x.lockPhrase === 'string' && x.lockPhrase.trim() ? x.lockPhrase.trim() : undefined,
    }))
    .filter((x) => x.name.trim());
}
