/**
 * 试验台扩写系统词（设计共识 2026-11-26 第 2.4 节）：一句话 → 可直接送生成的完整提示词。
 *
 * 本地 H3-Image 的写法规则有两个来源，叠在一起用：
 * - MiniMax 官方的提示词技能（h3-image-prompt-writing）：三段式结构、「每个主体一句关系」、
 *   「没有文字就明说」、取景由底图决定；
 * - 2026-11-24 四轮受控实验的定稿（35 张，全分辨率逐张验收，本机工作流实测）：
 *   Picture 1 是底图决定一切、脸逐条写成保留项且不再描述长相、表情用肌肉动作写、动作按动力链写。
 */
import { LAB_PROMPT_LIMITS, type LabAspect, type LabKind, type LabProvider } from '@shared/duanju/lab';
import type { GenerateMessage } from '../../../../api/llm';
import { effectiveRefs } from './refs';
import { stylePrefix } from '../prompts/prompts-image';
import type { LabInputState } from './taskState';

const DEFAULT_STYLE = '动漫风';

/** 带入扩写上下文的本作品资产：角色档案与场景档案进提示词，让试验图沿用这本书的设定 */
export interface ExpandAssets {
  characters: ReadonlyArray<{ name: string; profile: string }>;
  scenes: ReadonlyArray<{ name: string; spec: string }>;
}

export interface ExpandInput {
  /** 用户输入的简短提示词 */
  brief: string;
  kind: LabKind;
  provider: LabProvider;
  /** 输出语言 */
  language: 'zh' | 'en';
  /** 画幅（写进构图考虑） */
  aspect: LabAspect;
  /** 本作品画风（project.style） */
  style: string;
  /** 画风层文本（prompts-image 的 stylePrefix） */
  styleText: string;
  /** 项目视觉签名（逐字附在提示词末尾；空=不附） */
  visualSignature?: string;
  /** 带入的本作品角色 / 场景档案（可选） */
  assets?: ExpandAssets;
  /** 参考图的说明（按 Picture 序号；扩写模型看不到图，照这句写） */
  refs?: ReadonlyArray<{ caption: string }>;
}

export const LAB_KIND_LABELS: Record<LabKind, string> = {
  free: '自由画面',
  character: '人物定妆',
  scene: '场景概念',
  frame: '单帧分镜',
};

const H3_RULES = `目标引擎是 MiniMax H3-Image，按它的写法规则写：
1. 画面严格跟字面走：只写「有什么」。每一句都必须是想要的、能画出来的内容；一张图只写一个瞬间。
2. 没有负向提示词：不写针对画面主体的否定句（不要、无、禁止、避免、never）——否定词根会被当成画面内容渲染。不想要的东西换成想要的表述（「背景干净整洁」而不是「无杂物」）。唯一的例外是文字、水印这类与主体无关的杂物：用户没要求图里出现文字时，在末尾单独写一句「图中没有任何文字、字母或数字」，免得模型自己加标题和装饰字。
3. 动作按「动力链 + 几何」写，不写结果词：写清脚、膝、躯干、肩髋、手的位置与方向、幅度（「后脚蹬地、前膝弯到直角、躯干前倾、双手在腰侧高度握柄」），不写「激烈打斗」「惊天一击」这类概括词。
4. 表情用肌肉动作写，每个人物都写：「嘴唇抿紧、眉头微压、下巴保持水平」；不写「瞪眼、张嘴、瞳孔骤缩」（会被画到最夸张）。
5. 主体道具带先行词（「这把剑」「她手中的罗盘」），场景里的相似物件写明保持原样，避免被一并改色。
6. 身体要站得住：朝向、看得见的体表、手、支撑点和接触关系互相对得上（脚踩在哪、手扶着什么、两个人在哪里接触）；画面里已有的手和道具写成保留项，必须移动时交代旧位置的去向，避免多手、重复武器、悬空。不要为了迁就一个姿势把画面的左右布局镜像过来。
7. 先布局后细节：先交代主体有几个、各在画面的什么位置、视点与留白，再写细节。风格用看得见的东西写（颜色、材质、光的方向、纹理），「高级、震撼、气势磅礴、唯美」这类画不出来的形容词删掉。
8. 提示词要够长够具体（官方说明：短提示词会出塑料感的人脸）：人物的年龄感、发型发色、皮肤质感、服装材质；环境的空间层次；光的方向与落在物体上的效果；相机与镜头。用户要求图里出现文字时，把每一个字原样写全并说明位置与大小。`;

const H3_REF_RULES = `这张图带参考图，按 H3 编辑提示词的三段式写成一段连续文字（不要写出段落标题）：
1. 来源定义：先交代每张参考图里被用到的对象——「[特征 + 位置] in <Picture N> is <Subject N>」。<Picture N> 按参考图顺序编号，<Subject N> 全文不变。每张参考图都要交代它的用途：是底图、是人物造型参考、还是场景或配色参考。
2. 目标图与各来源的关系：以「The target image shows …」说清画面是什么，再给每个主体单独一句关系——原样保留的写「<Subject N> is fully preserved.」；部分保留的写明哪些保留（脸、发型、服装、姿态）、哪些变；只借某一项的（换配色、参考画风）写成迁移或弱参考，并说明不带入它的其它属性。
3. 变化与新增：只写变了什么、加了什么，以及它们的具体样子；底图里有而目标图里没有的东西，用它原来的位置现在被什么占据来描述。保留的部分不再复述外观。说清就停，不加填充。
另有几条本机实测的硬规则：
- <Picture 1> 是底图：场景、构图、画幅取景都跟它走；人物造型图、场景图不用来定构图。
- 参考图里人物的脸、表情、头位逐条写成保留项，不要重新描述长相——重新描述会把脸改掉。
- 表情用肌肉动作写；没有变化的写成与 <Picture 1> 相同。用户没要求图里出现文字时，写明图中没有任何文字。
- 改姿势时，底图里已有的手和道具写成保留项；必须移动时交代旧位置的去向。`;

