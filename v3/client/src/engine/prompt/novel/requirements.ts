/**
 * novel 模式写作要求注入（用户需求：每章字数可控 + 输出纪律 + 基调文风执行 + 视角节奏）
 *
 * - buildNovelMainPrompt：兜底主提示词（无预设时），字数读作品设置（原硬编码 1500 已废弃）
 * - buildChapterRequirement：末尾写作要求块——随「剧情指引」合并注入 messages 最末位的
 *   user 消息（最强注意力位置），**不依赖用户预设**（绑定了预设也能生效）；可选注入
 *   基调/文风执行块（用户反馈①：指定「治愈」却写出压抑感——基调不能只是一行设定，
 *   要给出写法级执行指令，并声明基调优先级高于悬念纪律）
 * - buildContinueRequirement：续写轮专用要求块（用户反馈③：截断续写时模型受
 *   「第一行输出章标题」类指令驱使重新开章——续写轮改为「无缝续写」纪律）
 * - VIEW_RHYTHM：叙事视角与句段节奏纪律（用户反馈④：第三人称贴主角视角，
 *   按「他人说话/动作 → 主角所见所想 → 主角接话行动 → 又看到新细节 → 心理」交替推进）
 */
import type { TavernPrompt } from '@shared/tavern';

/** 基调/文风执行位（scanAndAssemble 从 NovelSettings 解析后传入） */
export interface StyleBits {
  /** 基调列表（内置枚举 + 自定义基调已合并） */
  tones: readonly string[];
  /** 文风描述（已解析为中文；空串=未指定） */
  style: string;
}

/**
 * 分段生成信息（用户需求：长章分段输出防丢失、单段 20 分钟太长）：
 * 目标字数 > SEGMENT_WORDS 时一章拆 ceil(targetWords/SEGMENT_WORDS) 段生成自动拼接。
 */
export interface SegmentInfo {
  /** 当前段（1 起） */
  part: number;
  /** 总段数 */
  parts: number;
  /** 本段目标字数 */
  words: number;
}

/** 内置基调 → 写法级执行指令（用户反馈①：只写一行「基调：XX」无效，须给可执行的叙事质感指令） */
const TONE_GUIDE: Record<string, string> = {
  温情治愈:
    '整体温暖治愈：以日常细节与人物间的善意互动承载剧情；矛盾小而可解，并在本章内化解或明显缓和；' +
    '情绪曲线整体向上，章末落点温暖、有余韵或期待感；钩子用「期待感」而非「危机感」；' +
    '禁止渲染压抑、绝望、阴郁氛围，禁止为制造冲突让人物无理由互伤',
  热血爽文:
    '基调热血爽利：主角主动出击，压力在本章内转化为反击与突破；爽点要落地（实力/地位/认可的可感提升），章末钩子指向下一场冲突或更大收获',
  虐中带甜:
    '基调虐中带甜：误会与摩擦可以戳人，但同章必须给出温度落点（一个安抚的动作、一句真心话）；虐是手段、甜是归处，不在章末停在纯虐情绪',
  深度烧脑:
    '基调冷静克制：信息分批释放，伏笔与线索精确呼应；悬念靠信息差而非巧合；章末抛出新的谜面',
  恐怖压抑:
    '基调悬疑压迫：环境描写收紧，未知威胁逐步逼近；用感官细节制造不安；章末威胁升级',
  权谋博弈:
    '基调权谋博弈：多方立场与算计分明，每步棋有目的与代价；对话藏锋，信息即武器；章末局面翻转或新局展开',
};

/**
 * 基调与文风执行块（置于要求块最前，最高优先级）：内置基调给写法级指令，自定义基调
 * 透传并要求执行；末行声明基调高于本块其他纪律（悬念/冲突纪律与治愈类基调冲突时按基调执行）。
 * 无任何基调与文风 → 空串（不注入，保持旧行为）。
 */
export function buildStyleExecution(bits: StyleBits): string {
  const lines: string[] = [];
  for (const tone of bits.tones) {
    const guide = TONE_GUIDE[tone] ?? '本章所有场景、对话与心理描写的情绪质感必须全程服从该基调';
    lines.push(`- 基调「${tone}」：${guide}`);
  }
  if (bits.style.trim()) lines.push(`- 文风「${bits.style.trim()}」：叙事语言质感全程贴合该文风`);
  if (lines.length === 0) return '';
  return (
    '【基调与文风（最高优先级）】\n' +
    lines.join('\n') +
    '\n- 本节优先级高于下方其他写作纪律：悬念、冲突等要求与基调冲突时，以基调规定的方式执行'
  );
}

