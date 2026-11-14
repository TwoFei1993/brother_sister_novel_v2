/**
 * 服装库 prompt 模板（B5 轻量版，2026-11-14 生图对比学习产出）
 *
 * 依据：2026.11.1「一键服装库+批量换装」工作流 LLM 设计师 system（697 字）与 48 条示例固定句式；
 * 换装/换姿势编辑指令＝2026.11.4「姿态服装库」工作流原文（逐项保留清单 + 身体几何分解词）。
 * 白底无人陈列规范：禁「隐形人台/模特穿着」措辞（诱导画人），用「女大学生的风衣」表归属。
 */
import { stylePrefix } from './prompts-image';
import type { GenerateMessage } from '../../../../api/llm';

/** 服装库 LLM 设计师 system（一句话人设 → N 套服装商品图 prompt，每套独占一行） */
export const OUTFIT_DESIGNER_SYSTEM = `你是短剧 App 服装库的服装提示词设计师。根据用户提供的角色身份、性格、世界观、服装需求、套数，生成恰好指定套数的服装生图提示词。
先在内部规划适合该角色生活场景的服装用途，再设计不同套装。服装类别由你根据用户设定决定；兼顾日常、学习或工作、休息、季节、正式场合及世界观中特有的活动，不要机械套用固定类别。把性格转化为可见的廓形、配色、材质和细节。每套都要有实质差异，并包含完整的服装组合：上装与下装，或连衣裙、长袍等连身单品；通常还应包含合适的鞋袜。用户明确排除的单品不要添加。
每条提示词都描述一张纯白无缝背景上的无人服装商品图。整套衣物按真实穿着关系立体悬空陈列，衣物轮廓完整，实际存在的衣领、袖口等开口内部只见白色背景。布料可以自然垂坠，但画面只能出现服装和必要的服饰配件。不得出现真人、皮肤、头颈、四肢、人体轮廓、人台、衣架或场景道具。不要使用「隐形人台」「隐形模特」「ghost mannequin」「模特穿着」等措辞；用「女大学生的风衣」表示归属，不写「女大学生穿着风衣」。统一使用柔和均匀的棚拍光线，无文字、无标识、无水印。
严格按照用户指定的套数输出，不多不少。每套提示词独占一行，相邻两条之间空一行；每条内部不得换行。每条都必须独立完整，包含服装内容和白底无人展示要求，可直接用于生图。不要输出序号、标题、分类标签、解释、Markdown 或代码块。`;

/** 服装库设计对话（用户消息由角色档案 + 需求拼装） */
export function buildOutfitMessages(style: string, name: string, profile: string, count: number, extraNeeds?: string): GenerateMessage[] {
  return [
    { role: 'system', content: OUTFIT_DESIGNER_SYSTEM },
    {
      role: 'user',
      content: `角色：${name}（${profile}）。画风定语（每条末尾拼接）：${stylePrefix(style)}。套数：${count}。${extraNeeds ? `额外需求：${extraNeeds}` : ''}`,
    },
  ];
}

/** 单套服装商品图 prompt（LLM 产出即用；手工建库时套此式——尾串逐字复用） */
export function outfitItemPrompt(style: string, identity: string, usage: string, items: string, details: string): string {
  return `纯白无缝背景上的${identity}${usage}商品图，${items}，${details}，${stylePrefix(style)}；整套衣物按穿着关系立体悬空陈列，衣物开口内部只见白底，画面仅有服装，无真人、无人台，柔和均匀棚拍光线。`;
}

/** 换装编辑指令（2511/EditPlus：image1=角色帧/锚点，image2=服装白底图）——原文为「图2中人物所穿的服装」，白底陈列图须改为「陈列的」防诱导画人 */
export function outfitSwapPrompt(name: string, outfitDesc: string): string {
  return [
    `将图1中${name}的服装替换为图2中陈列的服装（${outfitDesc}），参照图2保留服装的款式、颜色、材质、图案和穿着层次，使其自然贴合${name}的身形与姿势。`,
    `${name}的长相、发型、表情、姿势和画风保持图1一致。`,
    '保留图1中双臂、双手及每根手指的原有位置和可见状态；袖子自然连接手腕。保留图1的背景、光线和构图。',
  ].join('');
}

/** 换姿势编辑指令（image1=角色帧，image2=姿态参考图）——身体几何分解词是姿势约束关键 */
export function poseSwapPrompt(name: string): string {
  return [
    `将图1中${name}的姿势调整为图2中人物的姿势。`,
    '以图2为姿势参照，匹配头部角度、躯干朝向、双臂和双手动作；同时匹配骨盆方向、双腿位置、膝盖弯曲程度、双脚落点和身体重心，让上下半身共同呈现图2的完整姿势。',
    `${name}的长相、发型、服装和画风均保持图1一致；衣物褶皱随新姿势自然变化，保留图1的背景、光线和整体构图。`,
  ].join('');
}
