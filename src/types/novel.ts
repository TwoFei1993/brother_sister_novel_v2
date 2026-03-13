export type GenreType = 'chuanyue' | 'scifi' | 'moshi' | 'wuxian' | 'xuanhuan' | 'hunhe' | 'custom';

export type SubGenre = {
  id: string;
  label: string;
};

export type Genre = {
  id: GenreType;
  label: string;
  subGenres: SubGenre[];
  animClass: string;
  loadingText: string;
};

export type BrotherPersonality = 
  | '冷酷腹黑' | '温柔强大' | '痞帅不羁' | '沉稳睿智' 
  | '偏执危险' | '表面废物实则无敌' | '孤傲清冷' | '疯批危险';

export type SisterPersonality = 
  | '表面软萌实则腹黑' | '天才型' | '坚韧独立' | '呆萌可爱' 
  | '冷静理智' | '神秘未知身份' | '外柔内刚' | '看似普通实则惊艳';

export type RelationType = 
  | '相互扶持共同成长型' | '哥哥全力守护妹妹型' | '妹妹反向救赎哥哥型' 
  | '各自成长后震撼重逢型' | '表面互怼实则深厚羁绊型';

export type StoryTone = '热血爽文' | '虐中带甜' | '深度烧脑' | '恐怖压抑' | '温情治愈' | '权谋博弈';

export type WritingStyle = 'default' | 'qidian' | 'jjwxc' | 'fanqie' | 'custom';

export type CoverIcon = 'heart' | 'star' | 'none';

export interface NovelSettings {
  genre: GenreType;
  subGenre: string;
  customGenre: string;
  customSubGenre: string;
  backgroundNote: string;
  brotherAge: number;
  brotherPersonalities: BrotherPersonality[];
  customBrotherPersonality: string;
  brotherAbility: string;
  sisterAge: number;
  sisterPersonalities: SisterPersonality[];
  customSisterPersonality: string;
  sisterAbility: string;
  relationType: RelationType;
  customRelationType: string;
  powerSystem: string;
  factions: string;
  coreConflict: string;
  storyTones: StoryTone[];
  customStoryTone: string;
  writingStyle: WritingStyle;
  customWritingStyle: string;
  desiredChapterCount: number;
  outlineChapterCount: number;
  pastedOutline: string;
}

export interface ChapterVersion {
  content: string;
  title: string;
  createdAt: number;
  label: string; // e.g. "原版", "改写v1", "改写v2"
}

export interface Chapter {
  id: number;
  title: string;
  content: string;
  isGenerating?: boolean;
  versions?: ChapterVersion[];
  currentVersionIndex?: number;
}

export interface WorldBuilding {
  content: string;
  isGenerating?: boolean;
}

export interface NovelProject {
  id: string;
  settings: NovelSettings;
  worldBuilding: WorldBuilding;
  chapters: Chapter[];
  createdAt: number;
  updatedAt?: number;
  title: string;
  coverColor?: string;
  coverIcon?: CoverIcon;
}

export interface Bookmark {
  chapterId: number;
  paragraphIndex: number;
  text: string;
  createdAt: number;
}

export const defaultSettings: NovelSettings = {
  genre: 'chuanyue',
  subGenre: '异世大陆',
  customGenre: '',
  customSubGenre: '',
  backgroundNote: '',
  brotherAge: 22,
  brotherPersonalities: [],
  customBrotherPersonality: '',
  brotherAbility: '',
  sisterAge: 18,
  sisterPersonalities: [],
  customSisterPersonality: '',
  sisterAbility: '',
  relationType: '相互扶持共同成长型',
  customRelationType: '',
  powerSystem: '',
  factions: '',
  coreConflict: '',
  storyTones: ['热血爽文'],
  customStoryTone: '',
  writingStyle: 'default',
  customWritingStyle: '',
  desiredChapterCount: 50,
  outlineChapterCount: 50,
  pastedOutline: '',
};
