/**
 * 视频提示词库（A1/A2 升级，2026-11-14 对比学习产出；v4 = 2026-11-20 官方指南对齐）
 *
 * 依据：HuggingFace MiniMaxAI/MiniMax-H3 官方 VIDEO_PROMPT_WRITING_GUIDE_base_en.md 全文（v4 逐条对齐）
 * - 首行指令官方精确句式：i2v「…<Picture 1> (from [Shot 1]) is fully referenced.」/ flf2v「How the
 *   reference pictures align … Picture 1 (from Shot 1) aligns with the 0.00-second mark …」
 * - 三核心字段名：integrated_multimodal_description / overall_soundscape / non_diegetic_music
 * - 相机运动三维度（类型+幅度+速度）官方词表，嵌入叙事而非独立标签堆叠
 * - 单镜头时间推进用官方 MM:SS.mmm 时刻（At 00:02.000, …），不用时间段戳
 * v2/v3 保留项：人物规格交叉验证 + 锁面逐字 + (S1) 说话人绑定 + 同框闭嘴 + 画面文字边界 + 正向声音。
 * 铁律不变：H3 对否定不敏感、对词根敏感——禁「no X」，一律正向描述（A2）。
 */
import type { DuanjuCharacter, DuanjuProject, DuanjuShot } from '@shared/duanju';

/** 运镜量化映射（v4 官方三维度词表）：类型 + 幅度 + 速度 → 自然英语镜头语言 */
const CAMERA_QUANTIFY: Record<string, string> = {
  固定: 'holds a static shot, camera position and lens still',
  推: 'pushes in with small amplitude at slow speed',
  拉: 'pulls out with small amplitude at slow speed',
  摇: 'pans with medium amplitude at slow speed',
  移: 'trucks sideways with medium amplitude at slow speed',
  跟: 'does a tracking shot following the moving subject at normal speed',
};

const quantifyCamera = (move: string): string => CAMERA_QUANTIFY[move] ?? `camera: ${move}`;

/** 画风 → t2v 媒介守护句（P0-6：H3 文生偏真人实拍，动漫项目必须首句声明非实拍） */
const STYLE_GUARD: Record<string, string> = {
  动漫风: 'A 2D hand-drawn anime animation',
  '3D 卡通': 'A 3D cartoon animation render',
  写实: 'A cinematic live-action style footage',
  国漫: 'A 2D Chinese donghua animation',
  水墨: 'A traditional Chinese ink-wash animation',
};

export function styleGuardOf(style: string): string {
  return STYLE_GUARD[style] ?? 'A 2D animation';
}

/** 声音正向化：空默认值禁否定式（no music 会渲染出音乐）；用户原文透传 */
const DEFAULT_AUDIO = 'ambient sound and action sound only: environment tone, footsteps, cloth movement and props';

/** 景别 → 官方英文景别词（shotSize 首句用） */
const SHOT_SIZE_EN: Record<string, string> = {
  远景: 'extreme wide',
  全景: 'wide',
  中景: 'medium',
  近景: 'medium close-up',
  特写: 'close-up',
};

