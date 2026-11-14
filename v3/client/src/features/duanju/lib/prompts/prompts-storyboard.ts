/**
 * 分镜环节 prompt 库（共识 D7/D8 / 资料第 5-6 课；A3/A4 升级 2026-11-14）
 *
 * - buildStoryboardMessages：AI 按集拆镜头（输出 Shot[] JSON，含四格画面描述 + 段末状态）
 * - parseStoryboard：容错解析 + 角色/场景名 → id 映射
 * - validateStoryboardIssues：拆镜头结果机检（时长带宽/否定式/字数——纯规则零成本）
 * - buildGridPrompt：四宫格生图 prompt 组装器（外观锚点∪场景∪画风∪四格）
 * 视频提示词在 prompts-video.ts（即梦版 + 本地 H3 v2）
 */
import type { GenerateMessage } from '../../../../api/llm';
import type { DuanjuCharacter, DuanjuProject, DuanjuProp, DuanjuScene, DuanjuShot } from '@shared/duanju';
import { stylePrefix } from './prompts-image';
import { extractJsonArray } from '../json-extract';

// ---------- AI 拆镜头 ----------

const STORYBOARD_SYSTEM = `你是短剧分镜师。把给定某集剧本拆成镜头清单。
只输出 JSON 数组，不要 markdown 代码块、不要解释。每项：
{"shotSize":"景别(远景/全景/中景/近景/特写)","cameraMove":"运镜(固定/推/拉/摇/移/跟)",
 "actionStart":"动作起点","actionEnd":"动作终点","staging":"人物站位",
 "dialog":"台词(无则空串)","speaker":"说话人角色名(dialog为空则空串)","onScreenText":"画内文字内容(手机屏幕/招牌/纸条等需逐字可读的文字,无则空串)",
 "durationSec": 预估时长秒(4-15整数),"sound":"声音要求(环境音/动作声/对白声)",
 "gridParts":["第1格画面","第2格画面","第3格画面","第4格画面"],
 "endState":"本镜最后一帧画面(谁+在哪+姿态+道具状态)",
 "hookType":"钩子类型(reveal揭示/reversal反转/callback回收/suspense悬念/chase追逐/visual-joke视觉笑点/tender情感/expression-beat表情节拍,纯过场留空串)",
 "characters":["出场角色名(须来自角色清单)"],"scene":"场景名(须来自场景清单,可空)","props":["关键道具名(须来自道具清单,信物/凶器/手机等跨镜道具,可空)"]}
要求：
1. durationSec 按镜头节奏估：动作密集镜头 5-8 秒、特写/反应镜头 4-5 秒、单镜不超过 15 秒；
   一集 6-12 镜头；重要角色同框不超过 3 人；动作起终点可视化（写具体动作而非心理描写）。
2. 每镜一个核心动作；动作描述按时序写：当前状态→动作发生→环境反应→动作结果；一句话只写一个变化。
   抽象情绪词（震惊/紧张/愤怒）必须换成可观察细节（瞳孔收缩/手指扣紧桌沿/下颌绷紧）；禁写「和之前一样」类元话语。
3. gridParts 四格为同一镜头连续动作的四个瞬间，每格只放一个核心动作；每格 40-80 字、写全四要素：
   谁（人物+表情情绪）｜在哪（环境与光线细节）｜做什么（具体动作与力势）｜画面感（构图与光影）——每格都要能直接当生图提示词用。
   每格停在「下一秒即将变化」的瞬间（将转身未转、手将落未落、话将出未出）——已完成的动作没有运动起点。
   转身/出画类动作：对应格画「转身进行到一半」的姿态（侧身 45-90 度、迈出一半），不画转身完成后的背面——视频模型对提示词里的转身方向不敏感，靠起始帧的朝向决定。
4. 对白写完整句；speaker 必须是 characters 里的角色名——多角色镜视频生成靠它绑定口型与声线。
   对白预算：中文台词约 4 字/秒，镜头前 2 秒是开口等待——台词字数超过 (durationSec-2)*4 必须拆镜或申请更长时长，不许硬塞。
   镜头切分优先落在：一句话说完、情绪完成、视线改变、人物关系变化明确处。
5. 同一场拆成多镜时共用一套空间逻辑：staging 以场景固定地标写方位（如「桌子左侧/门口/窗边」），
   相邻镜头保持同一轴线（人物左右关系与朝向不翻转）——A 在 B 左侧，则所有镜头里 A 都在 B 左侧。
6. endState 是跨镜衔接锚点：写下一镜可直接以此开场的定格画面，禁用「严格继承上一镜」套话。
7. onScreenText 只写画面内真实出现的文字（手机聊天、转账金额、招牌、纸条内容逐字抄录）；
   剧本提到「手机显示」「屏幕上写着」时必须提取，不凭空编造。
8. hookType 标注本镜的叙事钩子；每 3 个连续镜头至少 1 个 reveal/reversal/callback，首镜与末镜必带强钩子（完播率钩）。
好例子（同镜头第 2 格，照这个具体程度写）：
"李薇在昏黄路灯下的湿滑巷口猛地转身，风衣下摆甩起水珠；她眉头紧锁张嘴嘶吼，握手机的手指节泛白；逆光剪影，霓虹在湿地面映出冷蓝反光。"`;


