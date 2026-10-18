/**
 * 占位页集中导出（避免文件数膨胀）：/work/:id /library /settings
 * 后续任务逐个替换为独立实现并改路由 import（书架已于 Task 10 独立为 pages/RootPage.tsx）
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

/** /work/:id 写作台：对话流 / 沉漫阅读 / 工作台（Task 20+） */
export function WorkPage() {
  return <Placeholder title="写作台" hint="对话流 · 沉漫阅读 · 工作台" task="Task 20+" />;
}

/** /library 资源库：角色卡/世界书/预设/正则 + 资源中心（Task 25） */
export function LibraryPage() {
  return <Placeholder title="资源库" hint="角色卡 · 世界书 · 预设 · 正则 · 资源中心" task="Task 25" />;
}

/** /settings：LLM 三通道 / TTS / 界面 / 旧数据迁移（Task 26+） */
export function SettingsPage() {
  return <Placeholder title="设置" hint="LLM 通道 · TTS · 界面 · 旧数据迁移" task="Task 26+" />;
}