/** 叙事视角与句段节奏纪律（用户反馈④；主提示词与要求块共用，要求块内为紧凑版） */
export const VIEW_RHYTHM_LINE =
  '- 叙事视角与节奏（重要）：第三人称限制视角，镜头跟随主角——只写主角能看到、听到、感知到的信息，不做全知旁白；' +
  '按「他人说话或动作 → 主角看到/听到什么、心里想什么 → 主角接话或行动 → 主角又注意到新细节（对方的表情动作、身边的物件）→ 主角的心理」的节奏交替推进；' +
  '对话不宜连续超过三句，中间用主角的观察或心理隔开；禁止大段无视角锚定的裸对话或环境旁白';

/** novel 兜底主提示词：无预设时让模型以小说作家身份按章续写（质量测试 T5 教训：无主提示词会退化成通用助手）
 *  反退化纪律对照酒馆社区 anti-slop 实践（autonovel ANTI-SLOP / r/SillyTavernAI）：句长要有变化、
 *  开头句式不得跨章复用、具体性是 slop 的解药（Human writing surprises）——均针对本项目实测退化形态 */
export function buildNovelMainPrompt(targetWords: number): TavernPrompt {
  return {
    identifier: 'main',
    name: '内置作家主提示词',
    role: 'system',
    system_prompt: true,
    content:
      '你是一位资深中文小说作家。请根据上方的全部设定与剧情指引，续写下一章正文：\n' +
      '- 以小说笔法叙事，融合场景、动作、对话与心理描写，人物性格与关系保持前后一致\n' +
      '- 情节必须承接聊天历史中的前文，不得另起炉灶\n' +
      `- 每章正文 ${targetWords}-${targetWords + 1500} 字\n` +
      '- 正文第一行必须是本章标题（Markdown 一级标题，格式：`# 第N章 标题`），标题行之后直接写正文\n' +
      '- 除首行标题外，不要输出编号、总结、写作说明或任何与正文无关的元信息\n' +
      '- 绝不以 AI、助手、模型身份说话\n' +
      VIEW_RHYTHM_LINE + '\n' +
      '- 反套路纪律：同一个比喻/意象全章最多用一次；各章开头不得使用相同句式；' +
      '句式长短交错（连续三句长句后必须接短句）；每段都要推进剧情，禁止用重复的环境描写填充篇幅；' +
      '要写出令人意外的具体细节，而不是笼统的氛围渲染',
  };
}

/** 末尾写作要求块：基调文风执行（可选）+ 首行章标题 + 字数下限 + 输出纪律 + 反退化纪律
 *  （泄露形态对照实测：对 System 寒暄 / 确认语 / 思考流 / 选项；退化形态对照深度测试：短语重复循环 / 开头句式跨章复用。
 *  首行标题为用户反馈⑧：正文开头即章节名，ReadingView 经 parseChapterTitle 剥离后仍以标题 heading 展示。
 *  segment（用户需求：长章分段生成）：非空时字数行/章末纪律按「第 part/共 parts 段」改写——
 *  非末段写满段字数在段落末尾自然停笔（系统自动续写），末段才收束本章留悬念 */
