/**
 * 试验台（测试生图，设计共识 2026-11-26 第 2 节）：一句话 → AI 扩写 → 审批 → 出图 → 历史可追溯
 *
 * 流程：输入（LabInput）→ 扩写成完整提示词（LabPromptReview，可改）→ 确认出图 → 归档进历史（LabHistory）。
 * 状态与续接逻辑在 useLabMachine；本文件只管排版。分区常驻挂载（工作台 hidden 切换）：本地引擎一张
 * 2–8 分钟，切到别的分区回来还在。
 */
import type { LabRecord } from '@shared/duanju/lab';

import { refOptionOfRecord } from '../lib/lab/refs';
import { recordToProduceParams } from '../lib/lab/taskState';
import LabHistory from './LabHistory';
import LabInput from './LabInput';
import LabPromptReview from './LabPromptReview';
import { useLabMachine } from './useLabMachine';

export default function LabPane({ workId }: { workId: string }) {
  const m = useLabMachine(workId);
  const busy = m.phase !== 'idle';
  /** 审批中的那版参数（存在才渲染审批区） */
  const draftParams = m.draftParams;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-4" data-testid="duanju-lab">
      {m.error && (
        <p
          className="rounded-lg bg-[hsl(var(--danger))]/10 px-3 py-2 text-xs text-[hsl(var(--danger))]"
          role="alert"
          data-testid="lab-error"
        >
          {m.error}
        </p>
      )}
      <LabInput
        workId={workId}
        value={m.input}
        onChange={m.setInput}
        disabled={busy}
        expanding={m.phase === 'expanding'}
        onExpand={m.runExpand}
        characters={m.characters}
        scenes={m.scenes}
        refOptions={m.refOptions}
        addingRef={m.addingRef}
        onUploadRef={m.addUploadedRef}
        onAddWorkRef={m.addWorkRef}
      />
      {draftParams && (
        <LabPromptReview
          workId={workId}
          brief={draftParams.brief}
          prompt={m.draft}
          onChange={m.setDraft}
          provider={draftParams.provider}
          aspect={draftParams.aspect}
          refs={draftParams.refs}
          onRegenerate={m.runExpand}
          onConfirm={() => m.produce({ ...draftParams, prompt: m.draft })}
          expanding={m.phase === 'expanding'}
          generating={m.phase === 'generating'}
          elapsedSec={m.elapsedSec}
        />
      )}
      <LabHistory
        workId={workId}
        records={m.records}
        lastId={m.lastId}
        busy={busy}
        onDelete={m.remove}
        onReroll={(r: LabRecord) => m.produce(recordToProduceParams(r, m.input.language))}
        onReuse={m.reuse}
        onUseAsRef={(r: LabRecord) => m.addWorkRef(refOptionOfRecord(r))}
      />
    </div>
  );
}
