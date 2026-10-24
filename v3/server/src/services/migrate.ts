/**
 * 旧站数据迁移（设计 Task 31）：localStorage novel_history → Work + Message[]
 *
 * 旧结构对照旧站 src/types/novel.ts：NovelProject{settings, worldBuilding,
 * chapters[{content, versions[{content}], currentVersionIndex}]}。
 * 映射规则：
 *   - NovelProject → Work：mode=novel、genre=settings.genre、settings 逐字段
 *     （字段名旧新一致，缺省补 defaultNovelSettings，未知字段丢弃），
 *     worldBuilding.content 原文存入 settings.legacyWorldBuilding。
 *   - Chapter → Message：chapter={index:数组序+1,title}、versions→swipes
 *     （无版本兜底 [content]）、swipeId=currentVersionIndex（clamp）、
 *     content=当前版本正文、createdAt=项目 createdAt+章节序×60000（单调）。
 * stats（设计 §4.6）由 messages 现算：messageCount/chapterCount/charCount。
 * 输出经 WorkSchema/MessageSchema strict 兜底校验——脏数据在入口即暴露。
 */
import { randomUUID } from 'node:crypto';

import { aiVersion, MessageSchema, type Message } from '@shared/message';
import {
  WorkSchema,
  defaultNovelSettings,
  type NovelSettings,
  type Work,
} from '@shared/work';

// ---------- 旧站宽松输入类型（字段名与旧 src/types/novel.ts 对齐，均可缺省） ----------
export interface LegacyChapterVersion {
  content?: string;
}
export interface LegacyChapter {
  title?: string;
  content?: string;
  versions?: LegacyChapterVersion[];
  currentVersionIndex?: number;
}
export interface LegacyWorldBuilding {
  content?: string;
}
export interface LegacyNovelProject {
  title?: string;
  createdAt?: number;
  updatedAt?: number;
  settings?: Record<string, unknown>;
  worldBuilding?: LegacyWorldBuilding;
  chapters?: LegacyChapter[];
}

/** 迁移结果：work 与其消息流成对返回，由调用方负责落盘 */
export interface MigratedWork {
  work: Work;
  messages: Message[];
}

/** 批量迁移结果（计划 Task 31 签名）：works 与输入同序 */
export interface MigrateResult {
  works: MigratedWork[];
}

const CHAPTER_STEP_MS = 60000;

/**
 * 旧 settings → 新 NovelSettings：以默认值为底，旧数据已知字段逐个覆盖。
 * 白名单取 defaultNovelSettings 的键（旧新字段名全量一致），旧站脏字段天然被排除；
 * worldBuilding.content 原文并入 legacyWorldBuilding（空串视为无，省略字段）。
 */
function mapSettings(raw: Record<string, unknown> | undefined, worldContent: string): NovelSettings {
  const mapped = { ...defaultNovelSettings };
  if (raw) {
    for (const key of Object.keys(defaultNovelSettings)) {
      const value = raw[key];
      if (value !== undefined && value !== null) {
        (mapped as Record<string, unknown>)[key] = value;
      }
    }
  }
  return { ...mapped, ...(worldContent === '' ? {} : { legacyWorldBuilding: worldContent }) };
}

/** 单章节 → 消息：swipes 以 versions 数组为准（结构化版本，命名 v1…），content 取当前选中版本（缺失兜底 chapter.content） */
function chapterToMessage(
  chapter: LegacyChapter,
  index: number,
  baseTime: number,
): Message {
  const fallback = chapter.content ?? '';
  const versions = chapter.versions ?? [];
  const createdAt = baseTime + index * CHAPTER_STEP_MS;
  const swipes =
    versions.length > 0
      ? versions.map((v, i) => aiVersion(v.content ?? '', `v${i + 1}`, createdAt))
      : [aiVersion(fallback, 'v1', createdAt)];
  const rawSwipeId = chapter.currentVersionIndex ?? 0;
  const swipeId = Math.min(Math.max(0, Math.trunc(rawSwipeId)), swipes.length - 1);
  return {
    id: randomUUID(),
    role: 'assistant',
    name: '小说家',
    content: swipes[swipeId]?.content ?? fallback,
    createdAt,
    swipes,
    swipeId,
    chapter: { index, title: chapter.title ?? '' },
    extra: {},
  };
}

/** 单旧项目 → {work, messages}；strict parse 兜底，settings 枚举非法等脏数据在此抛 ZodError */
export function migrateProject(project: LegacyNovelProject, fallbackTime: number): MigratedWork {
  const baseTime = project.createdAt ?? fallbackTime;
  const chapters = project.chapters ?? [];
  const messages = chapters.map((chapter, i) => chapterToMessage(chapter, i + 1, baseTime));
  const lastMsgTime = messages.at(-1)?.createdAt ?? baseTime;

  const work: Work = {
    id: randomUUID(),
    revision: 1,
    title: project.title ?? '',
    mode: 'novel',
    genre:
      typeof project.settings?.['genre'] === 'string'
        ? (project.settings['genre'] as string)
        : defaultNovelSettings.genre,
    characterIds: [],
    worldbookIds: [],
    presetId: '',
    regexScriptIds: [],
    settings: mapSettings(project.settings, project.worldBuilding?.content ?? ''),
    voiceMap: {},
    stats: {
      messageCount: messages.length,
      chapterCount: messages.length, // 迁移的每条消息都带 chapter 元数据
      charCount: messages.reduce((sum, m) => sum + m.content.length, 0),
    },
    createdAt: baseTime,
    updatedAt: Math.max(project.updatedAt ?? 0, lastMsgTime),
  };
  return {
    work: WorkSchema.parse(work),
    messages: messages.map((m) => MessageSchema.parse(m)),
  };
}

/** 批量入口：NovelProject[] → {works: [{work, messages}]}，保持原数组顺序 */
export function migrateNovelHistory(projects: LegacyNovelProject[]): MigrateResult {
  const fallbackTime = Date.now();
  return { works: projects.map((project) => migrateProject(project, fallbackTime)) };
}
