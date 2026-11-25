/**
 * 书架封面的后台生成徽标 + 取消（移动书架缺口，深度测试 2026-11-26 发现）：
 * 此前手机书架只认内存里的生成槽——发起连写后切出或刷新，书架上看不出这本书正在后台写，
 * 也无法取消（桌面书架一直有 5s 轮询 /active 的徽标）。数据源复用 useShelfBatch.activeByWork。
 * 封面卡本身是整卡按钮：取消按钮做成下方的兄弟节点，不嵌套、不压在书名上。
 */
import type { ReactNode } from 'react';

import type { ActiveTask } from '../../../lib/activeTasks';

interface Props {
  /** 该书进行中的后台生成任务（无则原样渲染封面） */
  task: ActiveTask | undefined;
  cancelling: boolean;
  onCancel: () => void;
  children: ReactNode;
}

export default function ActiveTaskBadge({ task, cancelling, onCancel, children }: Props) {
  if (!task) return <>{children}</>;
  return (
    <span className="block" data-testid="m-work-active">
      {children}
      <button
        type="button"
        onClick={onCancel}
        disabled={cancelling}
        data-testid="m-work-cancel-task"
        aria-label="取消后台生成任务"
        title="取消后台任务（当前段跑完即停，已完成章保留）"
        className="mt-0.5 w-full rounded border border-[hsl(var(--danger))]/50 py-0.5 text-center text-[10px] leading-3 text-[hsl(var(--danger))] transition-colors active:bg-[hsl(var(--danger))]/10 disabled:opacity-50"
      >
        {cancelling ? '取消中…' : '取消'}
      </button>
    </span>
  );
}
