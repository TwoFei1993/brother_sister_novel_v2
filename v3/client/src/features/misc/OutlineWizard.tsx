/**
 * 大纲向导（最小版，Task 32）：粘贴网文大纲 → 正则抽取预览（人物/背景/势力/矛盾）→
 * 一键导入角色卡+世界书（反馈①：不跳转，就地展示成功清单）。路由 /wizard（App.tsx）。
 * LLM 兜底：效果不佳时可切换 AI 结构化解析（lib/outline/llm），解析失败自动修复重试
 * 一次（反馈③）；展板形态走 SheetImportPanel 复用；章节大纲识别走 ChapterOutlineImport
 * （一键开写，反馈⑥：携带已建资产 ids，作品已存在时自动 PATCH 绑定）。
 */
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import {
  buildCharacterSheetPrompt,
  buildOutlinePrompt,
  countSuspectEntryHeads,
  estimateTokenKilo,
  llmExtract,
  outlineFromLlm,
  repairJson,
  sheetEntriesFromLlm,
  shouldFallbackToLLM,
} from '../../lib/outline/llm';
import { parseSheetDocument, type SheetDocument } from '../../lib/outline/sheet';
import { extractFromOutline, type ExtractedOutline } from '../../lib/outline/wizard';
import { suggestBookTitles } from '../../lib/export';
import { useSettingsStore } from '../../stores/settings';
import SheetImportPanel from './wizard/SheetImportPanel';
import OutlinePreview from './wizard/OutlinePreview';
import ChapterOutlineImport from './wizard/ChapterOutlineImport';
import DocImport from './wizard/DocImport';
import { useWizardImports } from './wizard/useWizardImports';
import { writeCreatedWorkId } from './wizard/importAll';
import { AiErrorBox, AiRetryHint, AiSourceSwitch, LlmFallbackBar, type AiErrorState } from './wizard/LlmFallback';

type Toast = { kind: 'ok' | 'err'; text: string } | null;

/** 向导草稿持久化（深度测试 D9：刷新后粘贴内容丢失）——输入即写、成功导入即清 */
const WIZARD_DRAFT_KEY = 'v3-wizard-draft';

function loadDraft(): { outline: string; sheet: SheetDocument | null } {
  try {
    const outline = localStorage.getItem(WIZARD_DRAFT_KEY) ?? '';
    if (!outline.trim()) return { outline: '', sheet: null };
    const doc = parseSheetDocument(outline);
    return { outline, sheet: doc.entries.length >= 3 ? doc : null };
  } catch {
    return { outline: '', sheet: null };
  }
}

function clearDraft(): void {
  try {
    localStorage.removeItem(WIZARD_DRAFT_KEY);
  } catch {
    /* 存储不可用时静默（草稿仅为体验优化） */
  }
}

