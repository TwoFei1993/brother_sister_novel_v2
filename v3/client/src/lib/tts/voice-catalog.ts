/**
 * TTS 音色目录（纯数据表 + 分配器，自 voice-route 拆出——路由逻辑与声库分离）：
 *
 * - VOICES：Edge 免费声全量（普通话 12 + 粤语 3 + 台湾国语 3）
 * - MINIMAX_VOICES：MiniMax 系统音色全量（speech-2.8-hd 官方目录实测有效）
 * - autoCastVoices：按名字性别线索自动分声（联测需求）
 *
 * 经 voice-route.ts `export *` 转出口——既有 import 路径不变。
 */

/** 可用声音（Edge 免费声全量目录：普通话 12 + 粤语 3 + 台湾国语 3） */
export interface VoiceOption {
  id: string;
  name: string;
  /** easyvoice 底层声音名（POST /generate body.voice） */
  voice: string;
  gender: 'female' | 'male';
}

export const VOICES: readonly VoiceOption[] = [
  // 普通话
  { id: 'xiaoxiao', name: '晓晓', voice: 'zh-CN-XiaoxiaoNeural', gender: 'female' },
  { id: 'xiaoyi', name: '小艺', voice: 'zh-CN-XiaoyiNeural', gender: 'female' },
  { id: 'yunxia', name: '云夏', voice: 'zh-CN-YunxiaNeural', gender: 'female' },
  { id: 'xiaobei', name: '小贝', voice: 'zh-CN-liaoning-XiaobeiNeural', gender: 'female' },
  { id: 'xiaoni', name: '小妮', voice: 'zh-CN-shaanxi-XiaoniNeural', gender: 'female' },
  { id: 'yunxi', name: '云希', voice: 'zh-CN-YunxiNeural', gender: 'male' },
  { id: 'yunjian', name: '云健', voice: 'zh-CN-YunjianNeural', gender: 'male' },
  { id: 'yunyang', name: '云扬', voice: 'zh-CN-YunyangNeural', gender: 'male' },
  { id: 'yunze', name: '云泽', voice: 'zh-CN-YunzeNeural', gender: 'male' },
  { id: 'yunfeng', name: '云枫', voice: 'zh-CN-YunfengNeural', gender: 'male' },
  { id: 'yunhao', name: '云皓', voice: 'zh-CN-YunhaoNeural', gender: 'male' },
  { id: 'yunye', name: '云野', voice: 'zh-CN-YunyeNeural', gender: 'male' },
  // 粤语
  { id: 'hiumaan', name: '曉曼', voice: 'zh-HK-HiuMaanNeural', gender: 'female' },
  { id: 'hiugaai', name: '曉佳', voice: 'zh-HK-HiuGaaiNeural', gender: 'female' },
  { id: 'wanlung', name: '雲龍', voice: 'zh-HK-WanLungNeural', gender: 'male' },
  // 台湾国语
  { id: 'hsiaochen', name: '晓臻', voice: 'zh-TW-HsiaoChenNeural', gender: 'female' },
  { id: 'hsiaoyu', name: '晓雨', voice: 'zh-TW-HsiaoYuNeural', gender: 'female' },
  { id: 'yunhui', name: '雲慧', voice: 'zh-TW-YunHuiNeural', gender: 'male' },
];

/** 旁白默认声 id */
export const DEFAULT_VOICE_ID = 'xiaoxiao';

// ---------- MiniMax 音色目录 + 自动分声（安卓 app，speech-2.8-hd） ----------

/** TTS 引擎标记：easyvoice（Edge 音色）/ minimax（speech-2.8，走 /api/tts/minimax 服务端转发） */
export type VoiceEngine = 'easyvoice' | 'minimax';

const MM_PREFIX = 'mm:';

export interface MiniMaxVoiceOption {
  /** 存 voiceMap/speakers 用的 id（带 mm: 前缀） */
  id: string;
  name: string;
  /** MiniMax voice_setting.voice_id */
  voice: string;
  gender: 'female' | 'male';
  /** 适配方向：哥哥/妹妹/旁白候选 */
  fit: string;
}

