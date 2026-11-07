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

/** 角色设定图 prompt（资料第 3 课：让后续镜头认出「同一个人」） */
export function characterSheetPrompt(style: string, name: string, profile: string): string {
  return [
    stylePrefix(style),
    '角色设定图（character sheet），单一人物',
    `【${name}】${profile}`,
    '构图要求：正面全身站像，中性自然站姿，双臂自然下垂，表情平静',
    '背景纯色简洁，不要复杂动作，不要多人，画面清晰完整，人物特征鲜明可辨识',
    '外观描述必须严格一致：发色发型、瞳色、体型、服装配饰按上述设定完整呈现',
  ].join('，');
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
