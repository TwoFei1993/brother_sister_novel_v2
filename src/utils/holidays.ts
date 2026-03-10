// Chinese holidays and character birthdays
// Uses simple solar date checks; lunar holidays use approximate solar dates

interface HolidayInfo {
  name: string;
  greeting: string;
  emoji: string;
  bgClass: string; // CSS class for special background
  type: 'festival' | 'birthday';
}

// Approximate solar dates for lunar festivals (updated yearly ideally, using 2025-2027 ranges)
function getLunarHolidays(year: number): { month: number; day: number; info: HolidayInfo }[] {
  // Approximate dates - these shift yearly but we use common ranges
  const springFestivalDates: Record<number, [number, number]> = {
    2025: [1, 29], 2026: [2, 17], 2027: [2, 6],
  };
  const lanternDates: Record<number, [number, number]> = {
    2025: [2, 12], 2026: [3, 3], 2027: [2, 20],
  };
  const midAutumnDates: Record<number, [number, number]> = {
    2025: [10, 6], 2026: [9, 25], 2027: [9, 15],
  };
  const dragonBoatDates: Record<number, [number, number]> = {
    2025: [5, 31], 2026: [6, 19], 2027: [6, 9],
  };

  const holidays: { month: number; day: number; info: HolidayInfo }[] = [];

  const sf = springFestivalDates[year];
  if (sf) holidays.push({ month: sf[0], day: sf[1], info: { name: '春节', greeting: '新春快乐！兄妹同贺岁 🧧', emoji: '🧧', bgClass: 'holiday-spring', type: 'festival' } });

  const ln = lanternDates[year];
  if (ln) holidays.push({ month: ln[0], day: ln[1], info: { name: '元宵节', greeting: '元宵佳节，花灯如昼 🏮', emoji: '🏮', bgClass: 'holiday-lantern', type: 'festival' } });

  const ma = midAutumnDates[year];
  if (ma) holidays.push({ month: ma[0], day: ma[1], info: { name: '中秋节', greeting: '月圆人团圆，兄妹共婵娟 🌕', emoji: '🌕', bgClass: 'holiday-midautumn', type: 'festival' } });

  const db = dragonBoatDates[year];
  if (db) holidays.push({ month: db[0], day: db[1], info: { name: '端午节', greeting: '端午安康，龙舟竞渡 🐉', emoji: '🐉', bgClass: 'holiday-dragon', type: 'festival' } });

  return holidays;
}

const fixedHolidays: { month: number; day: number; info: HolidayInfo }[] = [
  // Character birthdays
  { month: 1, day: 29, info: { name: '哥哥生日', greeting: '今天是哥哥的生日！🎂 愿星辰守护你的每一次征途', emoji: '🎂', bgClass: 'holiday-birthday-brother', type: 'birthday' } },
  { month: 4, day: 5, info: { name: '妹妹生日', greeting: '今天是妹妹的生日！🎀 愿世间温柔都归于你', emoji: '🎀', bgClass: 'holiday-birthday-sister', type: 'birthday' } },
  // Solar holidays
  { month: 1, day: 1, info: { name: '元旦', greeting: '新年快乐！新的故事即将开启 ✨', emoji: '✨', bgClass: 'holiday-newyear', type: 'festival' } },
  { month: 5, day: 1, info: { name: '劳动节', greeting: '劳动节快乐！创作不停歇 💪', emoji: '💪', bgClass: 'holiday-labor', type: 'festival' } },
  { month: 10, day: 1, info: { name: '国庆节', greeting: '国庆节快乐！🇨🇳', emoji: '🇨🇳', bgClass: 'holiday-national', type: 'festival' } },
  { month: 12, day: 22, info: { name: '冬至', greeting: '冬至大如年，兄妹共团圆 ❄️', emoji: '❄️', bgClass: 'holiday-winter', type: 'festival' } },
];

export function getTodayHoliday(): HolidayInfo | null {
  const now = new Date();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const year = now.getFullYear();

  // Check fixed holidays (allow ±1 day for flexibility)
  for (const h of fixedHolidays) {
    if (h.month === month && Math.abs(h.day - day) <= 0) {
      return h.info;
    }
  }

  // Check lunar holidays (allow ±1 day)
  const lunarHolidays = getLunarHolidays(year);
  for (const h of lunarHolidays) {
    if (h.month === month && Math.abs(h.day - day) <= 0) {
      return h.info;
    }
  }

  return null;
}
