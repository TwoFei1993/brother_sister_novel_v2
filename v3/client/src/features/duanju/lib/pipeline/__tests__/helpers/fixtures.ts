/**
 * 流水线测试的作品 / 任务结果样例（纯数据与纯函数，不依赖假后端实例）
 */
import type { DuanjuCharacter, DuanjuEpisode, DuanjuProject, DuanjuScene, DuanjuShot } from '@shared/duanju';

/** 假作品 id */
export const WORK = 'w1';

/** 三章小说（每章的首句 / 末句即锚点） */
export const NOVEL = ['第 1 章 出发\n小明出了门。', '第 2 章 到达\n小明到了。', '第 3 章 回家\n小明回了家。'].join('\n');

export const CHAR_LABEL = '流水线·提取角色档案';
export const SCENE_LABEL = '流水线·提取场景档案';
export const adaptLabel = (n: number): string => `改编剧本·第${n}集`;
export const continueLabel = (n: number): string => `续写剧本·第${n}集`;
export const shotLabel = (n: number): string => `流水线·拆镜头第${n}集`;

/** 一集合格的剧本正文（≥200 字，带集号便于断言来源） */
export function scriptText(n: number): string {
  return `场1 内·地点${n}·日\n${`这是第${n}集的正文。`.repeat(30)}`;
}

export const CHARACTERS_JSON = JSON.stringify([
  { name: '小明', profile: '黑发少年，蓝衣', lockPhrase: 'black hair, blue robe' },
]);
export const SCENES_JSON = JSON.stringify([{ name: '家门口', spec: '木门青瓦，晨光斜照' }]);
export const SHOTS_JSON = JSON.stringify([
  { shotSize: '中景', gridParts: ['小明站在门口。'.repeat(5)], dialog: '', characters: ['小明'], scene: '家门口' },
]);

export interface TaskReplyLike {
  status: 'done';
  text: string;
}

/** 整条流水线（到第 episodes 集为止）各任务的成功结果：[label, 结果] */
export function happyPathReplies(episodes: number): Array<[string, TaskReplyLike]> {
  const out: Array<[string, TaskReplyLike]> = [
    [CHAR_LABEL, { status: 'done', text: CHARACTERS_JSON }],
    [SCENE_LABEL, { status: 'done', text: SCENES_JSON }],
  ];
  for (let n = 1; n <= episodes; n += 1) {
    out.push([adaptLabel(n), { status: 'done', text: scriptText(n) }]);
    out.push([continueLabel(n), { status: 'done', text: scriptText(n) }]);
    out.push([shotLabel(n), { status: 'done', text: SHOTS_JSON }]);
  }
  return out;
}

export function episode(index: number, overrides: Partial<DuanjuEpisode> = {}): DuanjuEpisode {
  const end = ['', '小明出了门。', '小明到了。', '小明回了家。'][index];
  return {
    id: `ep-${index}`,
    index,
    title: `标题${index}`,
    synopsis: `第${index}集梗概`,
    sourceStart: `第 ${index} 章`,
    sourceEnd: end,
    ...overrides,
  };
}

type Overrides = Partial<
  Pick<DuanjuProject, 'script' | 'episodes' | 'characters' | 'scenes' | 'shots' | 'pipeline'>
>;

function baseProject(): DuanjuProject {
  return {
    revision: 1,
    script: { source: 'pasted', text: NOVEL, confirmed: true, scope: 'full', updatedAt: 1 },
    reviewCards: {
      summary: '小明出门',
      eventChain: [],
      conflict: '',
      characterRelations: '兄弟',
      emotionPoints: [],
      visualActions: [],
      riskReplacements: [],
    },
    style: '动漫风',
    targetEpisodes: 3,
    protagonists: '',
    characters: [],
    scenes: [],
    props: [],
    episodes: [],
    shots: [],
    spendLog: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

/** 整本小说的短剧作品（已拆解出 3 集与锚点） */
export function novelProject(overrides: Overrides = {}): DuanjuProject {
  return { ...baseProject(), episodes: [episode(1), episode(2), episode(3)], ...overrides };
}

/** 只有第 1 集剧本的作品（第 2 集起要续写） */
export function episode1Project(overrides: Overrides = {}): DuanjuProject {
  return {
    ...baseProject(),
    script: { source: 'ai', text: '第 1 集的剧本正文', confirmed: true, scope: 'episode1', updatedAt: 1 },
    episodes: [episode(1), episode(2), episode(3)],
    ...overrides,
  };
}

export const existingCharacter = (overrides: Partial<DuanjuCharacter> = {}): DuanjuCharacter => ({
  id: 'c-old',
  name: '小明',
  profile: '用户手调过的档案',
  sheetImages: [],
  createdAt: 1,
  updatedAt: 5,
  ...overrides,
});

export const existingScene = (overrides: Partial<DuanjuScene> = {}): DuanjuScene => ({
  id: 's-old',
  name: '家门口',
  spec: '用户手调过的场景',
  images: [],
  createdAt: 1,
  updatedAt: 7,
  ...overrides,
});

export const existingShot = (episodeId: string, overrides: Partial<DuanjuShot> = {}): DuanjuShot => ({
  id: `shot-old-${episodeId}`,
  episodeId,
  index: 1,
  shotSize: '中景',
  cameraMove: '固定',
  actionStart: '',
  actionEnd: '',
  staging: '',
  dialog: '',
  gridPrompt: '',
  gridParts: [],
  frames: [],
  characterIds: [],
  propIds: [],
  updatedAt: 3,
  ...overrides,
});
