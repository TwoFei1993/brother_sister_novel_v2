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
 * 本地 H3 视频提示词 v3（drama-skills H3 方言对照升级，2026-11-14）。
 * v2 基础上补六项：non_diegetic_music 字段 / 字幕禁令 / 说话人绑定 (S1) / 同框闭嘴 /
 * 开口自然停顿 / t2v 画风守护。chars 注入【人物规格】+ lockPhrase 连续性锁面逐字保留。
 * 铁律不变：H3 对否定不敏感——除官方 no-clip 系字段外一律正向描述。
 */
export function buildLocalVideoPrompt(
  shot: Pick<DuanjuShot, 'gridParts' | 'actionStart' | 'actionEnd' | 'cameraMove' | 'staging' | 'dialog' | 'speaker' | 'onScreenText' | 'durationSec'>,
  chars: Pick<DuanjuCharacter, 'name' | 'profile' | 'lockPhrase'>[] = [],
  opts: { hasLastFrame?: boolean; prevEndState?: string; textToVideo?: boolean; styleGuard?: string } = {},
): string {
  const duration = shot.durationSec ?? 5;
  const parts = shot.gridParts.length > 0 ? shot.gridParts : [`${shot.actionStart} → ${shot.actionEnd}`];
  const tl = frameTimeline(duration, parts.length);
  const lines: string[] = [];

  // t2v 画风守护（P0-6）：H3 文生偏真人实拍——动漫项目首句 + 全文媒介声明（styleGuard 由调用方给画风英文）
  if (opts.textToVideo && opts.styleGuard) {
    lines.push(`${opts.styleGuard}, not live-action, not photographed, no real actors.`);
  }
  // 跨镜衔接：上一镜段末状态（谁+在哪+姿态+道具）——本镜开场应从此状态自然延续
  if (opts.prevEndState?.trim()) {
    lines.push(`[Continuity] opening continues naturally from the previous shot's final state: ${opts.prevEndState.trim()}`);
  }
  // 人物规格：交叉验证首尾帧中的人物特征 + 连续性锁面逐字保留（字符串级一致，P1-8）
  if (chars.length > 0) {
    lines.push(
      `[Character spec] ${chars.map((c) => `${c.name}（${c.profile}）`).join('；')} — appearance must stay identical to the reference frames throughout.`,
    );
    const locks = chars.map((c) => c.lockPhrase?.trim()).filter((v): v is string => !!v);
    if (locks.length > 0) lines.push(`[Continuity locks] ${locks.join('; ')} — keep every item verbatim in all frames.`);
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

  // 说话人绑定（P0-3）：(S1) + 声线描述 + 开口自然停顿（P0-5：H3 首帧开口延迟 1.3-2.4s）
  if (shot.dialog) {
    const speaker = shot.speaker?.trim() || chars[0]?.name || '';
    if (speaker) {
      lines.push(
        `${speaker} (S1), on-screen, mouth visibly articulating the words, speaks after a brief natural pause from the opening state: <d>[Chinese] ${shot.dialog}</d>`,
      );
    } else {
      lines.push(`<d>[Chinese] ${shot.dialog}</d>`);
    }
    // 同框闭嘴（P0-4）：多角色镜不说话者显式闭嘴——防口型误落到近景他人
    const others = chars.map((c) => c.name).filter((n) => n && n !== speaker);
    if (others.length > 0) {
      lines.push(`${others.join(' and ')} ${others.length > 1 ? 'do' : 'does'} not speak; ${others.length > 1 ? 'their' : 'their'} lips remain completely closed throughout.`);
    }
  }
  // 文字边界（P0-2）：正向声明只有画内文字例外（例外内容逐字——P1-10）
  const onScreen = shot.onScreenText?.trim();
  lines.push(
    onScreen
      ? `[Text] The only on-screen text is: "${onScreen}" — rendered exactly as written on its surface; any other captions, subtitles or text overlays must never appear.`
      : `[Text] The frame stays free of any captions, subtitles or text overlays at all times.`,
  );
  // 声音层（官方字段）：正向环境/动作声 + 显式无画内配乐（P0-1：省略该字段 H3 会自行补乐）
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
