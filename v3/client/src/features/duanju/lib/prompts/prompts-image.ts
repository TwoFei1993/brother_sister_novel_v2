/**
 * 短剧生图 prompt 模板（共识 D6-D7；2026-11-14 生图对比学习升级）
 *
 * 升级依据（D:\网剧参考 逐文件研读产出）：
 * - 三段式画风层（style/clean/neg）＝character-refs looks.mjs 实测模板中译
 * - 三视图几何三句（正/侧/背逐张朝向指令）＝character-refs core.mjs 实测（不写会微侧身/回头看/背面出正面）
 * - anchorPortraitPrompt 大头照锚点＝H3 实测「加大头照脸最接近」，character-refs face-front 模板
 * - 皮肤质感属角色属性不属画风层；写实写「真实照片而非渲染图」（写 photorealistic 会往 CG 带）
 */

/** 画风层：style 怎么画 / clean 背景与光 / neg 反向词（走 negative 通道或拼尾「避免出现：」） */
const STYLE_LAYERS: Record<string, { style: string; clean: string; neg: string }> = {
  动漫风: {
    style: '干净的日式二维动画插画，如同电视动画的官方角色图：等粗利落的线稿，赛璐璐上色（一层柔和阴影加少量锐利高光），平涂明亮通透的色彩，动画式眼睛带清晰高光，简化的鼻与嘴，头发成束绘制带光泽高光带，衣褶用简练线条交代',
    clean: '纯白背景，均匀受光，至多脚下一圈极淡投影；画面中只有该人物，双手空置，不携带道具',
    neg: '照片，写实皮肤质感，毛孔，胶片颗粒，3D渲染，CGI，半写实，厚涂，水彩，草稿线，杂乱线条，重阴影，渐变背景，Q版，多余人物，多余肢体，变形的手，文字，水印，边框',
  },
  写实: {
    style: '一张真实照片而非渲染图：全画幅相机 85mm 人像镜头 f/5.6 拍摄，自然真实的色彩与白平衡，符合角色年龄的自然皮肤纹理，无妆感不修图无美颜，布料有自然褶皱，轻微胶片颗粒',
    clean: '白色无缝背景纸打至纯白；前方偏左一盏柔和方向性主光加较弱补光，面部与衣物有柔和自然的阴影与体积；画面中只有该人物，双手空置，不携带道具',
    neg: 'CGI，3D渲染，数字绘画，插画，动漫，磨皮皮肤，塑料感皮肤，蜡质皮肤，美颜滤镜，过度对称的脸，过度锐化，HDR，过饱和，平光，多余人物，多余肢体，变形的手，文字，水印，边框',
  },
  '3D 卡通': {
    style: '3D 卡通渲染风格，皮克斯质感，造型圆润，材质柔和',
    clean: '纯白背景，均匀受光，至多脚下一圈极淡投影；画面中只有该人物，双手空置，不携带道具',
    neg: '照片，写实皮肤质感，毛孔，2D平涂，草稿线，多余人物，多余肢体，变形的手，文字，水印，边框',
  },
  国漫: {
    style: '国产动漫风格，唯美古韵与现代结合，色彩饱和，笔触细腻',
    clean: '纯白背景，均匀受光，至多脚下一圈极淡投影；画面中只有该人物，双手空置，不携带道具',
    neg: '照片，写实皮肤质感，日式赛璐璐，草稿线，多余人物，多余肢体，变形的手，文字，水印，边框',
  },
  水墨: {
    style: '水墨画风，留白意境，笔锋浓淡相宜，宣纸质感',
    clean: '纯白背景，均匀受光；画面中只有该人物，双手空置，不携带道具',
    neg: '照片，写实皮肤质感，3D渲染，CGI，饱和色彩，多余人物，多余肢体，变形的手，文字，水印，边框',
  },
};

/** 画风前缀（style 段；自定义画风原样透传） */
export function stylePrefix(style: string): string {
  return STYLE_LAYERS[style]?.style ?? `${style}风格`;
}

/** 画风 clean 段（角色/设定图用：背景与光的固定句） */
export function styleClean(style: string): string | undefined {
  return STYLE_LAYERS[style]?.clean;
}

