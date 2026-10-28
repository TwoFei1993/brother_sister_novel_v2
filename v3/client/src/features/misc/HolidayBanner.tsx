/**
 * 节日彩蛋横幅（Task 32，交互移植旧站 HolidayBanner + utils/holidays 精简内嵌）：
 * 当日命中节日/角色生日时顶部展示，关闭后当日不再出现（localStorage 按日期记 dismiss）。
 * 农历节日用逐年核对的经验阳历日期表（2025-2027）。
 * 挂载点由协调者统一接入（如 RootPage 顶部）。
 */
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';

interface HolidayInfo {
  name: string;
  greeting: string;
  emoji: string;
  /** 横幅渐变配色（Tailwind from/to 类名） */
  bg: string;
  type: 'festival' | 'birthday';
}

/** 农历节日的经验阳历日期（逐年表，2025-2027） */
const LUNAR_DATES: Readonly<Record<number, ReadonlyArray<{ m: number; d: number; info: HolidayInfo }>>> = {
  2025: [
    { m: 1, d: 29, info: { name: '春节', greeting: '新春快乐！兄妹同贺岁', emoji: '🧧', bg: 'from-red-900/80 to-yellow-900/60', type: 'festival' } },
    { m: 2, d: 12, info: { name: '元宵节', greeting: '元宵佳节，花灯如昼', emoji: '🏮', bg: 'from-orange-900/80 to-red-900/60', type: 'festival' } },
    { m: 5, d: 31, info: { name: '端午节', greeting: '端午安康，龙舟竞渡', emoji: '🐉', bg: 'from-green-900/80 to-teal-900/60', type: 'festival' } },
    { m: 10, d: 6, info: { name: '中秋节', greeting: '月圆人团圆，兄妹共婵娟', emoji: '🌕', bg: 'from-indigo-900/80 to-purple-900/60', type: 'festival' } },
  ],
  2026: [
    { m: 2, d: 17, info: { name: '春节', greeting: '新春快乐！兄妹同贺岁', emoji: '🧧', bg: 'from-red-900/80 to-yellow-900/60', type: 'festival' } },
    { m: 3, d: 3, info: { name: '元宵节', greeting: '元宵佳节，花灯如昼', emoji: '🏮', bg: 'from-orange-900/80 to-red-900/60', type: 'festival' } },
    { m: 6, d: 19, info: { name: '端午节', greeting: '端午安康，龙舟竞渡', emoji: '🐉', bg: 'from-green-900/80 to-teal-900/60', type: 'festival' } },
    { m: 9, d: 25, info: { name: '中秋节', greeting: '月圆人团圆，兄妹共婵娟', emoji: '🌕', bg: 'from-indigo-900/80 to-purple-900/60', type: 'festival' } },
  ],
  2027: [
    { m: 2, d: 6, info: { name: '春节', greeting: '新春快乐！兄妹同贺岁', emoji: '🧧', bg: 'from-red-900/80 to-yellow-900/60', type: 'festival' } },
    { m: 2, d: 20, info: { name: '元宵节', greeting: '元宵佳节，花灯如昼', emoji: '🏮', bg: 'from-orange-900/80 to-red-900/60', type: 'festival' } },
    { m: 6, d: 9, info: { name: '端午节', greeting: '端午安康，龙舟竞渡', emoji: '🐉', bg: 'from-green-900/80 to-teal-900/60', type: 'festival' } },
    { m: 9, d: 15, info: { name: '中秋节', greeting: '月圆人团圆，兄妹共婵娟', emoji: '🌕', bg: 'from-indigo-900/80 to-purple-900/60', type: 'festival' } },
  ],
};

/** 阳历固定节日与角色生日 */
const FIXED_HOLIDAYS: ReadonlyArray<{ m: number; d: number; info: HolidayInfo }> = [
  { m: 1, d: 29, info: { name: '哥哥生日', greeting: '今天是哥哥的生日！愿星辰守护你的每一次征途', emoji: '🎂', bg: 'from-blue-900/80 to-cyan-900/60', type: 'birthday' } },
  { m: 4, d: 5, info: { name: '妹妹生日', greeting: '今天是妹妹的生日！愿世间温柔都归于你', emoji: '🎀', bg: 'from-pink-900/80 to-rose-900/60', type: 'birthday' } },
  { m: 1, d: 1, info: { name: '元旦', greeting: '新年快乐！新的故事即将开启', emoji: '✨', bg: 'from-amber-900/80 to-yellow-900/60', type: 'festival' } },
  { m: 5, d: 1, info: { name: '劳动节', greeting: '劳动节快乐！创作不停歇', emoji: '💪', bg: 'from-emerald-900/80 to-green-900/60', type: 'festival' } },
  { m: 10, d: 1, info: { name: '国庆节', greeting: '国庆节快乐！山河无恙', emoji: '🇨🇳', bg: 'from-red-900/80 to-orange-900/60', type: 'festival' } },
  { m: 12, d: 22, info: { name: '冬至', greeting: '冬至大如年，兄妹共团圆', emoji: '❄️', bg: 'from-sky-900/80 to-blue-900/60', type: 'festival' } },
];

/** 命中今日的节日（无则 null；供测试与外部复用） */
export function getTodayHoliday(now: Date = new Date()): HolidayInfo | null {
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const year = now.getFullYear();
  const all = [...(LUNAR_DATES[year] ?? []), ...FIXED_HOLIDAYS];
  return all.find((h) => h.m === month && h.d === day)?.info ?? null;
}

/** 当日 dismiss 存储（键按日期，次日自动失效） */
function dismissKey(now: Date = new Date()): string {
  return `v3-holiday-dismissed_${now.toDateString()}`;
}

export default function HolidayBanner() {
  const [holiday] = useState(() => getTodayHoliday());
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(dismissKey())) setDismissed(true);
    } catch {
      // 存储不可用（隐私模式）时每次进页都展示
    }
  }, []);

  if (!holiday || dismissed) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(dismissKey(), '1');
    } catch {
      // 同上，仅会话内生效
    }
    setDismissed(true);
  };

  return (
    <div
      className={`relative flex items-center justify-center gap-2 border-b border-[hsl(var(--border-soft))] bg-gradient-to-r px-4 py-2 text-sm ${holiday.bg}`}
    >
      {holiday.type === 'birthday' && (
        <span aria-hidden className="pointer-events-none absolute left-0 top-0 h-full w-full overflow-hidden">
          {Array.from({ length: 8 }).map((_, i) => (
            <span
              key={i}
              className="absolute animate-bounce text-lg"
              style={{
                left: `${10 + i * 12}%`,
                top: `${(i % 4) * 15}%`,
                animationDelay: `${i * 0.2}s`,
                animationDuration: `${1.5 + (i % 3) * 0.5}s`,
              }}
            >
              {holiday.emoji}
            </span>
          ))}
        </span>
      )}
      <span className="text-base">{holiday.emoji}</span>
      <span className="font-heading text-[hsl(var(--fg))]">{holiday.greeting}</span>
      <button
        type="button"
        onClick={dismiss}
        aria-label="关闭节日横幅"
        className="ml-2 flex h-9 w-9 items-center justify-center rounded text-[hsl(var(--fg-muted))] transition-colors hover:bg-black/10 hover:text-[hsl(var(--fg))]"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
