/**
 * 书架页（设计 §7.1 /）：作品网格入口，登录后默认落地页
 *
 * 顶部导航（/library /settings 入口）属 Task 25/26+ 的全局布局，届时上移；
 * 当前页面保持纯书架内容，避免空链接。
 */
import Bookshelf from '../features/bookshelf/Bookshelf';

export default function RootPage() {
  return (
    <main className="safe-top safe-bottom min-h-screen bg-[hsl(var(--bg))] text-[hsl(var(--fg))]">
      <Bookshelf />
    </main>
  );
}
