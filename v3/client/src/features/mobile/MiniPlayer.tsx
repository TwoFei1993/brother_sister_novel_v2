/**
 * 悬浮听书小窗（番茄式，反馈⑦）：退出阅读页后，右下角小钮继续播；点开=展开控制卡。
 *
 * - 小钮：书名首字渐变圆钮 + 播放中呼吸点；点开/收起展开卡
 * - 展开卡：书名 · 第 x/y 段 + ⏯（暂停/继续）+ ⏹（停止）+「回到书」（进书页并定位该段）
 * - 阅读页内不显示（书页有自己的控制）；播放结束/停止自动消失
 */
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { playerPause, playerResume, playerStop, usePlayerSnapshot } from '../../lib/tts/tts-player';

export default function MiniPlayer() {
  const snap = usePlayerSnapshot();
  const loc = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  // 阅读页内不显示（页内有完整控制）；无书时消失
  if (!snap.bookId || loc.pathname.startsWith('/m/read/')) return null;

  const firstChar = snap.title.slice(0, 1) || '书';

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="展开听书控制"
        data-testid="mini-player-btn"
        className="m-press fixed bottom-24 right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-[hsl(var(--accent))] text-lg font-medium text-[hsl(var(--accent-fg))] shadow-lg"
      >
        {firstChar}
        {snap.playing && (
          <span className="absolute -right-0.5 -top-0.5 h-3 w-3 animate-pulse rounded-full border-2 border-[hsl(var(--bg))] bg-emerald-400" />
        )}
      </button>
    );
  }

  return (
    <div
      className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))]/95 px-4 pb-3 pt-3 backdrop-blur-sm"
      data-testid="mini-player"
    >
      <div className="mx-auto flex max-w-2xl items-center gap-3">
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-base text-white/80"
          style={{ background: 'linear-gradient(160deg, hsl(0 0% 30%), hsl(0 0% 15%))' }}
        >
          {firstChar}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{snap.title}</p>
          <p className="text-xs text-[hsl(var(--fg-muted))]" data-testid="mini-player-progress">
            {snap.idx >= 0 ? `第 ${snap.idx + 1}/${snap.paraCount} 段` : '准备中…'} · {snap.speed}x
          </p>
        </div>
        {snap.playing ? (
          <button
            type="button"
            onClick={playerPause}
            aria-label="暂停听书"
            data-testid="mini-pause"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[hsl(var(--border-soft))] text-sm"
          >
            ⏸
          </button>
        ) : (
          <button
            type="button"
            onClick={playerResume}
            aria-label="继续听书"
            data-testid="mini-resume"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--accent))] text-sm text-[hsl(var(--accent-fg))]"
          >
            ▶
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            playerStop();
            setOpen(false);
          }}
          aria-label="停止听书"
          data-testid="mini-stop"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[hsl(var(--danger))]/40 text-sm text-[hsl(var(--danger))]"
        >
          ⏹
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            navigate(`/m/read/${snap.bookId}`);
          }}
          data-testid="mini-open-book"
          className="h-10 shrink-0 rounded-xl border border-[hsl(var(--border-soft))] px-3 text-xs"
        >
          回到书
        </button>
      </div>
    </div>
  );
}
