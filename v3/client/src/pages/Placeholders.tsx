/**
 * 占位页集中导出（避免文件数膨胀）：/library
 * 后续任务替换为独立实现并改路由 import
 * （书架 → Task 10 RootPage；设置 → Task 18 SettingsPage；写作台 → Task 20 WorkPage）
 */

interface PlaceholderProps {
  title: string;
  hint: string;
  task: string;
}

function Placeholder({ title, hint, task }: PlaceholderProps) {
  return (
    <main className="safe-top safe-bottom flex min-h-screen flex-col items-center justify-center gap-2 bg-[hsl(var(--bg))] px-4 text-[hsl(var(--fg))]">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="text-sm text-[hsl(var(--fg-muted))]">{hint}</p>
      <p className="text-xs text-[hsl(var(--fg-muted))]">（{task} 中实现）</p>
    </main>
  );
}

/** /library 资源库：角色卡/世界书/预设/正则 + 资源中心（Task 25） */
export function LibraryPage() {
  return <Placeholder title="资源库" hint="角色卡 · 世界书 · 预设 · 正则 · 资源中心" task="Task 25" />;
}
