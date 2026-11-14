/**
 * 视频提示词库（A1/A2 升级，2026-11-14 对比学习产出）
 *
 * 依据：飞书课件秒级时间轴写法 + AICG3D h3_general 官方协议（I2VA/FL2VA 模式骨架）
 * - buildLocalVideoPrompt：本地 H3 音画一体提示词 v2——四帧时间轴 + 人物规格交叉验证
 *   + 运镜量化 + flf2va 首尾帧对齐声明（裸 picture 1/2 为 H3 官方约定）+ 正向声音描述
 * - buildVideoPrompt：即梦导出用中文分行格式（D8，保持不变）
 * 铁律：H3 对否定不敏感、对词根敏感——禁「no X」，一律正向描述（A2）。
 */
import type { DuanjuCharacter, DuanjuProject, DuanjuShot } from '@shared/duanju';

/** 运镜量化映射：抽象运镜词 → 模型可执行的英文镜头语言（含幅度与速度） */
const CAMERA_QUANTIFY: Record<string, string> = {
  固定: 'tripod lock-off, no camera movement',
  推: 'slow dolly-in toward the subject',
  拉: 'slow dolly-out revealing more of the scene',
  摇: 'gentle pan following the action',
  移: 'smooth lateral tracking move',
  跟: 'camera tracks alongside the moving subject',
};

const quantifyCamera = (move: string): string => CAMERA_QUANTIFY[move] ?? `camera: ${move}`;

/** 声音正向化：空默认值禁否定式（no music 会渲染出音乐）；用户原文透传 */
const DEFAULT_AUDIO = 'ambient sound and action sound only: environment tone, footsteps, cloth movement and props';

/** 秒 → 一位小数字符串（时间轴分段用） */
const sec = (v: number): string => v.toFixed(1);

/**
 * 四帧时间轴分段：durationSec 均分四段，产出 [start, end] 对齐 gridParts 顺位。
 * 帧描述不足 4 段时只覆盖有描述的段（首段必含——它对应首帧）。
 */
export function frameTimeline(durationSec: number, partCount: number): Array<[number, number]> {
  const n = Math.max(1, Math.min(4, partCount));
  const step = durationSec / n;
  return Array.from({ length: n }, (_, i) => [
    Number((i * step).toFixed(1)),
    Number(((i + 1) * step).toFixed(1)),
  ]);
}

/**
 * 本地 H3 视频提示词 v2（flf2va/i2v 单镜头）。
 * chars 注入【人物规格】做首尾帧交叉验证；prevEndState 承接上一镜段末状态（跨镜衔接锚点）。
 */
export function buildLocalVideoPrompt(
  shot: Pick<DuanjuShot, 'gridParts' | 'actionStart' | 'actionEnd' | 'cameraMove' | 'staging' | 'dialog' | 'sound' | 'durationSec'>,
  chars: Pick<DuanjuCharacter, 'name' | 'profile'>[] = [],
  opts: { hasLastFrame?: boolean; prevEndState?: string } = {},
): string {
  const duration = shot.durationSec ?? 5;
  const parts = shot.gridParts.length > 0 ? shot.gridParts : [`${shot.actionStart} → ${shot.actionEnd}`];
  const tl = frameTimeline(duration, parts.length);
  const lines: string[] = [];

  // 跨镜衔接：上一镜段末状态（谁+在哪+姿态+道具）——本镜开场应从此状态自然延续
  if (opts.prevEndState?.trim()) {
    lines.push(`[Continuity] opening continues naturally from the previous shot's final state: ${opts.prevEndState.trim()}`);
  }
  // 人物规格：交叉验证首尾帧中的人物特征（发型/骨相/服装锚点来自角色档案）
  if (chars.length > 0) {
    lines.push(
      `[Character spec] ${chars.map((c) => `${c.name}（${c.profile}）`).join('；')} — appearance must stay identical to the reference frames throughout.`,
    );
  }
  // 首尾帧对齐声明：FL2VA 用官方裸标签 picture 1/2；i2v 只锚首帧
  lines.push(
    opts.hasLastFrame
      ? `How the reference pictures align: picture 1 matches the opening frame exactly at ${sec(0)}s, picture 2 matches the closing frame exactly at ${sec(duration)}s.`
      : `For this video, the opening frame at ${sec(0)}s must precisely match the reference picture.`,
  );
  // 四帧时间轴：首段复刻首帧（i2v/flf2v 均有首帧）、flf2v 末段到达尾帧，中段走 F2/F3 描述（路径约束）
  parts.forEach((p, i) => {
    const [s, e] = tl[i]!;
    const head = i === 0 ? ' — precisely match the opening state' : '';
    const tail = i === parts.length - 1 && opts.hasLastFrame ? ' — arrive exactly at the closing frame state' : '';
    lines.push(`[${sec(s)}s-${sec(e)}s] ${p}${head}${tail}`);
  });
  lines.push(`[Camera] ${quantifyCamera(shot.cameraMove || '固定')}${shot.staging ? `; ${shot.staging}` : ''}.`);
  if (shot.dialog) lines.push(`<d>[Chinese] ${shot.dialog}</d>`);
  lines.push(`[Audio] ${shot.sound?.trim() || DEFAULT_AUDIO}.`);
  return lines.join('\n');
}

// ---------- 即梦视频提示词（D8：镜头卡一键复制，中文分行格式） ----------

export function buildVideoPrompt(shot: DuanjuShot, project: DuanjuProject): string {
  const chars = shot.characterIds
    .map((cid) => project.characters.find((c) => c.id === cid))
    .filter((c): c is DuanjuCharacter => !!c)
    .map((c) => c.name);
  const scene = shot.sceneId ? project.scenes.find((s) => s.id === shot.sceneId) : undefined;
  return [
    `以分镜参考图按顺序生成视频（图生视频，画板/图片顺序即时间顺序）`,
    `人物：${chars.join('、') || '（按图）'}；场景：${scene?.name ?? '按图'}`,
    `景别：${shot.shotSize}；运镜：${shot.cameraMove}；站位：${shot.staging}`,
    `动作：从「${shot.actionStart}」到「${shot.actionEnd}」，动作自然衔接`,
    shot.dialog ? `对白：「${shot.dialog}」` : '无对白',
    `声音：${shot.sound || '环境音与动作声，无背景音乐'}`,
    `画风：${project.style}，与参考图保持一致`,
  ].join('\n');
}