export function buildStoryboardMessages(
  episodeSynopsis: string,
  scriptText: string,
  characters: DuanjuCharacter[],
  scenes: DuanjuScene[],
  props?: Array<Pick<DuanjuProp, 'name' | 'spec'>>,
): GenerateMessage[] {
  const charList = characters.map((c) => `- ${c.name}：${c.profile}`).join('\n') || '（无角色，按剧本人名）';
  const sceneList = scenes.map((s) => `- ${s.name}：${s.spec}`).join('\n') || '（无场景清单，按剧本场景自由命名）';
  const propList = (props ?? []).map((p) => `- ${p.name}：${p.spec}`).join('\n') || '（无道具清单）';
  return [
    { role: 'system', content: STORYBOARD_SYSTEM },
    {
      role: 'user',
      content: `本集梗概：${episodeSynopsis}\n\n角色清单：\n${charList}\n\n场景清单：\n${sceneList}\n\n道具清单：\n${propList}\n\n剧本原文：\n${scriptText}`,
    },
  ];
}

interface RawShot {
  shotSize?: unknown;
  cameraMove?: unknown;
  durationSec?: unknown;
  actionStart?: unknown;
  actionEnd?: unknown;
  staging?: unknown;
  dialog?: unknown;
  sound?: unknown;
  gridParts?: unknown;
  endState?: unknown;
  speaker?: unknown;
  onScreenText?: unknown;
  hookType?: unknown;
  characters?: unknown;
  scene?: unknown;
  props?: unknown;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** 解析拆镜头输出并映射 id（角色/场景按名匹配，未匹配的忽略） */
export function parseStoryboard(
  raw: string,
  episodeId: string,
  project: DuanjuProject,
): DuanjuShot[] {
  const arr = extractJsonArray(raw);
  if (!arr) return [];
  const base = Date.now();
  return arr
    .filter((x): x is RawShot => typeof x === 'object' && x !== null)
    .map((x, i): DuanjuShot => {
      const names = Array.isArray(x.characters)
        ? x.characters.filter((n): n is string => typeof n === 'string')
        : [];
      const characterIds = names
        .map((n) => project.characters.find((c) => c.name === n)?.id)
        .filter((v): v is string => !!v);
      const sceneName = str(x.scene);
      const scene = sceneName ? project.scenes.find((s) => s.name === sceneName) : undefined;
      const propNames = Array.isArray(x.props)
        ? x.props.filter((n): n is string => typeof n === 'string')
        : [];
      const propIds = propNames
        .map((n) => project.props?.find((p) => p.name === n)?.id)
        .filter((v): v is string => !!v);
      const parts = Array.isArray(x.gridParts)
        ? x.gridParts.filter((p): p is string => typeof p === 'string').slice(0, 4)
        : [];
      return {
        id: `shot-${base}-${i}-${Math.random().toString(36).slice(2, 6)}`,
        episodeId,
        index: i + 1,
        shotSize: str(x.shotSize) || '中景',
        cameraMove: str(x.cameraMove) || '固定',
        durationSec: typeof x.durationSec === 'number' && x.durationSec >= 1 && x.durationSec <= 120 ? Math.round(x.durationSec) : undefined,
        actionStart: str(x.actionStart),
        actionEnd: str(x.actionEnd),
        staging: str(x.staging),
        dialog: str(x.dialog),
        speaker: str(x.speaker) || undefined,
        onScreenText: str(x.onScreenText) || undefined,
        gridParts: parts,
        endState: str(x.endState) || undefined,
        hookType: str(x.hookType) || undefined,
        gridPrompt: '',
        frames: [],
        characterIds,
        propIds,
        sceneId: scene?.id ?? null,
        updatedAt: base,
      };
    })
    .map((shot) => ({ ...shot, gridPrompt: buildGridPrompt(shot, shot.gridParts, project) }));
}

/**
 * 拆镜头结果机检（A4，参照 H3 官方 H1-H12 的可自动化子集）。
 * 纯规则零成本；返回人话警告列表（空 = 通过）。不阻塞写入——供 UI 提示与调试。
 */
export function validateStoryboardIssues(shots: DuanjuShot[]): string[] {
  const issues: string[] = [];
  shots.forEach((s, i) => {
    const tag = `S${s.index ?? i + 1}`;
    if (s.durationSec !== undefined && (s.durationSec < 4 || s.durationSec > 15)) {
      issues.push(`${tag} 时长 ${s.durationSec}s 超出 4-15s 建议带宽（单镜超 15s 生成慢且易漂）`);
    }
    (s.gridParts ?? []).forEach((p, j) => {
      const len = p.length;
      if (len > 0 && (len < 20 || len > 120)) issues.push(`${tag} 第 ${j + 1} 格 ${len} 字，超出 20-120 字带宽`);
    });
    // 对白预算（drama-skills P0-5）：H3 中文约 4.1 可发声字/秒，首帧模式开口延迟 1.3-2.4s 取 2s 中值
    const dialog = s.dialog ?? '';
    const speakable = dialog.replace(/[，。！？、…—\s,!?."'「」『』：""]+/g, '').length;
    if (speakable > 0 && s.durationSec !== undefined) {
      const capacity = Math.floor((s.durationSec - 2) * 4.1);
      if (capacity > 0 && speakable > capacity) {
        issues.push(`${tag} 台词 ${speakable} 字超出 ${s.durationSec}s 镜头容量（约 ${capacity} 字——开口等待 2s + 4字/秒），会赶词或尾句截断；建议拆镜、加时长或精简台词`);
      } else if (capacity <= 0) {
        issues.push(`${tag} 台词 ${speakable} 字但时长仅 ${s.durationSec}s（开口等待后无发声窗口）——必须加时长或拆镜`);
      }
    }
    if (dialog.trim() && !s.speaker) {
      issues.push(`${tag} 有台词但未标说话人——视频口型/声线绑定需要 speaker，请在镜头卡补填`);
    }
  });
  // 钩子密度自检（B1）：每 3 个连续镜头至少 1 个强钩子（reveal/reversal/callback），首末镜必带
  const STRONG = ['reveal', 'reversal', 'callback'];
  const hooks = shots.map((s) => s.hookType ?? '');
  for (let i = 0; i + 2 < hooks.length; i++) {
    if (!hooks.slice(i, i + 3).some((h) => STRONG.includes(h))) {
      issues.push(`S${shots[i + 2]?.index ?? i + 3} 前 3 镜无强钩子（reveal/reversal/callback）——完播率风险，建议补一个`);
      i += 2;
    }
  }
  if (hooks.length > 1) {
    if (!STRONG.includes(hooks[0]!)) issues.push('首镜未带强钩子——开场留人位，建议 reveal 或 reversal');
    if (!STRONG.includes(hooks.at(-1)!)) issues.push('末镜未带强钩子——建议 callback 回收或悬念钩下集');
  }
  return issues;
}

/** AI 输出的四格描述按 index 对应（parse 内部用） */
function findParts(arr: unknown[], shot: DuanjuShot): string[] {
  const idx = shot.index - 1;
  const raw = arr[idx] as RawShot | undefined;
  return Array.isArray(raw?.gridParts)
    ? raw.gridParts.filter((p): p is string => typeof p === 'string').slice(0, 4)
    : [];
}

// ---------- 四宫格 prompt 组装（D7：一张 2×2 整图） ----------

export function buildGridPrompt(shot: DuanjuShot, gridParts: string[], project: DuanjuProject): string {
  const chars = shot.characterIds
    .map((cid) => project.characters.find((c) => c.id === cid))
    .filter((c): c is DuanjuCharacter => !!c);
  const scene = shot.sceneId ? project.scenes.find((s) => s.id === shot.sceneId) : undefined;
  const parts = gridParts.length > 0 ? gridParts : ['起手动作', '动作进行', '高潮瞬间', '收势定格'];
  return [
    `${stylePrefix(project.style)}，四宫格分镜图（2×2 田字布局，四格之间细白分隔线，每格画同一镜头的连续动作瞬间）`,
    chars.length > 0
      ? `【出场人物】${chars.map((c) => `${c.name}（${c.profile}）`).join('；')}——四格中同一人物形象必须完全一致`
      : '【无人物】纯场景四格',
    scene ? `【场景】${scene.name}（${scene.spec}）` : '',
    `【镜头】景别：${shot.shotSize}；站位：${shot.staging}`,
    `第1格：${parts[0] ?? ''}`,
    `第2格：${parts[1] ?? ''}`,
    `第3格：${parts[2] ?? ''}`,
    `第4格：${parts[3] ?? ''}`,
    '要求：每格只放一个核心动作，动作连贯，画面风格统一；四格机位与取景要有可见变化（轻微推进/视角偏移/景别收紧），不要四格完全同构图；无文字水印',
  ]
    .filter(Boolean)
    .join('\n');
}

// ---------- 分帧 prompt（成本优化：单帧生成/重roll，修一格只花 1 张钱） ----------

const DEFAULT_PARTS = ['起手动作', '动作进行', '高潮瞬间', '收势定格'];

/** 景别 → 构图指令映射：把抽象景别词翻译成模型可执行的画面构成（详细版 prompt 的核心增量） */
const SHOT_COMPOSITION: Record<string, string> = {
  全景: '全身入画，环境占画面主体，人物与空间的位置关系清晰',
  中景: '膝盖以上入画，人物动作与姿态为画面主体，环境作氛围陪衬',
  近景: '胸部以上入画，人物表情与手部细节清晰',
  特写: '面部或关键局部充满画面，情绪与材质细节放大',
};

/**
 * 镜头定妆照路径：出场角色中第一个有主参考图的（与 server 端 subjectRef 逻辑一致）。
 * 有值时该镜头分帧走 Qwen-Image-Edit-2511 参考生图通道（跨帧角色一致）。
 */
export function frameRefImage(shot: DuanjuShot, project: DuanjuProject): string | undefined {
  for (const cid of shot.characterIds) {
    const c = project.characters.find((x) => x.id === cid);
    const img = c?.sheetImages.find((i) => i.id === c.refImageId);
    if (img) return img.path;
  }
  return undefined;
}

/** 镜头场景图路径：关联场景的最新一张图（注入 2511 的 image2——跨帧场景一致）。 */
export function frameSceneImage(shot: DuanjuShot, project: DuanjuProject): string | undefined {
  if (!shot.sceneId) return undefined;
  const scene = project.scenes.find((s) => s.id === shot.sceneId);
  const imgs = scene?.images ?? [];
  return imgs.length > 0 ? imgs[imgs.length - 1].path : undefined;
}

/** 正面全身单图路径（三参考档 image2——锁身体/服装）：归档时 prompt 带【正面全身】前缀标记。 */
export function frameBodyRefImage(shot: DuanjuShot, project: DuanjuProject): string | undefined {
  for (const cid of shot.characterIds) {
    const c = project.characters.find((x) => x.id === cid);
    const img = c?.sheetImages.find((i) => i.prompt.startsWith('【正面全身】'));
    if (img) return img.path;
  }
  return undefined;
}

/** 角色主参考（refImageId 指向的特写单图） */
function charAnchorImage(c: DuanjuCharacter | undefined): string | undefined {
  if (!c) return undefined;
  return c.sheetImages.find((i) => i.id === c.refImageId)?.path;
}

export type FrameRefMode = 'duo' | 'tri' | 'ref';

export interface FrameRefPlan {
  /** image1 恒=主角色（或双人 A）定妆照特写 */
  refImagePath: string;
  /** image2：duo=B 角色特写 / tri=正面全身；ref 无 */
  secondRefPath?: string;
  /** 场景图：duo/tri 占 image3，ref 占 image2 */
  sceneRefPath?: string;
  mode: FrameRefMode;
  duo?: { aName: string; bName: string };
}

/**
 * 帧参考档位统一规划（调用点单点收口——替代散装 helper 组合判断）：
 * 双人（前两个出场角色都有定妆照）> 三参考（单人+有正面全身）> 双参考（单人特写+场景）。
 */
export function planFrameRefs(shot: DuanjuShot, project: DuanjuProject): FrameRefPlan | undefined {
  const chars = shot.characterIds
    .map((cid) => project.characters.find((c) => c.id === cid))
    .filter((c): c is DuanjuCharacter => !!c);
  const sceneRefPath = frameSceneImage(shot, project);
  const [a, b] = chars;
  const aImg = charAnchorImage(a);
  // 双人：两个角色都有主参考特写——同框对话戏双脸锁定
  if (chars.length >= 2 && aImg && charAnchorImage(b)) {
    return {
      refImagePath: aImg,
      secondRefPath: charAnchorImage(b),
      sceneRefPath,
      mode: 'duo',
      duo: { aName: a!.name, bName: b!.name },
    };
  }
  if (aImg) {
    const body = frameBodyRefImage(shot, project);
    return {
      refImagePath: aImg,
      ...(body ? { secondRefPath: body } : {}),
      sceneRefPath,
      mode: body ? 'tri' : 'ref',
    };
  }
  return sceneRefPath ? { refImagePath: '', sceneRefPath, mode: 'ref' } : undefined;
}

/** 角色在指定集生效中的状态清单（P2-11：fromEpisode 缺省=全程；按集过滤注入） */
export function activeStates(
  char: Pick<DuanjuCharacter, 'states'>,
  episodeIndex: number,
): string[] {
  return (char.states ?? [])
    .filter((s) => s.fromEpisode === undefined || s.fromEpisode <= episodeIndex)
    .map((s) => s.note);
}

/** 镜头关联道具的「名（spec）」注入行（P2-12：文字锚点保跨镜道具一致） */
export function propAnchorLine(shot: Pick<DuanjuShot, 'propIds'>, project: DuanjuProject): string {
  const props = (shot.propIds ?? [])
    .map((pid) => project.props?.find((p) => p.id === pid))
    .filter((p): p is NonNullable<typeof p> => !!p);
  if (props.length === 0) return '';
  return `【关键道具】${props.map((p) => `${p.name}（${p.spec}）`).join('；')}——形制颜色材质逐字保持一致，不替换不变形。`;
}

/** 镜头集号（状态过滤用）：episodeId → index，找不到回退 1 */
export function episodeIndexOf(shot: Pick<DuanjuShot, 'episodeId'>, project: DuanjuProject): number {
  return project.episodes.find((e) => e.id === shot.episodeId)?.index ?? 1;
}

/** 单帧生图 prompt v2（2026-11-14 生图对比学习升级）：
 *  普通模式增「未完成瞬间 + 恰好 N 名 + 相邻帧机位微变化 + 光线继承 + 环境动态」；
 *  refMode 改动词式第一句（改图模型只听第一句）+ 逐项保留清单 + 手部细节句（工作流 2026.11.4 实测句式） */
export function buildFramePrompt(
  shot: DuanjuShot,
  frameIndex: number,
  project: DuanjuProject,
  opts: { refMode?: boolean; triRef?: boolean; duoRef?: { aName: string; bName: string } } = {},
): string {
  const chars = shot.characterIds
    .map((cid) => project.characters.find((c) => c.id === cid))
    .filter((c): c is DuanjuCharacter => !!c);
  const locks = chars.map((c) => c.lockPhrase?.trim()).filter((v): v is string => !!v);
  const epIdx = episodeIndexOf(shot, project);
  const stateLine = chars
    .flatMap((c) => activeStates(c, epIdx).map((n) => `${c.name}：${n}`))
    .join('；');
  const propLine = propAnchorLine(shot, project);
  const scene = shot.sceneId ? project.scenes.find((s) => s.id === shot.sceneId) : undefined;
  const parts = shot.gridParts?.length ? shot.gridParts : DEFAULT_PARTS;
  const desc = parts[frameIndex - 1] ?? `第 ${frameIndex} 帧画面`;
  const composition = SHOT_COMPOSITION[shot.shotSize] ?? `${shot.shotSize}景别，人物主体清晰`;
  const exactN = chars.length > 0 ? `画面中恰好出现 ${chars.length} 名角色，每名角色只出现一次。` : '';
  const outfitLine = chars
    .filter((c) => c.currentOutfit)
    .map((c) => `${c.name}身穿${c.currentOutfit}`)
    .join('；');
  const sig = project.visualSignature?.trim() ? `\n${project.visualSignature.trim()}` : '';
  // 参考通道（2511）：第一句=动词式改动指令（构图/场景），保留清单降为分条段。
  // 档位：duoRef 双人（图1=A特写/图2=B特写/图3=场景）；triRef 三参考（图1=特写脸/图2=正面全身/图3=场景）；ref 双参考（图1=特写/图2=场景）
  if (opts.refMode) {
    const duo = opts.duoRef;
    const bodyImg = '图2';
    const sceneImg = opts.triRef || duo ? '图3' : '图2';
    return [
      chars.length > 0
        ? duo
          ? `把图1的${duo.aName}与图2的${duo.bName}（各自的脸部特写）放进${sceneImg}的场景里，两人同框互动，按新机位重新取景构图，生成一张全新的画面：`
          : opts.triRef
            ? `把图1（脸部特写）与${bodyImg}（正面全身）中的${chars.map((c) => c.name).join('、')}放进${sceneImg}的场景里，按新机位重新取景构图，生成一张全新的画面：`
            : `把图1中的${chars.map((c) => c.name).join('、')}放进图2的场景里，按新机位重新取景构图，生成一张全新的画面：`
        : `参照${sceneImg}的场景环境重新构图，生成一张全新的画面：`,
      `【画面内容】${desc}——只画这一个动作瞬间。`,
      chars.length > 0
        ? duo
          ? `【人物保持】${duo.aName}的长相五官与发型严格依图1、${duo.bName}的长相五官与发型严格依图2，两人的体型服装与身姿完全一致，一项都不改。${exactN}${outfitLine ? `\n【服装】${outfitLine}` : ''}`
          : `【人物保持】${chars.map((c) => c.name).join('、')}的长相五官与发型${opts.triRef ? '（严格依图1）' : ''}、体型服装与身姿${opts.triRef ? `（严格依${bodyImg}）` : ''}完全一致，一项都不改。${exactN}${outfitLine ? `\n【服装】${outfitLine}` : ''}`
        : '',
      '【手部细节】若画面含手部：双手与手指结构自然完整，袖口与手腕自然衔接。',
      propLine,
      locks.length > 0 ? `【连续性锁】${locks.join('; ')} —— 逐字保持，一项不改` : '',
      shot.onScreenText?.trim() ? `【画内文字】画面中逐字显示：「${shot.onScreenText.trim()}」——文字清晰可读、无错字、无多余文字` : '',
      stateLine ? `【当前状态】${stateLine}` : '',
      scene ? `【场景保持】空间布局、主光方向与色温、关键道具及其位置与${sceneImg}保持一致。` : '',
      `【机位指令】${composition}——不沿用参考图的取景角度。`,
      `${stylePrefix(project.style)}，${shot.staging}。画质要求：细节丰富，光影真实。`,
    ]
      .filter(Boolean)
      .join('\n') + sig;
  }
  const charsLine = chars.length > 0
    ? `【出场人物】${chars.map((c) => `${c.name}（${c.profile}${c.currentOutfit ? `，身穿${c.currentOutfit}` : ''}）`).join('；')}——与同镜头其他帧同一人物形象完全一致。${exactN}`
    : '【无人物】纯场景帧';
  return [
    `${stylePrefix(project.style)}，电影感单帧分镜图（同一镜头连续动作第 ${frameIndex}/4 帧）`,
    `【画面主体】${desc}——只画这一个动作瞬间，画面停在「下一秒即将发生变化」的时刻，不画成动作已完全结束的定格${/转身|回身|转过头|出画/.test(desc) ? '；若动作为转身/出画，画转身进行到一半的侧身姿态（不画转身完成后的背面）' : ''}`,
    charsLine,
    stateLine ? `【当前状态】${stateLine}` : '',
    scene ? `【场景与光线】${scene.name}（${scene.spec}）——按场景的光影基调与时间氛围渲染，人物与环境光交互自然` : '',
    `【镜头语言】${composition}（${shot.shotSize}）；人物位置：${shot.staging}；本帧机位相对相邻帧轻微变化（推进/偏移/景别收紧），相邻两帧不得完全同构图`,
    locks.length > 0 ? `【连续性锁】${locks.join('; ')} —— 逐字保持，一项不改` : '',
    shot.onScreenText?.trim() ? `【画内文字】画面中${/手机|屏幕|聊天|短信/.test(shot.onScreenText) ? '的手机/电子屏幕' : '的实体表面'}逐字显示：「${shot.onScreenText.trim()}」——文字清晰可读、无错字、无多余文字` : '',
    '【环境动态】把场景中 1-2 个自然运动元素画进画面：风吹发丝与衣摆、水面波纹、雾气流动、光斑变化、雨丝、蒸汽。',
    propLine,
    '【光线继承】主光方向、色温、明暗对比与同镜头其他帧保持一致。',
    '画质要求：细节丰富，光影真实，构图稳定横平竖直。',
  ]
    .filter(Boolean)
    .join('\n') + sig;
}
