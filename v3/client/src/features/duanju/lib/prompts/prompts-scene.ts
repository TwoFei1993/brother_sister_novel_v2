/**
 * 场景图 prompt v2（2026-11-14 生图对比学习升级）
 *
 * 升级依据（天宫仙境五件套方法论 → 现代短剧场景翻译）：
 * - 七种空间模式各带一句可执行指令（一张图只选一种，不平均叠加）
 * - 尺度证据：用可见比例关系替代「豪华/开阔」类抽象词；最近物体越框、重复构件汇聚唯一消失点、空域 45%-65%
 * - 「写光的效果不写光源」：写窗户会把窗户画进画面（character-refs 写实层实测）
 * - 固定地标 + 屏幕相对位置：场景一致性传给分镜的关键数据
 * - 一种环境动态只选一种（元素预算）
 */
import { stylePrefix } from './prompts-image';

/** 场景空间模式（scene.mode；由 AI 建场景时判定或用户选）——天宫七模式的现代短剧翻译 */
export const SCENE_MODES = ['interior-depth', 'lateral-run', 'one-side-depth', 'landmark-far', 'vertical-tower', 'nature-frame', 'enclosed'] as const;
export type SceneMode = (typeof SCENE_MODES)[number];

export const SCENE_MODE_LABELS: Record<SceneMode, string> = {
  'interior-depth': '室内纵深',
  'lateral-run': '横向延展',
  'one-side-depth': '单侧纵深',
  'landmark-far': '地标远景',
  'vertical-tower': '竖向高耸',
  'nature-frame': '自然框景',
  enclosed: '封闭空间',
};

const SCENE_MODE_PROMPTS: Record<SceneMode, string> = {
  'interior-depth': '近景以门框、柜体等大块结构越出画框，中景展开空间主体，远景以门窗开口框住更远处的空间或光，约 32mm 广角，轻平视',
  'lateral-run': '一条连续结构线（走廊/街道/栏杆/长桌）横贯画面，只保留这一条主要结构线，上下分别交给天花板与地面，稳定侧视，70-85mm 中长焦',
  'one-side-depth': '结构压住画面一侧且最近部分越框，另一侧保留完整空域（窗/街/水面），柱列或门框指向唯一消失点',
  'landmark-far': '远方主体经空气透视后仍占画面高度 30% 以上，前景以开阔地面或水面提供距离与比例，70-100mm 中长焦防止主体缩小',
  'vertical-tower': '轻仰视 5-12 度，顶部结构越出画面上沿，地面与近物不占主要面积',
  'nature-frame': '树冠/枝叶/雨帘/帘幕覆盖画面上方三分之一并越出边缘，中央保留开阔空域',
  enclosed: '两处以上近景结构越框证明逼仄尺度，开口（电梯门/车窗）框住外部一线光或景，广角近大远小',
};

/**
 * 场景图 prompt v2：按 scene.mode 注入模式指令；未提供 mode 回退通用广角三层纵深。
 */
export function sceneImagePrompt(style: string, name: string, spec: string, mode?: string): string {
  const modePrompt = mode && (SCENE_MODES as readonly string[]).includes(mode)
    ? SCENE_MODE_PROMPTS[mode as SceneMode]
    : '广角视野交代完整空间，透视自然';
  return [
    `${stylePrefix(style)}，电影级场景概念图（无人物）。`,
    `【场景：${name}】${spec}`,
    `空间模式（只按此执行）：${modePrompt}。`,
    '尺度要求：用可见比例关系交代空间大小，不用「宏大/豪华/开阔」等形容词——最近的物体越出画框；重复构件（门框/柱/窗/路灯）逐级缩小、汇聚到唯一消失点；门窗等开口与床/桌形成数倍比例差；天空、水面或地面等空旷区域占画面 45%-65%，且有远近与明暗层次。',
    '构图要求：只用一个消失点与一条视觉引导线；画面分前/中/远三层，主体轮廓一眼可辨。',
    '光影要求：写光的效果而非光源——主光从固定方向照来，落在具体表面上的效果（湿润表面反光、金属高光、布料吸光、边缘光勾轮廓），色温倾向明确；全画面只有一个主光方向。',
    '氛围要求：画出时间感与温度感（雨夜湿冷、清晨薄雾、黄昏暖尘），加入一种环境动态（雨丝飘落/雾气流动/水面波纹/光斑移动/蒸汽上升——只选一种）。',
    '关键道具：清晰可辨、位置合理，并记住其屏幕相对位置（如「门框：右侧三分之一」「沙发：中央偏下」）供后续分镜锚定。',
    '纯净要求：删除所有人物后，画面自身即成立为完整环境。',
  ].join('\n');
}
