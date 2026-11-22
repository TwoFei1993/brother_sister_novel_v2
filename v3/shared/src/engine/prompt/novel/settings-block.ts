/**
 * 作品设定中文概要块（从 assemble.ts 迁出；规范回补：assemble 本体 ≤300 行）
 *
 * 旧站 NovelSettings 要点摘要，拼接进 scenario 块。
 * 文风画像（styleGuide）在此做注入侧长度兜底——UI 保存侧（StyleClonePanel）截断为第一道，
 * 本模块 slice 为第二道（历史超长数据不把上下文预算挤爆）。
 */
import { FANDOM_TYPE_LABELS, type NovelSettings } from '@shared/work';

/** 文风画像注入上限（字符）：UI 保存侧截断与本模块注入侧兜底共用同一常量 */
export const STYLE_GUIDE_MAX_CHARS = 800;

/** 人物状态卡注入上限（字符）：AI 抽取自动维护，超长截断兜底 */
export const CHARACTER_STATE_MAX_CHARS = 800;

/** 未回收伏笔注入条数上限：全部列出但超 8 条只保留最近的（防堆砌挤占上下文） */
export const FORESHADOW_INJECT_LIMIT = 8;

/** 同人要点注入上限（字符）：与 styleGuide 同款注入侧兜底 */
export const FANDOM_NOTES_MAX_CHARS = 600;

export function buildSettingsBlock(s: NovelSettings): string {
  const parts: string[] = [];
  const genre = s.customGenre || s.subGenre;
  if (genre) parts.push(`题材：${genre}`);
  // 同人创作块（用户需求 2026-11-22：软件理解「同人」——原著信息与同人纪律注入每次生成；
  // 原著详细设定走世界书/角色卡扫描注入的既有通道，此处注入的是「同人语义 + 原著锚点」）
  if (s.genre === 'fanfic') {
    const fandomParts: string[] = [];
    if (s.fandomSource?.trim()) fandomParts.push(`原著：${s.fandomSource.trim()}`);
    if (s.fandomType) fandomParts.push(`衍生类型：${FANDOM_TYPE_LABELS[s.fandomType]}`);
    const notes = s.fandomNotes?.trim().slice(0, FANDOM_NOTES_MAX_CHARS);
    if (notes) fandomParts.push(`同人要点：${notes}`);
    parts.push(
      '【同人创作纪律（衍生作品，硬性要求）】\n' +
        '- 本作品是原著的衍生创作：人物性格、说话方式、人物关系必须严格忠于原著，禁止 OOC\n' +
        '- 世界观/力量体系/规则以原著为准；上方设定与原著冲突时，以原著设定优先（上方为本书的衍生设定）\n' +
        (fandomParts.length > 0 ? `- ${fandomParts.join('；')}\n` : '') +
        '- 原著未提及的细节按原著风格合理补全，不要生造与原著气质相悖的设定',
    );
  }
  if (s.backgroundNote.trim()) parts.push(`背景：${s.backgroundNote.trim()}`);
  const brother = [...s.brotherPersonalities, s.customBrotherPersonality].filter(Boolean).join('、');
  if (brother || s.brotherAbility.trim()) {
    parts.push(`哥哥（${s.brotherAge}岁）：${brother}${s.brotherAbility.trim() ? `；能力：${s.brotherAbility.trim()}` : ''}`);
  }
  const sister = [...s.sisterPersonalities, s.customSisterPersonality].filter(Boolean).join('、');
  if (sister || s.sisterAbility.trim()) {
    parts.push(`妹妹（${s.sisterAge}岁）：${sister}${s.sisterAbility.trim() ? `；能力：${s.sisterAbility.trim()}` : ''}`);
  }
  const relation = s.customRelationType || s.relationType;
  if (relation) parts.push(`兄妹关系：${relation}`);
  if (s.powerSystem.trim()) parts.push(`力量体系：${s.powerSystem.trim()}`);
  if (s.factions.trim()) parts.push(`势力划分：${s.factions.trim()}`);
  if (s.coreConflict.trim()) parts.push(`核心矛盾：${s.coreConflict.trim()}`);
  const tones = [...s.storyTones, s.customStoryTone].filter(Boolean).join('、');
  if (tones) parts.push(`基调：${tones}`);
  const style = s.customWritingStyle || (s.writingStyle !== 'default' ? s.writingStyle : '');
  if (style) parts.push(`文风：${style}`);
  // 文风复刻画像：非空时以最高优先级注入（标记词供测试与人工排查锚定）；超上限截断兜底
  const styleGuide = s.styleGuide?.trim().slice(0, STYLE_GUIDE_MAX_CHARS);
  if (styleGuide) parts.push(`【文风要求（最高优先级，逐条遵循）】\n${styleGuide}`);
  // 人物状态卡（自动记忆）：动态事实注入，正文与静态档案冲突时以此为准（最近剧情优先）
  const characterState = s.characterState?.trim().slice(0, CHARACTER_STATE_MAX_CHARS);
  if (characterState) parts.push(`【人物当前状态（自动维护，与正文冲突时以此为准）】\n${characterState}`);
  // 未回收伏笔提醒：适合时自然回收，不强行集中解释
  const openForeshadows = (s.foreshadows ?? []).filter((f) => !f.resolved).slice(-FORESHADOW_INJECT_LIMIT);
  if (openForeshadows.length > 0) {
    parts.push(
      '【已埋伏笔登记（未回收）——适合时可自然回收，不要强行集中解释】\n' +
        openForeshadows.map((f, i) => `${i + 1}. ${f.desc}（第${f.plantedAt}章埋）`).join('\n'),
    );
  }
  // 分卷规划（卷规划层，用户反馈：卷大纲与章细纲分开别混）：卷级主线整块注入，
  // 与生成期按章号定位的本卷注入（volumeOutlineDirective）互补
  const volumes = (s.volumeOutlines ?? []).filter((v) => v.title.trim() || v.summary.trim());
  if (volumes.length > 0) {
    parts.push(
      '【分卷规划（卷级主线；章细纲之外的上一层规划）】\n' +
        volumes
          .map((v) => `第${v.index}卷《${v.title}》${v.startChapter ? `（第${v.startChapter}章起）` : ''}：${v.summary}`)
          .join('\n'),
    );
  }
  if (s.pastedOutline.trim()) parts.push(`大纲：${s.pastedOutline.trim()}`);
  return parts.length ? `【作品设定】\n${parts.join('\n')}` : '';
}
