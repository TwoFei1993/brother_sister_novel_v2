/**
 * 试验台状态机（M2 从 LabPane 抽出：状态与副作用在此，LabPane 只管渲染）
 *
 * 流程：输入 → 扩写（服务端后台任务）→ 审批 → 出图 → 归档进历史。
 * - 审批区记住「当初扩写用的参数」：之后改输入区不影响这次出图；想换参数用「重新扩写」。
 * - 续接：本地出图提交成功即落检查点（引擎任务号），扩写提交成功即落输入快照；
 *   挂载时发现本作品有在途任务就接着等——页面重载、切走再回来都不丢。
 * 参考图的添加在 useLabRefs。
 */
import { useEffect, useRef, useState } from 'react';

import type { LabRecord, LabRef } from '@shared/duanju/lab';

import { imageProviderForApi } from '../../../api/duanju';
import { deleteLabRecord, listLabRecords } from '../../../api/duanjuLab';
import { useDuanjuStore } from '../store';
import { expandBrief, labExpandPending, resumeBrief, takeLabExpandResult } from '../lib/lab/expand';
import { generateLabImage, produceProblem, resumeLabImage } from '../lib/lab/generate';
import { isPollTimeout, POLL_TIMEOUT_MESSAGE } from '../lib/lab/comfyRefs';
import { buildExpandInput } from '../lib/lab/prompts-lab';
import { effectiveRefs, pickableRefs } from '../lib/lab/refs';
import {
  clearLabExpand,
  clearLabTask,
  emptyLabInput,
  readLabExpand,
  readLabTask,
  recordToProduceParams,
  writeLabExpand,
  writeLabTask,
  type LabInputState,
  type ProduceParams,
} from '../lib/lab/taskState';
import { useLabRefs } from './useLabRefs';

export type LabPhase = 'idle' | 'expanding' | 'generating';

/**
 * 本页面内仍在跑的出图（按作品）。分区被卸载后 promise 不会停：重新挂载时接回同一个 promise，
 * 而不是再起一路轮询——那会归档出两条一样的记录。
 */
const inflightImages = new Map<string, Promise<LabRecord>>();

/** 登记一路出图：成败都清检查点，结束后注销。「等太久」不清——引擎那边多半还在跑，留着下次接着等 */
function trackImage(workId: string, run: Promise<LabRecord>): Promise<LabRecord> {
  const tracked = run
    .then(
      (record) => {
        clearLabTask(workId);
        return record;
      },
      (err: unknown) => {
        if (!isPollTimeout(err)) clearLabTask(workId);
        throw err;
      },
    )
    .finally(() => {
      if (inflightImages.get(workId) === tracked) inflightImages.delete(workId);
    });
  inflightImages.set(workId, tracked);
  return tracked;
}

/** 出图失败的人话：「等太久」给出下一步，其余原样 */
const produceError = (e: unknown, fallback: string): string => (isPollTimeout(e) ? POLL_TIMEOUT_MESSAGE : humanError(e, fallback));

/** 本作品的在途出图：还在跑就返回它；否则凭检查点起一路续轮询；都没有则 null */
function inflightOrResume(workId: string): Promise<LabRecord> | null {
  const running = inflightImages.get(workId);
  if (running) return running;
  const task = readLabTask(workId);
  return task ? trackImage(workId, resumeLabImage(workId, task)) : null;
}

const randomSeed = (): number => Math.floor(Math.random() * 2_147_483_647);
const humanError = (e: unknown, fallback: string): string => (e instanceof Error ? e.message : fallback);