export function buildChapterRequirement(
  targetWords: number,
  progress?: { chapter: number; total: number },
  styleBits?: StyleBits,
  segment?: SegmentInfo,
): string {
  // 全书创作目标（借鉴成熟写作软件：目标章数驱动节奏）——接近尾声时提示收束伏笔，
  // 超出目标不再硬刹车（作者加章是常态，只提示不强制）
  const goal =
    progress && progress.total > 0
      ? progress.chapter >= Math.ceil(progress.total * 0.85)
        ? `\n- 全书节奏：本书规划约 ${progress.total} 章，当前第 ${progress.chapter} 章已进入尾声阶段——本章与后续章节注意逐步回收已埋伏笔、收敛支线，向结局推进（不强行完结，自然收束）\n`
        : `\n- 全书节奏：本书规划约 ${progress.total} 章，当前写至第 ${progress.chapter} 章——本章按正常节奏推进主线，可在合适处埋设后续章节的伏笔\n`
      : '';
  const styleHead = styleBits ? buildStyleExecution(styleBits) : '';
  // 分段模式：字数行与章末纪律按段改写（用户需求：单段太长 → 主动分段，段间自动续写拼接）；
  // 首段必须先完成交代（用户实测：分段首段直切场景导致整章缺人物/背景铺垫）
  const segmentExplain =
    segment && segment.part === 1 && segment.parts > 1
      ? '- 分段首段纪律：本段先完成本章的场景、人物与当前处境的交代（谁、在哪、为何在此），再推进主线剧情——禁止一上来就直切冲突细节\n'
      : '';
  const wordLine = segment
    ? `- 分段生成：本章由系统分 ${segment.parts} 段自动拼接，本段为第 ${segment.part}/${segment.parts} 段——本段写约 ${segment.words} 字，写满后在**最近的段落末尾**自然停笔；${
        segment.part < segment.parts
          ? '本段不是最后一段：不要收尾、不要结局感，剧情停在推进中（后续由系统自动续写）'
          : '本段是最后一段：写完剩余剧情后自然收束本章'
      }\n`
    : `- 本章正文 ${targetWords}-${targetWords + 1500} 字（不含标题与任何元信息），写到 ${targetWords + 1500} 字左右即收尾成章，禁止提前收束，也禁止为凑字数拖沓注水\n`;
  const chapterEndDiscipline = segment
    ? segment.part < segment.parts
      ? '  ③本段结尾停在场景推进中即可，不需要章末悬念钩子（后续段由系统自动续写拼接）\n'
      : '  ③本段是本章收尾：章末必须留至少一个未解决的悬念、新麻烦或未完成的行动，驱动读者进入下一章\n'
    : '  ③章末必须留至少一个未解决的悬念、新麻烦或未完成的行动，驱动读者进入下一章\n';
  return (
    (styleHead ? `${styleHead}\n` : '') +
    '【本章写作要求】\n' +
    '- 正文第一行先输出本章标题（格式：`# 第N章 标题` 一行），紧接正文；除此之外不要输出其他标题或元信息\n' +
    wordLine +
    '- 直接输出正文：禁止与 System/系统/用户对话或寒暄，禁止确认语（如「收到」「可以开始吗」）、' +
    '禁止输出思考过程、写作提纲、选项列表\n' +
    '- 禁止复述本要求或剧情指令原文\n' +
    segmentExplain +
    VIEW_RHYTHM_LINE + '\n' +
    '- 长篇连载纪律（最重要）：本书是连载长篇，每一章只是全书的一段，不是独立小故事——\n' +
    '  ①开篇必须自然承接上一章结尾的场景、悬念或未解决事件（人物状态/时间线/地点与前章连续，读者连读各章必须顺畅）；\n' +
    '  ②禁止在本章内把主线冲突完全解决或写出大结局式收尾——上一章埋的线本章只推进不一步了结；\n' +
    chapterEndDiscipline +
    '- 反重复纪律：每写一段剧情必须向前推进，禁止用重复的描写、比喻或句式填充字数；' +
    '同一短语若已写过两次，绝对不要写第三次\n' +
    '- 语言纯度：全文使用简体中文，禁止出现任何英文单词、字母或拼音（真实品牌/单位等必要专有名词除外）\n' +
    '- 对话说话人锚定：每句对话必须让读者分清是谁在说——优先用动作/神态引导' +
    '（如「苏檀皱眉：」「他放下杯子，」），长对话轮替时至少每三句锚定一次说话人；' +
    '禁止连续多句无主的裸对话' +
    goal
  );
}

/**
 * 续写轮专用要求块（用户反馈③）：截断续写/断流恢复时，本章已写了一半——
 * 常规要求块的「第一行输出章标题」在续写轮等于命令模型重新开章（实测形态：
 * 已写半章 + 模型重新输出标题从开头另写，拼接后一章两个开头）。续写轮整体替换为：
 * 从已写正文结尾无缝续写，禁止任何形式的重新开始。
 * remaining（可选）：本章还需补写的字数——传入时字数行按「补完剩余后收束（本章总计
 * 约 targetWords）」改写（用户实测：续写轮再写满额字数导致章节越来越长的直接根因）。
 */
