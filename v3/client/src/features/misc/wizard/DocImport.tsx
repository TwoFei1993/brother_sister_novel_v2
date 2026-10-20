/**
 * 向导「导入 Word」组件：选 .docx 走服务端提取（/api/extract/docx），
 * .txt 浏览器直读纯文本；提取结果经 onText 回填粘贴框，后续规则/AI 抽取管线全复用。
 * 已有内容时覆盖前 confirm 防误触丢稿；按钮 min-h-36px 满足移动端触控。
 */
import { useRef, useState } from 'react';

import { extractDocx } from '../../../api/extract';

type DocImportProps = {
  /** 粘贴框已有内容：覆盖前先 confirm */
  hasContent: boolean;
  /** 提取成功：text 回填粘贴框 */
  onText: (text: string) => void;
};

const CONFIRM_OVERWRITE = '粘贴框已有内容，导入将覆盖现有内容，是否继续？';

export default function DocImport({ hasContent, onText }: DocImportProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [imported, setImported] = useState('');

  const handleFile = async (file: File): Promise<void> => {
    if (hasContent && !window.confirm(CONFIRM_OVERWRITE)) return;
    setBusy(true);
    setError('');
    try {
      const lower = file.name.toLowerCase();
      const text = lower.endsWith('.txt')
        ? await file.text()
        : lower.endsWith('.docx')
          ? (await extractDocx(file)).text
          : null;
      if (text === null) {
        setError('仅支持 .docx 或 .txt 文件');
        return;
      }
      if (text.trim() === '') {
        setError('文档中没有可提取的文字内容');
        return;
      }
      setImported(file.name);
      onText(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : '文档解析失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        ref={inputRef}
        type="file"
        accept=".docx,.txt"
        aria-label="选择要导入的 Word 文档"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = ''; // 允许重复选择同一文件
          if (file) void handleFile(file);
        }}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className="min-h-[36px] rounded-lg border border-[hsl(var(--border-soft))] px-3 text-sm transition-colors hover:border-[hsl(var(--accent))] disabled:opacity-40"
      >
        {busy ? '解析中…' : '导入 Word'}
      </button>
      {imported && !busy && (
        <span className="max-w-full truncate text-xs text-[hsl(var(--fg-muted))]">已导入：{imported}</span>
      )}
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  );
}
