/**
 * ✨ AI 润色单章（从 TextPane 抽出：提示词与生成调用与 UI 无关，便于复用与行数控制）。
 * 保持情节/人物/事实不变提升文笔，经 appendSwipe 生成新版本（旧版本保留）。
 */
import { generateTextOnce } from '../../../../api/llm';
import { patchMessage } from '../../../../api/works';
import { useWorkStore } from '../../../../stores/work';
import { useSettingsStore } from '../../../../stores/settings';
import { appendSwipe } from '../../../../hooks/generation-flow';
import type { Message } from '@shared/message';
import type { Work } from '@shared/work';

/** 润色当前章：成功返回更新后的消息（新版本已本地+远端落库），失败抛错由调用方提示 */
export async function polishChapterText(work: Work, current: Message): Promise<Message> {
  const prefs = useSettingsStore.getState().llmPrefs;
  const text = await generateTextOnce(
    {
      source: prefs.source,
      model: prefs.model,
      temperature: 0.6,
      thinking: prefs.thinking !== false,
      messages: [
        {
          role: 'user',
          content:
            `你是资深小说编辑。请在完全不改变以下章节的情节走向、人物性格、对话内容与事实设定的前提下润色正文：` +
            `修正病句与错别字、提升文字质感与画面感、优化叙事节奏。直接输出润色后的全文，不要任何解释、标题或前后缀。` +
            `\n\n【章节】第${current.chapter?.index ?? 1}章 ${current.chapter?.title || ''}\n\n【正文】\n${current.content}`,
        },
      ],
    },
    16384,
  );
  const cleaned = text.trim();
  if (!cleaned) throw new Error('模型无输出');
  const updated = appendSwipe(current, cleaned, {});
  useWorkStore.getState().upsertLocal(updated);
  await patchMessage(work.id, updated);
  return updated;
}
