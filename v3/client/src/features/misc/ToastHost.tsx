/**
 * 全局 toast 渲染宿主（挂 App 根部）：订阅 lib/toast，右上角浮层自动消失。
 * 连写章节完成提示（notifyDone：文字+提示音）等非阻塞通知的统一出口。
 */
import { useSyncExternalStore } from 'react';

import { dismissToast, getToastSnapshot, subscribeToasts } from '../../lib/toast';

export default function ToastHost() {
  const items = useSyncExternalStore(subscribeToasts, getToastSnapshot, () => []);
  if (items.length === 0) return null;
  return (
    <div className="pointer-events-none fixed right-3 top-3 z-[70] flex flex-col gap-2" data-testid="toast-host">
      {items.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => dismissToast(t.id)}
          className="m-pop pointer-events-auto max-w-[86vw] rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] px-3.5 py-2.5 text-left text-xs leading-5 shadow-lg"
        >
          {t.text}
        </button>
      ))}
    </div>
  );
}
