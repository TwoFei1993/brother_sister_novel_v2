/**
 * 试验台扩写调用与输出清洗（设计共识 2026-11-26 第 2.2 / 2.4 节；M2：切出后续接）
 *
 * 走服务端后台 LLM 任务（提交 + 轮询，用主通道、关闭思考）；清洗后的提示词交给用户审批。
 * 服务端任务跨页面生命周期：页面回来时凭它续接（resumeBrief），不用重新花一次调用。
 *
 * 后台任务的槽位按作品隔离：两个作品各有在途扩写时互不串结果（槽位是 localStorage 的键，全局唯一的话，
 * 回到前一个作品会取到后一个作品的结果）。
 */
import { consumeResult, peekResult, submitTask, taskPending, waitAndStore } from '../../../../lib/llmTask';
import { useSettingsStore } from '../../../../stores/settings';
import { stripModelWrapper } from '../output-clean';
import { buildExpandMessages, type ExpandInput } from './prompts-lab';

const slotOf = (workId: string): string => `lab-expand-${workId}`;
const MAX_OUTPUT_TOKENS = 8000;

/** 模型输出 → 提示词正文：剥代码块围栏、剥首尾的解释行与前缀（中间的正文原样保留） */
export const cleanExpandedPrompt = stripModelWrapper;

/**
 * 这个作品的扩写任务是否在途：还在跑，或已跑完但结果没人取。
 * 「结果没人取」以本地断点为准——所以结果一旦被调用方拿到就必须取走（takeLabExpandResult），
 * 否则旧结果会留成断点，下次任务失败时被当成刚跑完的结果。
 */
export function labExpandPending(workId: string): boolean {
  const slot = slotOf(workId);
  return taskPending(slot) || peekResult(slot) !== null;
}

/** 取走这个作品的扩写结果（读 + 清断点）。调用方确实拿到结果之后调用 */
export function takeLabExpandResult(workId: string): void {
  consumeResult(slotOf(workId));
}

/** 一句话 → 完整提示词（抛错为人话：未选模型 / 模型没给出提示词 / 任务失败）。
 *  onSubmitted：任务提交成功后立即回调（调用方据此落续接点） */
export async function expandBrief(
  workId: string,
  input: ExpandInput,
  onElapsed?: (sec: number) => void,
  onSubmitted?: () => void,
): Promise<string> {
  const prefs = useSettingsStore.getState().llmPrefs;
  if (!prefs.model) throw new Error('请先在设置页选择模型');
  const slot = slotOf(workId);
  await submitTask(slot, {
    source: prefs.source,
    model: prefs.model,
    messages: buildExpandMessages(input),
    thinking: false,
    params: { max_tokens: MAX_OUTPUT_TOKENS },
    label: '试验台扩写',
  });
  onSubmitted?.();
  return finishExpand(await waitAndStore(slot, onElapsed));
}

/** 续接这个作品在途的扩写任务：还在跑就接着等，已跑完没人取就直接取回 */
export async function resumeBrief(workId: string, onElapsed?: (sec: number) => void): Promise<string> {
  const slot = slotOf(workId);
  return finishExpand(taskPending(slot) ? await waitAndStore(slot, onElapsed) : consumeResult(slot));
}

function finishExpand(text: string | null): string {
  const prompt = cleanExpandedPrompt(text ?? '');
  if (!prompt) throw new Error('模型没有给出提示词，请重试');
  return prompt;
}