export default function OutlineWizard() {
  const navigate = useNavigate(); // 展板批量导入成功后的既有跳转（反馈①仅改抽取预览区路径）
  const initial = useMemo(loadDraft, []);
  const [outline, setOutline] = useState(initial.outline);
  const [ruleResult, setRuleResult] = useState<ExtractedOutline | null>(null);
  const [llmResult, setLlmResult] = useState<ExtractedOutline | null>(null);
  const [ruleSheet, setRuleSheet] = useState<SheetDocument | null>(initial.sheet);
  const [llmSheet, setLlmSheet] = useState<SheetDocument | null>(null);
  const [source, setSource] = useState<'rule' | 'llm'>('rule');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<AiErrorState | null>(null);
  const [toast, setToast] = useState<Toast>(null);

  const llmPrefs = useSettingsStore((s) => s.llmPrefs);

  // 派生：当前生效结果（来源可切换对比——规则 / AI）
  const extracted = source === 'llm' && llmResult ? llmResult : ruleResult;
  const sheet = source === 'llm' && llmSheet ? llmSheet : ruleSheet;

  const titles = useMemo(() => (extracted ? suggestBookTitles(outline) : []), [extracted, outline]);

  // 兜底判定（规则优先）：规则要素过少且文本够长，或展板变体疑似条目未被识别
  const suspectHeads = useMemo(() => countSuspectEntryHeads(outline), [outline]);
  const ruleCount = ruleResult
    ? ruleResult.characters.length + (ruleResult.background ? 1 : 0) + (ruleResult.conflict ? 1 : 0)
    : 0;
  const fallbackNeeded =
    ruleResult !== null && !llmResult &&
    shouldFallbackToLLM(ruleCount, outline.length, suspectHeads, Boolean(ruleResult.background));
  /** 展板形态（规则 sheet 已识别 或 疑似展板变体）→ AI 走展板 prompt；否则普通大纲 prompt */
  const useSheetPrompt = ruleSheet !== null || suspectHeads >= 3;
  const tokenHint = estimateTokenKilo(outline.length);

  const notify = (kind: 'ok' | 'err', text: string) => setToast({ kind, text });

  // 反馈①⑥：资产导入编排（一键导入不跳转 + ids 累计供创建作品自动绑定）
  const { busy, assets, importState, importAll, createCards, createWorldbookOnly, recordCreated } =
    useWizardImports(notify, clearDraft);

  /** 粘贴即探测：编号展板条目 ≥3 → 批量人设导入模式；否则保留旧抽取路径（草稿同步 localStorage） */
  const onOutlineChange = (value: string) => {
    setOutline(value);
    setRuleResult(null);
    setLlmResult(null);
    setLlmSheet(null);
    setSource('rule');
    setAiError(null);
    const doc = parseSheetDocument(value);
    setRuleSheet(doc.entries.length >= 3 ? doc : null);
    try {
      localStorage.setItem(WIZARD_DRAFT_KEY, value);
    } catch {
      /* 超配额/隐私模式静默 */
    }
  };

  const onExtract = () => {
    const out = extractFromOutline(outline);
    setRuleResult(out);
    setSource('rule');
    const found = out.characters.length + (out.background ? 1 : 0) + (out.conflict ? 1 : 0);
    notify(found > 0 ? 'ok' : 'err', found > 0 ? `识别出 ${out.characters.length} 位人物及设定要素` : '未识别出有效要素，请检查大纲格式（如"哥哥（名字）：特质"）');
  };

  /** AI 解析（LLM 兜底）：成功后与规则结果并存，可切换对比；解析失败自动修复重试一次，仍失败保留 raw 供排查 */
  const runAiExtract = async (): Promise<void> => {
    if (aiLoading || !outline.trim()) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const prompt = useSheetPrompt ? buildCharacterSheetPrompt(outline) : buildOutlinePrompt(outline);
      let { parsed, raw } = await llmExtract(outline, prompt, llmPrefs);
      if (parsed === null && raw.trim()) {
        parsed = await repairJson(raw, llmPrefs); // 坏 JSON 自动修复（temperature 0，重试一次）
      }
      if (parsed === null) {
        setAiError({ message: '返回内容无法解析为结构化 JSON（自动修复仍未成功），可重试或检查模型配置', raw });
        return;
      }
      if (useSheetPrompt) {
        const entries = sheetEntriesFromLlm(parsed);
        if (entries.length === 0) {
          setAiError({ message: '解析结果中没有可用的角色条目', raw });
          return;
        }
        setLlmSheet({ entries, meta: { negative: '', template: '' } });
        setSource('llm');
        notify('ok', `AI 解析完成：识别 ${entries.length} 位角色`);
      } else {
        const out = outlineFromLlm(parsed);
        if (!out) {
          setAiError({ message: '解析结果为空', raw });
          return;
        }
        setLlmResult(out);
        setSource('llm');
        notify('ok', `AI 解析完成：识别 ${out.characters.length} 位人物及设定要素`);
      }
    } catch (err) {
      setAiError({ message: err instanceof Error ? err.message : 'AI 解析请求失败', raw: '' });
    } finally {
      setAiLoading(false);
    }
  };

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
        <h1 className="text-xl font-semibold">大纲向导</h1>
        <span className="text-xs text-[hsl(var(--fg-muted))]">粘贴大纲，一键生成角色卡与世界书草稿</span>
      </header>

      {toast && (
        <div
          role="status"
          className={`mb-4 rounded-lg border px-3 py-2 text-sm ${
            toast.kind === 'ok'
              ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-500'
              : 'border-red-400/40 bg-red-400/10 text-red-400'
          }`}
        >
          {toast.text}
        </div>
      )}

      <section className="mb-4">
        <textarea
          aria-label="大纲文本"
          value={outline}
          onChange={(e) => onOutlineChange(e.target.value)}
          placeholder={'粘贴网文大纲或「编号人设展板」文档，例如：\n一、故事背景：灵气复苏的大周王朝…\n哥哥（林昭）：天赋觉醒古龙血脉，性格沉稳…\n——或——\n01. 沈清晏｜镇国公府嫡长女（女主）\n正向 prompt：\n…（批量人设将自动识别）'}
          rows={10}
          className="w-full rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] p-3 text-sm leading-relaxed outline-none focus:border-[hsl(var(--accent))]"
        />
        {!sheet && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onExtract}
              disabled={!outline.trim()}
              data-testid="extract-btn"
              className="min-h-[36px] rounded-lg bg-[hsl(var(--accent))] px-4 text-sm font-medium text-white disabled:opacity-40"
            >
              智能抽取
            </button>
            <DocImport hasContent={outline.trim() !== ''} onText={onOutlineChange} />
          </div>
        )}
      </section>

      <ChapterOutlineImport
        outline={outline}
        suggestedTitle={titles[0] ?? ''}
        characterIds={assets.characterIds}
        worldbookIds={assets.worldbookIds}
        onCreated={writeCreatedWorkId}
      />

      {!sheet && ruleResult !== null && (
        <div className="mb-3 flex flex-col gap-2">
          {fallbackNeeded && <LlmFallbackBar ruleCount={ruleCount} tokenHint={tokenHint} loading={aiLoading} onRun={() => void runAiExtract()} />}
          {!fallbackNeeded && <AiRetryHint tokenHint={tokenHint} loading={aiLoading} onRun={() => void runAiExtract()} />}
          {aiError && <AiErrorBox error={aiError} />}
          <AiSourceSwitch active={source} hasRule={ruleResult !== null} hasLlm={llmResult !== null} onSwitch={setSource} />
        </div>
      )}

      {sheet && (
        <div className="flex flex-col gap-2">
          <SheetImportPanel key={source} sheet={sheet} onFinished={(ok, failed) => {
            notify(
              failed.length > 0 ? 'err' : 'ok',
              failed.length > 0 ? `成功 ${ok} 张，失败：${failed.join('、')}` : `已生成 ${ok} 张角色卡（未跳转，可继续创建作品并导入大纲）`,
            );
            if (failed.length === 0) {
              clearDraft(); // 全部导入成功：草稿使命完成（不跳转，反馈①同款语义）
            }
          }} onImported={(created) => { void recordCreated({ ...created, characterNames: [], worldbookNames: [] }); }} />
          <AiSourceSwitch active={source} hasRule={ruleSheet !== null} hasLlm={llmSheet !== null} onSwitch={setSource} />
          {ruleSheet !== null && !llmSheet && (
            <AiRetryHint tokenHint={tokenHint} loading={aiLoading} onRun={() => void runAiExtract()} />
          )}
          {aiError && <AiErrorBox error={aiError} />}
        </div>
      )}

      {!sheet && extracted && (
        <OutlinePreview
          extracted={extracted}
          editable={source === 'llm'}
          titles={titles}
          busy={busy}
          onChange={(next) => {
            if (source === 'llm') setLlmResult(next);
          }}
          importAll={importState}
          onImportAll={() => void importAll(extracted)}
          onCreateCards={() => void createCards(extracted)}
          onCreateWorldbook={() => void createWorldbookOnly(extracted)}
        />
      )}
    </main>
  );
}
