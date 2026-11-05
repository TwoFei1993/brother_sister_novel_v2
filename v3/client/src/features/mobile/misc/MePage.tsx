/**
 * 移动「我的」（/m/me）：界面偏好（主题）+ 账号（退出登录）
 *
 * Phase1 先放最小可用集；LLM 参数等完整设置项沿用桌面 /settings（共识：设置内容全部归「我的」，
 * 移动端逐步补齐入口）。
 */
import { Link } from 'react-router-dom';
import { Brain, Gauge } from 'lucide-react';

import { useLogout } from '../../../hooks/useLogout';
import { displayNameOf, useAuthStore } from '../../../stores/auth';
import { useSettingsStore } from '../../../stores/settings';

// 无独立导入：llmPrefs/thinking 走 settingsStore（与桌面 LlmPanel 同一状态源）

const THEMES = [
  { id: 'm-ink', label: '墨玉 · 夜' },
  { id: 'm-paper', label: '宣纸 · 昼' },
] as const;

/** 速度优先候选模型（实测当前推理通道 ~19 字/秒；非推理轻量模型通常快 3-5 倍——
 *  以服务商模型列表为准，此处是常用快捷候选 + 可自定义输入） */
const FAST_MODELS = ['MiniMax-Text-01', 'MiniMax-M3.1-Flash', 'abab6.5s-chat'];

export default function MePage() {
  const uiTheme = useSettingsStore((s) => s.uiTheme);
  const setUiTheme = useSettingsStore((s) => s.setUiTheme);
  const thinkingOn = useSettingsStore((s) => s.llmPrefs.thinking !== false);
  const setLlmPrefs = useSettingsStore((s) => s.setLlmPrefs);
  const currentModel = useSettingsStore((s) => s.llmPrefs.model);
  const user = useAuthStore((s) => s.user);
  const logout = useLogout();
  const isReader = user?.role === 'reader';

  return (
    <div className="mx-auto max-w-2xl px-4 pb-4 pt-4">
      <div className="mb-3">
        <p className="m-serif text-[11px] tracking-[0.5em] text-[hsl(var(--fg-muted))]">書 房</p>
        <h1 className="m-serif mt-0.5 text-2xl font-semibold leading-tight">我的</h1>
      </div>

      {/* 身份卡（P3.1） */}
      <section className="m-book-card mb-3 p-4 pl-5" data-testid="me-identity">
        <p className="m-serif text-base font-semibold">{displayNameOf(user)}</p>
        <p className="mt-0.5 text-xs text-[hsl(var(--fg-muted))]">
          {user ? (user.role === 'author' ? '作者 · 全部权限' : '读者 · 阅读 / 评论 / 留言') : '未登录'}
        </p>
      </section>

      {/* 💭 思考模式开关（生成速度/质量权衡，高频需求） */}
      <section className="mb-3 rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] p-4" data-testid="thinking-toggle-card">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold">
              <Brain className="h-4 w-4" aria-hidden />
              深度思考模式
            </h2>
            <p className="mt-0.5 text-xs leading-5 text-[hsl(var(--fg-muted))]">
              开：模型先推理再写作，质量高但每章约 2-4 分钟且多耗 token
              <br />
              关：直接写作，速度快约一半
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={thinkingOn}
            data-testid="thinking-switch"
            onClick={() => setLlmPrefs({ thinking: !thinkingOn })}
            className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
              thinkingOn ? 'bg-[hsl(var(--accent))]' : 'bg-[hsl(var(--fg-muted))]/30'
            }`}
          >
            <span
              className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${
                thinkingOn ? 'left-6' : 'left-1'
              }`}
            />
          </button>
        </div>
      </section>

      {!isReader && (
        <>
          {/* ⚡ 生成提速建议（实测归因：输出速度是硬瓶颈 ~19字/秒；换快模型是最大杠杆） */}
          <section className="mb-3 rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] p-4" data-testid="speed-card">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold">
              <Gauge className="h-4 w-4" aria-hidden />
              生成提速
            </h2>
            <p className="mt-1 text-xs leading-5 text-[hsl(var(--fg-muted))]">
              实测当前通道约 19 字/秒——换非推理轻量模型通常快 3-5 倍；配合「关思考 + 调小每章目标字数」效果最佳。
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {FAST_MODELS.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setLlmPrefs({ model: m })}
                  data-testid={`speed-model-${m}`}
                  className={`rounded-full border px-2.5 py-1 text-[11px] ${
                    currentModel === m
                      ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent))]/10 text-[hsl(var(--accent))]'
                      : 'border-[hsl(var(--border-soft))] text-[hsl(var(--fg-muted))]'
                  }`}
                >
                  {m}
                  {m === 'MiniMax-Text-01' ? '（快）' : ''}
                </button>
              ))}
            </div>
            <input
              value={currentModel ?? ''}
              onChange={(e) => setLlmPrefs({ model: e.target.value })}
              placeholder="或直接输入服务商模型名"
              data-testid="speed-model-input"
              className="mt-2 h-8 w-full rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-2 text-xs outline-none focus:border-[hsl(var(--accent))]"
            />
            <p className="mt-1 text-[11px] text-[hsl(var(--fg-muted))]">每章目标字数在书内「资料」分区调整；思考开关在上方与正文分区均有。</p>
          </section>

          <section className="mb-3 rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] p-4">
            <h2 className="mb-2 text-sm font-semibold">界面偏好</h2>
          <div className="flex gap-2">
            {THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                data-testid={`theme-${t.id}`}
                onClick={() => setUiTheme(t.id)}
                className={`h-9 flex-1 rounded-lg border text-xs ${
                  uiTheme === t.id
                    ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent))]/10 text-[hsl(var(--accent))]'
                    : 'border-[hsl(var(--border-soft))] text-[hsl(var(--fg-muted))]'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </section>

          <section className="mb-3 rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] p-4">
            <h2 className="mb-2 text-sm font-semibold">创作工具</h2>
          <div className="flex flex-col divide-y divide-[hsl(var(--border-soft))]">
            <Link to="/library" data-testid="me-library-link" className="flex items-center justify-between py-2.5 text-sm">
              资料库（角色卡 / 世界书 / 预设 / 正则）
              <span className="text-xs text-[hsl(var(--fg-muted))]">›</span>
            </Link>
            <Link to="/planner" data-testid="me-planner-link" className="flex items-center justify-between py-2.5 text-sm">
              AI 创作助手（对话大纲策划向导）
              <span className="text-xs text-[hsl(var(--fg-muted))]">›</span>
            </Link>
            <Link to="/settings" className="flex items-center justify-between py-2.5 text-sm">
              完整设置（模型参数 / TTS / 预设）
              <span className="text-xs text-[hsl(var(--fg-muted))]">›</span>
            </Link>
          </div>
          </section>
        </>
      )}

      <button
        type="button"
        data-testid="mobile-logout-btn"
        onClick={() => void logout()}
        className="h-11 w-full rounded-xl border border-[hsl(var(--danger))]/40 text-sm text-[hsl(var(--danger))]"
      >
        退出登录
      </button>
    </div>
  );
}