export function useLabMachine(workId: string) {
  const { project } = useDuanjuStore();
  const [input, setInput] = useState<LabInputState>(() => emptyLabInput(imageProviderForApi() ?? 'comfy'));
  /** 审批中的提示词与它当初的扩写参数 */
  const [draft, setDraft] = useState('');
  const [draftParams, setDraftParams] = useState<ProduceParams | null>(null);
  const [phase, setPhase] = useState<LabPhase>('idle');
  /** 出图的开始时刻（续接的任务沿用原时刻，已用时长不归零） */
  const [startedAt, setStartedAt] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [records, setRecords] = useState<LabRecord[] | null>(null);
  const [lastId, setLastId] = useState<string | null>(null);
  /** 卸载后 promise 还会跑完：不在了就不动状态，在途的留给重新挂载的实例续接 */
  const alive = useRef(true);
  const refs = useLabRefs({ workId, input, setInput, onError: setError });

  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    listLabRecords(workId)
      .then((r) => {
        if (!cancelled) setRecords(r);
      })
      .catch(() => {
        if (!cancelled) setRecords([]);
      });
    return () => {
      cancelled = true;
      alive.current = false;
    };
  }, [workId]);

  // 计时按开始时刻：切出再回来时长仍准
  useEffect(() => {
    if (phase === 'idle') return undefined;
    const t0 = phase === 'generating' && startedAt > 0 ? startedAt : Date.now();
    const tick = (): void => setElapsedSec(Math.max(0, Math.round((Date.now() - t0) / 1000)));
    tick();
    const h = setInterval(tick, 1000);
    return () => clearInterval(h);
  }, [phase, startedAt]);

  function acceptRecord(record: LabRecord): void {
    setRecords((prev) => (prev?.some((r) => r.id === record.id) ? prev : [...(prev ?? []), record]));
    setLastId(record.id);
  }

  function acceptPrompt(text: string, state: LabInputState): void {
    setDraft(text);
    setDraftParams({ ...state, brief: state.brief.trim(), prompt: text, refs: effectiveRefs(state.provider, state.refs) });
  }

  async function runExpand(state: LabInputState): Promise<void> {
    if (phase !== 'idle' || !state.brief.trim()) return;
    setPhase('expanding');
    setError(null);
    try {
      const text = await expandBrief(workId, buildExpandInput(state, project), undefined, () => writeLabExpand(workId, state));
      // 结果到了手里就取走断点（见 labExpandPending 的说明）；人已经走了则留着，回来时续接
      if (alive.current) {
        takeLabExpandResult(workId);
        acceptPrompt(text, state);
      }
    } catch (e) {
      if (alive.current) setError(humanError(e, '扩写失败，请重试'));
    } finally {
      if (alive.current) {
        clearLabExpand(workId);
        setPhase('idle');
      }
    }
  }

  /** 出图并归档（审批草稿与历史「再出一张」共用） */
  async function produce(params: ProduceParams, seed: number): Promise<void> {
    if (phase !== 'idle') return;
    const problem = produceProblem(params);
    if (problem) {
      setError(problem);
      return;
    }
    setPhase('generating');
    setStartedAt(Date.now());
    setError(null);
    try {
      const record = await trackImage(
        workId,
        generateLabImage({ workId, ...params, seed }, (task) => writeLabTask(workId, task)),
      );
      if (alive.current) acceptRecord(record);
    } catch (e) {
      if (alive.current) setError(produceError(e, '出图失败，请重试'));
    } finally {
      if (alive.current) setPhase('idle');
    }
  }

  /** 续接在途的出图：没有则返回 false */
  async function resumeImagePhase(): Promise<boolean> {
    const run = inflightOrResume(workId);
    if (!run) return false;
    setPhase('generating');
    setStartedAt(readLabTask(workId)?.startedAt || Date.now());
    try {
      const record = await run;
      if (alive.current) acceptRecord(record);
    } finally {
      if (alive.current) setPhase('idle');
    }
    return true;
  }

  /** 续接在途的扩写：任务还在跑就接着等；已跑完没人取就直接取回 */
  async function resumeExpand(): Promise<void> {
    const snapshot = readLabExpand(workId);
    if (!snapshot) {
      takeLabExpandResult(workId); // 没有在途扩写却留着结果：是别处留下的旧断点，清掉，免得下次被当成刚跑完的结果
      return;
    }
    if (!labExpandPending(workId)) {
      clearLabExpand(workId); // 任务失败过或结果已被取走：过期快照丢掉
      return;
    }
    setInput(snapshot);
    setPhase('expanding');
    try {
      const text = await resumeBrief(workId);
      if (alive.current) acceptPrompt(text, snapshot);
    } finally {
      clearLabExpand(workId);
      if (alive.current) setPhase('idle');
    }
  }

  // 挂载时续接本作品的在途任务。同一个分区不会同时出图和扩写
  useEffect(() => {
    void (async (): Promise<void> => {
      try {
        if (await resumeImagePhase()) return;
        await resumeExpand();
      } catch (e) {
        setError(produceError(e, '续接上次未完成的任务失败——请重新来一次'));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在进入这个作品时跑一次；闭包里的函数不参与比较
  }, [workId]);

  /** 历史记录 → 回填输入区与审批区（语言保持当前选择） */
  function reuse(record: LabRecord): void {
    const params = recordToProduceParams(record, input.language);
    const { prompt, ...state } = params;
    setInput(state);
    setDraft(prompt);
    setDraftParams(params);
    setError(null);
  }

  async function remove(record: LabRecord): Promise<void> {
    try {
      const remaining = await deleteLabRecord(workId, record.id);
      setRecords(remaining);
      if (lastId === record.id) setLastId(null);
      dropGoneRefs(record, remaining);
    } catch (e) {
      setError(humanError(e, '删除失败，请重试'));
    }
  }

  /** 这条记录独占的参考图已随它从盘上删除：输入区 / 审批区里还指着的摘掉，否则下次出图会读到 404 */
  function dropGoneRefs(record: LabRecord, remaining: LabRecord[]): void {
    const stillUsed = new Set(remaining.flatMap((r) => r.refs.map((x) => x.path)));
    const gone = new Set(record.refs.map((x) => x.path).filter((p) => !stillUsed.has(p)));
    const drop = (refs: LabRef[]): LabRef[] => refs.filter((x) => !gone.has(x.path));
    if (input.refs.some((x) => gone.has(x.path))) setInput({ ...input, refs: drop(input.refs) });
    if (draftParams?.refs.some((x) => gone.has(x.path))) {
      setDraftParams({ ...draftParams, refs: drop(draftParams.refs) });
    }
  }

  return {
    input,
    setInput,
    draft,
    setDraft,
    draftParams,
    phase,
    elapsedSec,
    error,
    records,
    lastId,
    characters: project?.characters ?? [],
    scenes: project?.scenes ?? [],
    refOptions: pickableRefs(project, records ?? []),
    ...refs,
    runExpand: (): void => void runExpand(input),
    produce: (params: ProduceParams): void => void produce(params, randomSeed()),
    reuse,
    remove: (record: LabRecord): void => void remove(record),
  };
}