const CLOUD_RULES = `目标引擎是云端中文生图模型，写法：先写主体 → 环境与光线 → 构图与镜头 → 画质。
可以有一行「避免出现：」结尾列出不想要的元素，其余部分都写「有什么」。用户没要求图里出现文字时，把「文字、水印」写进这一行。`;

const CLOUD_REF_RULES = `这张图带 1 张参考图：提示词开头写明以图1为准保持主体一致（外貌、服装、物件照图1），再写要变化的部分；不要重新描述图1里人物的长相。`;

const KIND_GUIDES: Record<LabKind, string> = {
  free: '画面类型：自由画面。按用户的描述组织，不必套用固定模板。',
  character:
    '画面类型：人物定妆。逐项写清外观锚点（年龄感、发型与发色、瞳色、肤色、体型、服装款式与材质、配饰），姿态与朝向，简洁背景（纯色或虚化），柔光下的人物质感。单个人物。',
  scene:
    '画面类型：场景概念图（无人物）。写清空间层次（前中远景）、尺度证据（近处物体越出画框、重复构件汇聚到唯一消失点）、写光的效果而不是光源、时间与温度的氛围、一种环境动态、关键道具及其在画面中的相对位置。',
  frame:
    '画面类型：单帧分镜。写清景别与构图、每个人物的站位与身体朝向、视线落点、一个动作瞬间（按动力链写）、表情（按肌肉动作写）、手部状态、环境动态与光线。',
};

export function buildExpandMessages(input: ExpandInput): GenerateMessage[] {
  const isH3 = input.provider === 'comfy';
  const limit = LAB_PROMPT_LIMITS[input.provider];
  const lang = input.language === 'en' ? '用英文写' : '用中文写';
  const refs = input.refs ?? [];
  const system = [
    '你是 AI 生图提示词专家，负责把用户的一句话想法扩写成可以直接送去生成的完整提示词。',
    isH3 ? H3_RULES : CLOUD_RULES,
    refs.length > 0 ? (isH3 ? H3_REF_RULES : CLOUD_REF_RULES) : '',
    `硬性要求：只输出最终的提示词正文——不要解释、不要标题、不要 markdown 代码块、不要「提示词：」「Prompt:」之类前缀。${lang}。不超过 ${limit} 字。`,
  ]
    .filter(Boolean)
    .join('\n');

  const characters = input.assets?.characters ?? [];
  const scenes = input.assets?.scenes ?? [];
  const assetLines = [
    ...(characters.length || scenes.length ? ['本作品的设定（画面里出现这些角色 / 场景时，外观与空间严格照此写）：'] : []),
    ...characters.map((c) => `角色「${c.name}」：${c.profile}`),
    ...scenes.map((s) => `场景「${s.name}」：${s.spec}`),
  ];
  const refLines = [
    ...(refs.length ? [`参考图（共 ${refs.length} 张，按顺序；提示词里用 ${isH3 ? '<Picture N>' : '图N'} 指代第 N 张）：`] : []),
    ...refs.map((r, i) => `图${i + 1}：${r.caption.trim() || '（用户未说明，按画面内容理解）'}`),
  ];
  const lines = [
    `用户的想法：${input.brief}`,
    KIND_GUIDES[input.kind],
    `画幅：${input.aspect}。`,
    `画风：${input.style}。画风基调参考（按需融入，不要照抄整段）：${input.styleText}`,
    ...assetLines,
    ...refLines,
    input.visualSignature?.trim() ? `项目视觉签名（原样附在提示词末尾，一字不改）：${input.visualSignature.trim()}` : '',
    `请输出扩写后的完整提示词。`,
  ];
  return [
    { role: 'system', content: system },
    { role: 'user', content: lines.filter(Boolean).join('\n') },
  ];
}

/** 扩写时需要的作品信息（DuanjuProject 的结构子集） */
export interface ExpandProject {
  style?: string;
  visualSignature?: string;
  characters: ReadonlyArray<{ id: string; name: string; profile: string }>;
  scenes: ReadonlyArray<{ id: string; name: string; spec: string }>;
}

/** 输入区状态 + 本作品 → 扩写上下文：带入所选角色 / 场景档案，参考图说明只给该通道实际会用的那些 */
export function buildExpandInput(state: LabInputState, project: ExpandProject | null): ExpandInput {
  const style = project?.style || DEFAULT_STYLE;
  const characters = project?.characters ?? [];
  const scenes = project?.scenes ?? [];
  const refs = effectiveRefs(state.provider, state.refs);
  return {
    brief: state.brief.trim(),
    kind: state.kind,
    provider: state.provider,
    language: state.language,
    aspect: state.aspect,
    style,
    styleText: stylePrefix(style),
    visualSignature: project?.visualSignature,
    assets: {
      characters: characters.filter((c) => state.characterIds.includes(c.id)).map((c) => ({ name: c.name, profile: c.profile })),
      scenes: scenes.filter((s) => state.sceneIds.includes(s.id)).map((s) => ({ name: s.name, spec: s.spec })),
    },
    ...(refs.length ? { refs: refs.map((r) => ({ caption: r.caption })) } : {}),
  };
}
