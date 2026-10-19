/**
 * 界面偏好面板：全局皮肤选择（第二轮体验改进）
 *
 * - 「跟随作品题材」（默认，存 null）+ 6 个固定主题（lib/theme.ts USER_THEME_OPTIONS）
 * - 选择持久化 settingsStore.uiTheme（localStorage v3-llm-prefs，version 2 迁移）
 * - App 级 GlobalTheme 同步 <html data-theme>；固定主题优先级高于作品题材主题
 */
import { useSettingsStore } from '../../stores/settings';
import { USER_THEME_OPTIONS } from '../../lib/theme';

const followBtnCls = (active: boolean): string =>
  `min-h-[44px] w-full rounded-lg border px-4 text-left text-sm transition-colors ${
    active
      ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent))]/15 font-medium text-[hsl(var(--accent))]'
      : 'border-[hsl(var(--border-soft))] text-[hsl(var(--fg))] hover:border-[hsl(var(--accent))]'
  }`;

/** 色板预览：底色大圆 + 强调色小圆叠放（静态任意值类，主题无关） */
function Swatch({ bg, accent }: { bg: string; accent: string }) {
  return (
    <span aria-hidden="true" className="relative inline-block h-6 w-6 shrink-0 align-middle">
      <span className={`absolute inset-0 rounded-full border border-black/20 bg-[hsl(${bg})]`} />
      <span className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border border-black/10 bg-[hsl(${accent})]`} />
    </span>
  );
}

export default function ThemePanel() {
  const uiTheme = useSettingsStore((s) => s.uiTheme);
  const setUiTheme = useSettingsStore((s) => s.setUiTheme);

  return (
    <section aria-label="界面偏好" className="flex flex-col gap-4">
      <div className="rounded-2xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] p-5">
        <h3 className="mb-1 text-base font-semibold">界面主题</h3>
        <p className="mb-4 text-sm text-[hsl(var(--fg-muted))]">
          默认跟随作品题材换肤（进入作品时按题材应用）。选定固定主题后全局生效，不再随作品切换。
        </p>

        <button
          type="button"
          aria-pressed={uiTheme === null}
          data-testid="theme-follow"
          onClick={() => setUiTheme(null)}
          className={followBtnCls(uiTheme === null)}
        >
          跟随作品题材（默认）
        </button>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {USER_THEME_OPTIONS.map((opt) => {
            const active = uiTheme === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                aria-pressed={active}
                data-testid={`theme-${opt.value}`}
                onClick={() => setUiTheme(opt.value)}
                className={`flex min-h-[56px] flex-col items-start justify-center gap-1 rounded-lg border px-3 py-2 text-left transition-colors ${
                  active
                    ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent))]/15'
                    : 'border-[hsl(var(--border-soft))] hover:border-[hsl(var(--accent))]'
                }`}
              >
                <span className="flex items-center gap-2 text-sm font-medium text-[hsl(var(--fg))]">
                  <Swatch bg={opt.swatch.bg} accent={opt.swatch.accent} />
                  {opt.label}
                </span>
                {active && (
                  <span className="text-xs text-[hsl(var(--accent))]">使用中</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <p className="text-xs leading-5 text-[hsl(var(--fg-muted))]">
        阅读字号/行高在写作台的阅读视图内调整；界面主题即时生效并保存在本设备（刷新后保持）。
      </p>
    </section>
  );
}
