import React, { useState, useEffect } from 'react';
import { getTodayHoliday } from '@/utils/holidays';
import { X } from 'lucide-react';

export function HolidayBanner() {
  const [holiday, setHoliday] = useState(getTodayHoliday());
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const key = `holiday_dismissed_${new Date().toDateString()}`;
    if (localStorage.getItem(key)) setDismissed(true);
  }, []);

  if (!holiday || dismissed) return null;

  const dismiss = () => {
    localStorage.setItem(`holiday_dismissed_${new Date().toDateString()}`, '1');
    setDismissed(true);
  };

  const bgColors: Record<string, string> = {
    'holiday-spring': 'from-red-900/80 to-yellow-900/60',
    'holiday-lantern': 'from-orange-900/80 to-red-900/60',
    'holiday-midautumn': 'from-indigo-900/80 to-purple-900/60',
    'holiday-dragon': 'from-green-900/80 to-teal-900/60',
    'holiday-birthday-brother': 'from-blue-900/80 to-cyan-900/60',
    'holiday-birthday-sister': 'from-pink-900/80 to-rose-900/60',
    'holiday-newyear': 'from-amber-900/80 to-yellow-900/60',
    'holiday-labor': 'from-emerald-900/80 to-green-900/60',
    'holiday-national': 'from-red-900/80 to-orange-900/60',
    'holiday-winter': 'from-sky-900/80 to-blue-900/60',
  };

  const bg = bgColors[holiday.bgClass] || 'from-primary/20 to-accent/20';

  return (
    <div className={`relative bg-gradient-to-r ${bg} border-b border-border px-4 py-2 flex items-center justify-center gap-2 text-sm`}>
      {holiday.type === 'birthday' && (
        <span className="absolute left-0 top-0 w-full h-full overflow-hidden pointer-events-none">
          {Array.from({ length: 8 }).map((_, i) => (
            <span
              key={i}
              className="absolute text-lg animate-bounce"
              style={{
                left: `${10 + i * 12}%`,
                top: `${Math.random() * 60}%`,
                animationDelay: `${i * 0.2}s`,
                animationDuration: `${1.5 + Math.random()}s`,
              }}
            >
              {holiday.emoji}
            </span>
          ))}
        </span>
      )}
      <span className="text-lg">{holiday.emoji}</span>
      <span className="font-heading text-foreground">{holiday.greeting}</span>
      <button onClick={dismiss} className="ml-2 text-muted-foreground hover:text-foreground transition-colors">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