/** MiniMax 系统音色全量目录（官方目录 + 全量实测有效；旁白默认主持人女）*/
export const MINIMAX_VOICES: readonly MiniMaxVoiceOption[] = [
  { id: 'mm:male-qn-qingse', name: '青涩青年', voice: 'male-qn-qingse', gender: 'male', fit: '角色' },
  { id: 'mm:male-qn-badao', name: '霸道青年', voice: 'male-qn-badao', gender: 'male', fit: '角色' },
  { id: 'mm:male-qn-jingying', name: '精英青年', voice: 'male-qn-jingying', gender: 'male', fit: '角色' },
  { id: 'mm:male-qn-daxuesheng', name: '青年大学生', voice: 'male-qn-daxuesheng', gender: 'male', fit: '角色' },
  { id: 'mm:female-shaonv', name: '少女', voice: 'female-shaonv', gender: 'female', fit: '角色' },
  { id: 'mm:female-yujie', name: '御姐', voice: 'female-yujie', gender: 'female', fit: '角色' },
  { id: 'mm:female-chengshu', name: '成熟女性', voice: 'female-chengshu', gender: 'female', fit: '角色' },
  { id: 'mm:female-tianmei', name: '甜美女性', voice: 'female-tianmei', gender: 'female', fit: '角色' },
  { id: 'mm:bingjiao_didi', name: '病娇弟弟', voice: 'bingjiao_didi', gender: 'male', fit: '角色' },
  { id: 'mm:junlang_nanyou', name: '俊朗男友', voice: 'junlang_nanyou', gender: 'male', fit: '角色' },
  { id: 'mm:chunzhen_xuedi', name: '纯真学弟', voice: 'chunzhen_xuedi', gender: 'male', fit: '角色' },
  { id: 'mm:lengdan_xiongzhang', name: '冷淡学长', voice: 'lengdan_xiongzhang', gender: 'male', fit: '角色' },
  { id: 'mm:badao_shaoye', name: '霸道少爷', voice: 'badao_shaoye', gender: 'male', fit: '角色' },
  { id: 'mm:diadia_xuemei', name: '嗲嗲学妹', voice: 'diadia_xuemei', gender: 'female', fit: '角色' },
  { id: 'mm:danya_xuejie', name: '淡雅学姐', voice: 'danya_xuejie', gender: 'female', fit: '角色' },
  { id: 'mm:tianxin_xiaoling', name: '甜心小玲', voice: 'tianxin_xiaoling', gender: 'female', fit: '角色' },
  { id: 'mm:qiaopi_mengmei', name: '俏皮萌妹', voice: 'qiaopi_mengmei', gender: 'female', fit: '角色' },
  { id: 'mm:wumei_yujie', name: '妩媚御姐', voice: 'wumei_yujie', gender: 'female', fit: '角色' },
  { id: 'mm:Arrogant_Miss', name: '嚣张小姐', voice: 'Arrogant_Miss', gender: 'female', fit: '角色' },
  { id: 'mm:Robot_Armor', name: '机械战甲', voice: 'Robot_Armor', gender: 'male', fit: '角色' },
  { id: 'mm:Chinese (Mandarin)_Mature_Woman', name: '傲娇御姐', voice: 'Chinese (Mandarin)_Mature_Woman', gender: 'female', fit: '角色' },
  { id: 'mm:Chinese (Mandarin)_Straightforward_Boy', name: '率真弟弟', voice: 'Chinese (Mandarin)_Straightforward_Boy', gender: 'male', fit: '角色' },
  { id: 'mm:Chinese (Mandarin)_Crisp_Girl', name: '清脆少女', voice: 'Chinese (Mandarin)_Crisp_Girl', gender: 'female', fit: '角色' },
  { id: 'mm:Chinese (Mandarin)_Stubborn_Friend', name: '嘴硬竹马', voice: 'Chinese (Mandarin)_Stubborn_Friend', gender: 'male', fit: '角色' },
  { id: 'mm:Chinese (Mandarin)_Pure-hearted_Boy', name: '清澈邻家弟弟', voice: 'Chinese (Mandarin)_Pure-hearted_Boy', gender: 'male', fit: '角色' },
  { id: 'mm:Chinese (Mandarin)_Soft_Girl', name: '柔和少女', voice: 'Chinese (Mandarin)_Soft_Girl', gender: 'female', fit: '角色' },
  { id: 'mm:Chinese (Mandarin)_Warm_Girl', name: '温暖少女', voice: 'Chinese (Mandarin)_Warm_Girl', gender: 'female', fit: '角色' },
  { id: 'mm:Chinese (Mandarin)_Warm_Bestie', name: '温暖闺蜜', voice: 'Chinese (Mandarin)_Warm_Bestie', gender: 'female', fit: '角色' },
  { id: 'mm:Chinese (Mandarin)_Sincere_Adult', name: '真诚青年', voice: 'Chinese (Mandarin)_Sincere_Adult', gender: 'male', fit: '角色' },
  { id: 'mm:Chinese (Mandarin)_Gentle_Senior', name: '温柔学姐', voice: 'Chinese (Mandarin)_Gentle_Senior', gender: 'female', fit: '角色' },
  { id: 'mm:Chinese (Mandarin)_Wise_Women', name: '阅历姐姐', voice: 'Chinese (Mandarin)_Wise_Women', gender: 'female', fit: '角色' },
  { id: 'mm:Chinese (Mandarin)_Reliable_Executive', name: '沉稳高管', voice: 'Chinese (Mandarin)_Reliable_Executive', gender: 'male', fit: '角色' },
  { id: 'mm:Chinese (Mandarin)_Kind-hearted_Antie', name: '热心大婶', voice: 'Chinese (Mandarin)_Kind-hearted_Antie', gender: 'female', fit: '角色' },
  { id: 'mm:Chinese (Mandarin)_Kind-hearted_Elder', name: '花甲奶奶', voice: 'Chinese (Mandarin)_Kind-hearted_Elder', gender: 'female', fit: '角色' },
  { id: 'mm:Chinese (Mandarin)_Humorous_Elder', name: '搞笑大爷', voice: 'Chinese (Mandarin)_Humorous_Elder', gender: 'male', fit: '角色' },
  { id: 'mm:Chinese (Mandarin)_Southern_Young_Man', name: '南方小哥', voice: 'Chinese (Mandarin)_Southern_Young_Man', gender: 'male', fit: '角色' },
  { id: 'mm:Chinese (Mandarin)_HK_Flight_Attendant', name: '港普空姐', voice: 'Chinese (Mandarin)_HK_Flight_Attendant', gender: 'female', fit: '角色' },
  { id: 'mm:Chinese (Mandarin)_Unrestrained_Young_Man', name: '不羁青年', voice: 'Chinese (Mandarin)_Unrestrained_Young_Man', gender: 'male', fit: '角色' },
  { id: 'mm:clever_boy', name: '聪明男童', voice: 'clever_boy', gender: 'male', fit: '角色' },
  { id: 'mm:cute_boy', name: '可爱男童', voice: 'cute_boy', gender: 'male', fit: '角色' },
  { id: 'mm:lovely_girl', name: '萌萌女童', voice: 'lovely_girl', gender: 'female', fit: '角色' },
  { id: 'mm:cartoon_pig', name: '卡通猪小琪', voice: 'cartoon_pig', gender: 'female', fit: '角色' },
  { id: 'mm:Chinese (Mandarin)_Cute_Spirit', name: '憨憨萌兽', voice: 'Chinese (Mandarin)_Cute_Spirit', gender: 'male', fit: '角色' },
  { id: 'mm:presenter_female', name: '主持人女', voice: 'presenter_female', gender: 'female', fit: '旁白' },
  { id: 'mm:presenter_male', name: '主持人男', voice: 'presenter_male', gender: 'male', fit: '旁白' },
  { id: 'mm:audiobook_female_1', name: '有声书女声', voice: 'audiobook_female_1', gender: 'female', fit: '旁白' },
  { id: 'mm:audiobook_male_1', name: '有声书男声', voice: 'audiobook_male_1', gender: 'male', fit: '旁白' },
  { id: 'mm:Chinese (Mandarin)_News_Anchor', name: '新闻女声', voice: 'Chinese (Mandarin)_News_Anchor', gender: 'female', fit: '旁白' },
  { id: 'mm:Chinese (Mandarin)_Male_Announcer', name: '播报男声', voice: 'Chinese (Mandarin)_Male_Announcer', gender: 'male', fit: '旁白' },
  { id: 'mm:Chinese (Mandarin)_Radio_Host', name: '电台男主播', voice: 'Chinese (Mandarin)_Radio_Host', gender: 'male', fit: '旁白' },
  { id: 'mm:Chinese (Mandarin)_Gentleman', name: '温润男声', voice: 'Chinese (Mandarin)_Gentleman', gender: 'male', fit: '旁白' },
  { id: 'mm:Chinese (Mandarin)_Gentle_Youth', name: '温润青年', voice: 'Chinese (Mandarin)_Gentle_Youth', gender: 'male', fit: '旁白' },
  { id: 'mm:Chinese (Mandarin)_Lyrical_Voice', name: '抒情男声', voice: 'Chinese (Mandarin)_Lyrical_Voice', gender: 'male', fit: '旁白' },
  { id: 'mm:Chinese (Mandarin)_Sweet_Lady', name: '甜美女声', voice: 'Chinese (Mandarin)_Sweet_Lady', gender: 'female', fit: '旁白' },
  { id: 'mm:Cantonese_ProfessionalHost（F)', name: '粤语专业女主持', voice: 'Cantonese_ProfessionalHost（F)', gender: 'female', fit: '粤语' },
  { id: 'mm:Cantonese_ProfessionalHost（M)', name: '粤语专业男主持', voice: 'Cantonese_ProfessionalHost（M)', gender: 'male', fit: '粤语' },
  { id: 'mm:Cantonese_GentleLady', name: '粤语温柔女声', voice: 'Cantonese_GentleLady', gender: 'female', fit: '粤语' },
  { id: 'mm:Cantonese_PlayfulMan', name: '粤语活泼男声', voice: 'Cantonese_PlayfulMan', gender: 'male', fit: '粤语' },
  { id: 'mm:Cantonese_CuteGirl', name: '粤语可爱女孩', voice: 'Cantonese_CuteGirl', gender: 'female', fit: '粤语' },
  { id: 'mm:Cantonese_KindWoman', name: '粤语善良女声', voice: 'Cantonese_KindWoman', gender: 'female', fit: '粤语' },
];

