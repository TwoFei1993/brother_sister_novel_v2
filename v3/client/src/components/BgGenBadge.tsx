/**
 * 顶栏「⚡后台生成 N 本」指示（Chunk 6 Task 6.2）：N>0 渲染，点击回书架查看进度。
 * 独立小组件：自带 useActiveGenCount 轮询，WorkPage 顶栏一行挂载即用。
 */
import { useNavigate } from 'react-router-dom';

import { useActiveGenCount } from '../hooks/useActiveGenCount';

export default function BgGenBadge() {
  const count = useActiveGenCount();
  const navigate = useNavigate();
  if (count <= 0) return null;
  return (
    <button
      type="button"
      data-testid="bg-gen-count"
      onClick={() => navigate('/')}
      title="后台任务进行中，点击回书架查看进度"
      className="flex h-9 shrink-0 items-center rounded-full border border-[hsl(var(--accent))]/50 bg-[hsl(var(--accent))]/10 px-3 text-xs font-medium text-[hsl(var(--accent))] transition-colors hover:bg-[hsl(var(--accent))]/20"
    >
      ⚡后台生成 {count} 本
    </button>
  );
}