/** 画风 neg 段（negative 通道用；云端无 negative 参数时拼尾「避免出现：…」） */
export function styleNeg(style: string): string | undefined {
  return STYLE_LAYERS[style]?.neg;
}

/**
 * 角色三视图设定图 prompt v2（横版单次生成：并排三张全身像）。
 * 几何三句为 character-refs 实测模板：不写朝向，动漫惯例画微侧身、侧视回头看、背面出正面。
 */
export function characterSheetPrompt(style: string, name: string, profile: string): string {
  return [
    `${stylePrefix(style)}，角色三视图设定图（reference sheet，仅三张全身立绘，无特写、无其他区块）`,
    `【角色：${name}】${profile}`,
    '版式要求：三张并排等距、大小一致、垂直撑满画面、脚底对齐，头顶与脚下各留少量空白。',
    '几何要求（三张分别执行）：',
    '正面：直立，双肩、双髋、双脚完全正对镜头，鼻尖位于脸部竖直中线，双耳同等可见，双臂自然垂于体侧；',
    '侧面：全身与头部一致朝向画面右侧，直视右方、不看镜头，只露出右半边脸；',
    '背面：如同把摄像机绕人物旋转 180 度所见——面部完全不可见，呈现只有背面能看到的部分（发型背面、衣物背面、鞋跟）。',
    '一致性要求：三张为同一人物，五官、发型、体型、服装、配饰逐项完全一致，同一画风。',
    '渲染要求：边缘清晰锐利，毛发纤毫毕现、布料垂坠感、纹样与配饰做工可辨；影棚级柔光均匀照明；画面中只有这三个人物，双手空置、不持道具。',
    '纯白色干净背景，留白分隔，无文字标签。',
  ].join('\n');
}

/**
 * 大头照锚点 prompt（B4）：正脸大头照单视图——H3 参考生成实测「加大头照脸最接近」；
 * 三视图整图做参考会把景别往全身带、脸被摊小（character-refs 实测），故单独出锚点图供 refImageId 指向。
 * 尺寸：4:5 竖版 1152×1440（32 对齐）；取景句前置+结尾重申防几何句冲淡取景。
 */
export function anchorPortraitPrompt(style: string, name: string, profile: string, ageHint?: string): string {
  return [
    `${stylePrefix(style)}，${name} 的正脸大头照（角色面部锚点图，单视图）。`,
    `【角色：${name}】${profile}`,
    '取景：拉近到只含头与肩的极近特写，证件照式取景——头顶贴近画面上边，下巴位于画面竖直正中，画面下缘切过锁骨，双臂与袖口在画外。',
    '几何：正对镜头，鼻尖在画面竖直中线上，双耳同等可见，不侧脸、不抬头低头。',
    ageHint ? `露出的皮肤是 ${ageHint} 人物的皮肤质感。` : '',
    '一致性：与该角色三视图设定图为完全同一人物——同样的脸型、五官、眉眼、发型与上装领口；下装与鞋不进入画面。',
    '结尾重申：画面下缘切在锁骨处，只有头与肩。',
    `${styleClean(style) ?? '纯白背景，均匀柔光'}，无文字无水印。`,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * 设定图双段 prompt（v3·用户样图复刻）：左大特写 704×1024 + 右三视图 1344×1024
 * → canvas 合成 2048×1024（2:1）。样图规范：白底无边框、三视图脚底对齐、无文字。
 * （双段合成路径已回退，保留兼容；portrait 段同样补取景前置+结尾重申。）
 */
export function characterSheetSplitPrompts(
  style: string,
  name: string,
  profile: string,
): { portrait: string; triView: string } {
  return {
    portrait: [
      `${stylePrefix(style)}，${name} 的单人面部大特写。`,
      `【角色：${name}】${profile}`,
      '取景：拉近到只含头与肩的极近特写，头顶贴近画面上边，下巴位于画面竖直正中，画面下缘切过锁骨，双臂与袖口在画外。',
      '几何：正对镜头，鼻尖在画面竖直中线上，双耳同等可见，不侧脸、不抬头低头。',
      '结尾重申：画面下缘切在锁骨处，只有头与肩。',
      `${styleClean(style) ?? '纯白背景，均匀柔光'}，无文字无水印`,
    ].join('\n'),
    triView: characterSheetPrompt(style, name, profile),
  };
}
