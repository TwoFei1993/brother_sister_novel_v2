/**
 * 短剧生图 prompt 模板（共识 D6-D7 / 资料第 3-4 课）
 *
 * - characterSheetPrompt：角色设定图（三视图式正面全身·无复杂动作·外观锚点全量注入）
 * - sceneImagePrompt：场景图（无人物·空间结构/光影基调/关键道具）
 * - 画风前缀统一注入（project.style）
 */

/** 画风 → 生图风格描述（比自由文本更可控；自定义画风原样透传） */
const STYLE_PROMPTS: Record<string, string> = {
  动漫风: '日系动漫插画风格，赛璐璐上色，线条干净，色彩明亮通透',
  '3D 卡通': '3D 卡通渲染风格，皮克斯质感，造型圆润，材质柔和',
  写实: '写实风格，高清数字绘画，光影真实，细节丰富',
  国漫: '国产动漫风格，唯美古韵与现代结合，色彩饱和，笔触细腻',
  水墨: '水墨画风，留白意境，笔锋浓淡相宜，宣纸质感',
};

export function stylePrefix(style: string): string {
  return STYLE_PROMPTS[style] ?? `${style}风格`;
}

/**
 * 角色设定图 prompt（反馈 #8：专业 character sheet 版式，参考用户样图）——
 * 多套服装全身像 + 每套三视图（正/侧/背）+ 表情与细节（发型/眼/配饰）+ 色板。
 * 竖版 2:3 承载多行版式。外观锚点全量注入保持跨图一致。
 */
export function characterSheetPrompt(style: string, name: string, profile: string): string {
  return [
    `${stylePrefix(style)}，角色设定图 character sheet 设计稿，单张图中多区块网格排版`,
    `【角色：${name}】${profile}`,
    '版式要求（从上到下）：',
    '① 顶行：同一角色 2-3 套不同服装的全身站立像（如日常装/正式装/战斗装），并排展示',
    '② 中行：每套服装对应的正面/侧面/背面三视图小图',
    '③ 下行：表情特写（喜怒哀乐各一）、发型细节、眼睛特写、标志性配饰与道具分件',
    '④ 底行：该角色的主色板色卡条',
    '全程同一人物同一画风，五官/发型/体型跨区块完全一致；白底干净排版，区块间细分隔线，',
    '区块可带小号英文标签（如 OUTFIT A / FRONT / SIDE / BACK / EXPRESSIONS / PALETTE）',
  ].join('\n');
}

/** 场景图 prompt（资料第 4 课：画面氛围统一不乱跳） */
export function sceneImagePrompt(style: string, name: string, spec: string): string {
  return [
    stylePrefix(style),
    '场景概念图（无人物）',
    `【${name}】${spec}`,
    '构图要求：空间结构清晰，光影基调统一，关键道具明确，无任何人物出现',
    '透视自然，视野完整交代环境，作为后续分镜的场景参考基准',
  ].join('，');
}