/** 声音 id 是否为 MiniMax 音色 */
export function isMinimaxVoice(id: string): boolean {
  return id.startsWith(MM_PREFIX);
}

/** 声音 id → MiniMax voice_id（非 MiniMax 音色返回 null） */
export function minimaxVoiceOf(id: string): string | null {
  if (!isMinimaxVoice(id)) return null;
  return id.slice(MM_PREFIX.length);
}

const FEMALE_HINTS = ['妹', '姐', '娘', '女', '婉', '月', '雪', '莹', '霞', '妃', '后', '嫔', '嬷', '嫂', '姨', '姬', '妲', '鸾'];
const MALE_HINTS = ['哥', '兄', '爷', '王', '帝', '君', '叔', '爸', '爹', '公', '侯', '帅', '郎', '殿下'];

/** 按名字性别线索猜池（先男表后女表；都未命中默认女池——人名用字女性偏多） */
function guessPool(name: string): 'male' | 'female' {
  for (const h of MALE_HINTS) if (name.includes(h)) return 'male';
  for (const h of FEMALE_HINTS) if (name.includes(h)) return 'female';
  return 'female';
}

/**
 * 自动分声（联测需求）：按出场角色名自动分配 MiniMax 音色——
 * 名字性别线索决定池（男池/女池），池内按出现顺序轮替（同池不重声）；
 * 旁白固定主持人声。返回可直接存 voiceMap 的绑定表。
 */
export function autoCastVoices(names: readonly string[]): Array<{ name: string; voice: string }> {
  const male = MINIMAX_VOICES.filter((v) => v.gender === 'male');
  const female = MINIMAX_VOICES.filter((v) => v.gender === 'female');
  const maleCount = { n: 0 };
  const femaleCount = { n: 0 };
  return names.map((name) => {
    const isMale = guessPool(name) === 'male';
    const pool = isMale ? male : female;
    const voice = pool[Math.min(isMale ? maleCount.n : femaleCount.n, pool.length - 1)] ?? pool[0];
    if (isMale) maleCount.n += 1;
    else femaleCount.n += 1;
    return { name, voice: MM_PREFIX + voice.voice };
  });
}

/** 旁白声（自动分声场景固定主持人女） */
export const AUTOCAST_NARRATOR_VOICE = 'mm:presenter_female';