/** 秒 → 官方 MM:SS.mmm 时刻（时间推进用，如 00:02.000） */
const mmss = (v: number): string => {
  const m = Math.floor(v / 60);
  const s = v - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`;
};

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
 * 本地 H3 视频提示词 v4（官方指南全文逐条对齐，2026-11-20）。
 * v3 基础上：首行官方精确指令句 / integrated_multimodal_description 字段名 / [Shot 1] 叙事流
 * （首帧锚定→运镜三维度→MM:SS.mmm 时刻推进→到达尾帧）/ 对白并入叙事流。
 * v2/v3 保留：人物规格 + 锁面逐字 + (S1) 绑定 + 同框闭嘴 + 文字边界 + 正向声音。
 * 铁律不变：H3 对否定不敏感——除官方 no-clip 系字段外一律正向描述。
 */
export function buildLocalVideoPrompt(
  shot: Pick<DuanjuShot, 'gridParts' | 'actionStart' | 'actionEnd' | 'cameraMove' | 'staging' | 'dialog' | 'speaker' | 'onScreenText' | 'durationSec' | 'shotSize'>,
  chars: Pick<DuanjuCharacter, 'name' | 'profile' | 'lockPhrase'>[] = [],
  opts: { hasLastFrame?: boolean; prevEndState?: string; textToVideo?: boolean; styleGuard?: string } = {},
): string {
  const duration = shot.durationSec ?? 5;
  const parts = shot.gridParts.length > 0 ? shot.gridParts : [`${shot.actionStart} → ${shot.actionEnd}`];
  const tl = frameTimeline(duration, parts.length);
  const lines: string[] = [];

  // t2v 画风守护（官方：T2VA 无对齐指令、直接进核心字段——守护句作全文第一行）
  if (opts.textToVideo && opts.styleGuard) {
    lines.push(`${opts.styleGuard}, not live-action, not photographed, no real actors.`);
  }
  // v4 首行对齐指令（官方精确句式）：i2v 锚首帧 / flf2v 首尾双锚（时刻两位小数）
  lines.push(
    opts.hasLastFrame
      ? `How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot 1) aligns with the ${duration.toFixed(2)}-second mark of the target video.`
      : `For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.`,
  );
  // 跨镜衔接：上一镜段末状态（谁+在哪+姿态+道具）——本镜开场应从此状态自然延续（v3 保留）
  if (opts.prevEndState?.trim()) {
    lines.push(`[Continuity] opening continues naturally from the previous shot's final state: ${opts.prevEndState.trim()}`);
  }
  // 人物规格 + 锁面逐字（v3 保留）
  if (chars.length > 0) {
    lines.push(
      `[Character spec] ${chars.map((c) => `${c.name}（${c.profile}）`).join('；')} — appearance must stay identical to the reference frames throughout.`,
    );
    const locks = chars.map((c) => c.lockPhrase?.trim()).filter((v): v is string => !!v);
    if (locks.length > 0) lines.push(`[Continuity locks] ${locks.join('; ')} — keep every item verbatim in all frames.`);
  }

  // integrated_multimodal_description（官方核心字段）：[Shot 1] 叙事流
  // 结构＝首帧锚定 → 运镜（三维度自然句）→ 时刻推进（官方 MM:SS.mmm）→（flf2v）到达尾帧 → 对白
  const narrative: string[] = [];
  const sizeEn = SHOT_SIZE_EN[shot.shotSize ?? ''] ?? 'cinematic';
  narrative.push(
    `[Shot 1] ${sizeEn} shot opening exactly as <Picture 1> — the subjects' appearance, outfits, positions and the scene stay identical to the reference picture throughout.`,
  );
  narrative.push(`The camera ${quantifyCamera(shot.cameraMove || '固定')}${shot.staging ? `, ${shot.staging}` : ''}.`);
  parts.forEach((p, i) => {
    narrative.push(
      i === 0
        ? `At the start, ${p} — precisely matching the opening state.`
        : `At ${mmss(tl[i]![0])}, ${p}.`,
    );
  });
  if (opts.hasLastFrame) {
    narrative.push('The shot ends by arriving exactly at the pose, spacing and composition of <Picture 2>.');
  }
  // 对白（官方说话人协议）：(S1) + 可见口型 + 自然停顿；同框闭嘴（v3 保留）
  if (shot.dialog) {
    const speaker = shot.speaker?.trim() || chars[0]?.name || '';
    if (speaker) {
      narrative.push(
        `${speaker} (S1), on-screen and visibly articulating the words, speaks after a brief natural pause from the opening state: <d>[Chinese] ${shot.dialog}</d>`,
      );
      const others = chars.map((c) => c.name).filter((n) => n && n !== speaker);
      if (others.length > 0) {
        narrative.push(`${others.join(' and ')} ${others.length > 1 ? 'do' : 'does'} not speak; ${others.length > 1 ? 'their' : 'their'} lips remain completely closed throughout.`);
      }
    } else {
      narrative.push(`<d>[Chinese] ${shot.dialog}</d>`);
    }
  }
  lines.push(`integrated_multimodal_description: ${narrative.join(' ')}`);

  // 文字边界：正向声明只有画内文字例外（例外内容逐字）（v3 保留）
  const onScreen = shot.onScreenText?.trim();
  lines.push(
    onScreen
      ? `[Text] The only on-screen text is: "${onScreen}" — rendered exactly as written on its surface; any other captions, subtitles or text overlays must never appear.`
      : `[Text] The frame stays free of any captions, subtitles or text overlays at all times.`,
  );
  // 声音层（官方字段）：正向环境/动作声 + 显式无画内配乐（省略该字段 H3 会自行补乐）
  lines.push(`overall_soundscape: ${DEFAULT_AUDIO}.`);
  lines.push(`non_diegetic_music: N/A`);
  return lines.join('\n');
}

// ---------- 即梦视频提示词（D8：镜头卡一键复制；快赢 4 同步 v2 精华——时间轴+尾帧路径） ----------

export function buildVideoPrompt(shot: DuanjuShot, project: DuanjuProject): string {
  const chars = shot.characterIds
    .map((cid) => project.characters.find((c) => c.id === cid))
    .filter((c): c is DuanjuCharacter => !!c)
    .map((c) => c.name);
  const scene = shot.sceneId ? project.scenes.find((s) => s.id === shot.sceneId) : undefined;
  const duration = shot.durationSec ?? 5;
  // 四帧时间轴（与本地 H3 v2 同构）：首帧起势→尾帧落势的路径分段，即梦同样吃结构化时间轴
  const parts = shot.gridParts.length > 0 ? shot.gridParts : [shot.actionStart, shot.actionEnd];
  const step = duration / parts.length;
  const timeline = parts
    .map((p, i) => `${(i * step).toFixed(1)}-${((i + 1) * step).toFixed(1)}秒：${p}${i === 0 ? '（精确复刻首帧画面）' : ''}${i === parts.length - 1 ? '（到达尾帧画面）' : ''}`)
    .join('\n');
  return [
    `一段连续的${duration}秒单镜头视频，按时间轴推进（参考图按顺序即时间顺序）`,
    `人物：${chars.join('、') || '（按图）'}——全程外貌与参考图完全一致；场景：${scene?.name ?? '按图'}`,
    `景别：${shot.shotSize}；运镜：${shot.cameraMove}；站位：${shot.staging}`,
    `动作时间轴：`,
    timeline,
    shot.dialog ? `对白：「${shot.dialog}」（口型同步）` : '无对白',
    `声音：只有环境音与动作声（脚步/衣料/环境基调）`,
    `画风：${project.style}，与参考图保持一致`,
  ].join('\n');
}
