/**
 * 设置页（设计 §7.1 /settings）：分区导航 = LLM 接入 / TTS / 旧站迁移 / 界面偏好
 *
 * - LLM 接入：三通道密钥 + 默认生成参数（SecretsPanel / LlmPanel）
 * - TTS：easyvoice 地址与连通性（TtsPanel）
 * - 旧站迁移：localStorage novel_history → 新站作品（MigratePanel，Task 31）
 * - 界面偏好：全局皮肤选择（ThemePanel，跟随作品题材或 6 个固定主题）
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';

import LlmPanel from '../features/settings/LlmPanel';
import MigratePanel from '../features/settings/MigratePanel';
import SecretsPanel from '../features/settings/SecretsPanel';
import ThemePanel from '../features/settings/ThemePanel';
import TtsPanel from '../features/settings/TtsPanel';

type SectionId = 'llm' | 'tts' | 'migrate' | 'ui';

const SECTIONS: ReadonlyArray<{ id: SectionId; label: string }> = [
  { id: 'llm', label: 'LLM 接入' },
  { id: 'tts', label: 'TTS' },
  { id: 'migrate', label: '旧站迁移' },
  { id: 'ui', label: '界面偏好' },
];

export default function SettingsPage() {
  const [section, setSection] = useState<SectionId>('llm');

  return (
    <main className="safe-top safe-bottom mx-auto min-h-screen w-full max-w-2xl bg-[hsl(var(--bg))] px-4 pb-16 text-[hsl(var(--fg))]">
      <header className="mb-4 flex items-center gap-3 pt-2">
        <Link
          to="/"
          aria-label="返回书架"
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-[hsl(var(--border-soft))] text-lg transition-colors hover:border-[hsl(var(--accent))]"
        >
          ←
        </Link>
        <h1 className="text-xl font-semibold">设置</h1>
      </header>

      <nav
        aria-label="设置分区"
        className="mb-5 flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            aria-current={section === s.id ? 'true' : undefined}
            onClick={() => setSection(s.id)}
            className={`min-h-[36px] shrink-0 whitespace-nowrap rounded-lg border px-3 text-sm transition-colors ${
              section === s.id
                ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent))]/15 font-medium text-[hsl(var(--accent))]'
                : 'border-[hsl(var(--border-soft))] text-[hsl(var(--fg-muted))] hover:border-[hsl(var(--accent))]'
            }`}
          >
            {s.label}
          </button>
        ))}
      </nav>

      {section === 'llm' && (
        <div className="flex flex-col gap-4">
          <SecretsPanel />
          <LlmPanel />
        </div>
      )}
      {section === 'tts' && <TtsPanel />}
      {section === 'migrate' && <MigratePanel />}
      {section === 'ui' && <ThemePanel />}
    </main>
  );
}
