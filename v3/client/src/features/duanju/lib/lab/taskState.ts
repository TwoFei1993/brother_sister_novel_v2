/**
 * 试验台任务检查点（M2）：出图与扩写的在途状态写 localStorage，页面重载 / 切走再回来后续接。
 *
 * 按作品隔离；读出来先过 schema（在 shared/duanju/lab——客户端包不依赖 zod）——损坏或旧版本的检查点
 * 直接丢弃，不让它卡住界面。只存可序列化的东西（路径、参数、引擎任务号）：参考图在「添加」时已上传，
 * 所以这里不带图片字节。
 */
import {
  LabInputSchema,
  LabTaskCheckpointSchema,
  type LabInput,
  type LabProvider,
  type LabRecord,
  type LabTaskCheckpoint,
} from '@shared/duanju/lab';

export type LabInputState = LabInput;
export type { LabTaskCheckpoint };

/** 出图参数：审批草稿与历史记录都给出同一形状 */
export interface ProduceParams extends LabInputState {
  prompt: string;
}

/** 只认「能 safeParse 的东西」，不依赖 zod 的类型 */
interface Parser<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false; error: unknown };
}

function read<T>(key: string, schema: Parser<T>): T | null {
  try {
    const parsed = schema.safeParse(JSON.parse(localStorage.getItem(key) ?? 'null'));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 写不进（隐私模式 / 占满）：只是这次不能续接，不影响本次出图
  }
}

function clear(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // 同上
  }
}

const taskKey = (workId: string): string => `duanju-lab-task:${workId}`;
const expandKey = (workId: string): string => `duanju-lab-expand:${workId}`;

export const readLabTask = (workId: string): LabTaskCheckpoint | null => read(taskKey(workId), LabTaskCheckpointSchema);
export const writeLabTask = (workId: string, task: LabTaskCheckpoint): void => write(taskKey(workId), task);
export const clearLabTask = (workId: string): void => clear(taskKey(workId));

export const readLabExpand = (workId: string): LabInputState | null => read(expandKey(workId), LabInputSchema);
export const writeLabExpand = (workId: string, input: LabInputState): void => write(expandKey(workId), input);
export const clearLabExpand = (workId: string): void => clear(expandKey(workId));

/** 空的输入区状态 */
export const emptyLabInput = (provider: LabProvider): LabInputState => ({
  brief: '',
  kind: 'free',
  aspect: '9:16',
  language: 'zh',
  provider,
  characterIds: [],
  sceneIds: [],
  refs: [],
});

/** 历史记录 → 出图参数（「再出一张」沿用记录自己的提示词、参考图与设定；语言记录里没有，取当前选择） */
export function recordToProduceParams(record: LabRecord, language: LabInputState['language']): ProduceParams {
  return {
    brief: record.brief,
    kind: record.kind,
    provider: record.provider,
    aspect: record.aspect,
    characterIds: record.characterIds,
    sceneIds: record.sceneIds,
    refs: record.refs,
    prompt: record.prompt,
    language,
  };
}