export function buildContinueRequirement(targetWords: number, final = true, remaining?: number): string {
  const stopLine = final
    ? remaining !== undefined
      ? `- 直接从剧情的当前时刻继续推进，补写约 ${remaining} 字后自然收束本章（含前面已写部分，本章总计约 ${targetWords} 字；章末留一个未解决的悬念或未完成的行动，驱动读者进入下一章）\n`
      : `- 直接从剧情的当前时刻继续推进，写约 ${targetWords}-${targetWords + 1500} 字后自然收束本章（章末留一个未解决的悬念或未完成的行动，驱动读者进入下一章）\n`
    : `- 直接从剧情的当前时刻继续推进，本段写约 ${targetWords} 字——写满后在**最近的段落末尾**自然停笔（本章由系统分段拼接，后续还会继续写；不要收尾、不要结局感）\n`;
  return (
    '【续写要求（本章已写了一半）】\n' +
    '- 上下文最后一条「小说家」消息就是本章已写正文——从它的结尾无缝接着往下写，当作这段文字是你自己刚写出的\n' +
    '- 严格禁止：重新开始本章、另写新开头、输出章节标题（# 第N章 之类）、重写或复述已写内容、总结前文\n' +
    stopLine +
    '- 直接输出续写正文：禁止与 System/系统/用户对话或寒暄，禁止确认语、思考过程、写作提纲、选项列表；禁止复述本要求\n' +
    VIEW_RHYTHM_LINE + '\n' +
    '- 语言纯度：全文使用简体中文，禁止出现任何英文单词、字母或拼音（真实品牌/单位等必要专有名词除外）'
  );
}

/** 分段生成的段字数（用户需求：单段 20 分钟太长 → 长章按此粒度拆分，段间自动续写拼接） */
export const SEGMENT_WORDS = 2500;

/**
 * 扩写本章要求块（用户需求：允许对当前章要求「加长」）：把当前版本扩写成更长的完整章——
 * 情节/对话/事实保持不变，把关键场景写细写透；输出整章（带标题行，postprocess 剥离）。
 * 与「续写本章」（append 新剧情）互补：加长是原地加厚，续写是向后延展。
 */
export function buildExpandRequirement(targetWords: number): string {
  return (
    '【扩写要求（本章加长）】\n' +
    '- 上下文最后一条「小说家」消息是本章当前版本——把它扩写成更长的完整章节\n' +
    '- 保持情节、对话内容、人物关系与事实完全不变，禁止新增改变走向的情节；把关键场景写细写透：' +
    '补充动作细节、环境感知、主角的观察与心理（贴主角视角），对话间的神态与反应\n' +
    `- 扩写后全文约 ${targetWords}-${targetWords + 2000} 字；不要为凑字数注水，也不要删减原有情节要素\n` +
    '- 第一行先输出本章标题（格式：`# 第N章 标题`，与原文一致），紧接扩写后的完整正文\n' +
    '- 直接输出扩写正文：禁止与 System/系统/用户对话或寒暄，禁止确认语、思考过程、写作提纲、选项列表；禁止复述本要求\n' +
    VIEW_RHYTHM_LINE + '\n' +
    '- 语言纯度：全文使用简体中文，禁止出现任何英文单词、字母或拼音（真实品牌/单位等必要专有名词除外）'
  );
}

/** 尾部要求选择（scanAndAssemble 消费的纯函数，便于单测）：续写 > 扩写 > 常规（分段信息改变字数行/停笔纪律） */
export function pickChapterRequirement(opts: {
  continuation?: boolean;
  expandChapter?: boolean;
  segment?: SegmentInfo;
  /** 续写轮剩余字数（target − 已有；传入时字数行按「补完剩余后收束」改写，防章节膨胀） */
  continueRemaining?: number;
  targetWords: number;
  progress?: { chapter: number; total: number };
  styleBits?: StyleBits;
}): string {
  if (opts.continuation) {
    const seg = opts.segment;
    return buildContinueRequirement(
      seg ? seg.words : opts.targetWords,
      seg ? seg.part >= seg.parts : true,
      seg ? undefined : opts.continueRemaining,
    );
  }
  if (opts.expandChapter) return buildExpandRequirement(opts.targetWords);
  return buildChapterRequirement(opts.targetWords, opts.progress, opts.styleBits, opts.segment);
}
