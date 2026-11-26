/**
 * 剧本分区（共识 D5：三来源 + 定稿门 + AI 拆解审核卡；2026-11-26 起含分集剧本）
 *
 * - 三来源：AI 生成（ScriptGenerateForm 流式）/ 粘贴 / 手写 —— 统一落到原文文本框
 * - 「定稿」：确认后解锁下游 tab（D3 依赖门）；定稿后仍可改，改后下游标 stale
 * - 「AI 拆解」：服务端后台任务（切出 App 后生成继续，回来轮询取结果）→ parseBreakdown → ReviewCards
 *   → 保存成功后自动启动流水线（编排见 useBreakdownFlow）
 * - 「分集剧本」：每集一张卡（EpisodeScripts）
 * - 编辑态同步（D7）：以「上次同步到界面的值」为基准判断有没有未保存修改；有修改时不被服务端值覆盖
 */
import { useEffect, useState } from 'react';

import { useDuanjuStore } from '../store';
import { buildBreakdownMessages } from '../lib/prompts/prompts-script';
import { useSettingsStore } from '../../../stores/settings';
import ScriptGenerateForm from './ScriptGenerateForm';
import ReviewCards from './ReviewCards';
import EpisodeScripts from './EpisodeScripts';
import { useBreakdownFlow } from './hooks/useBreakdownFlow';
import type { DuanjuScript } from '@shared/duanju';

const SRC_LABELS: Record<DuanjuScript['source'], string> = {
  ai: 'AI 生成',
  pasted: '粘贴',
  manual: '手写',
};

interface EditState {
  text: string;
  confirmed: boolean;
  source: DuanjuScript['source'];
}

const sameEdit = (a: EditState, b: EditState): boolean => a.text === b.text && a.confirmed === b.confirmed && a.source === b.source;

export default function ScriptPane({ workId }: { workId: string }) {
  const { project, patch, saving } = useDuanjuStore();
  const [text, setText] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [source, setSource] = useState<DuanjuScript['source']>('manual');
  const [genOpen, setGenOpen] = useState(false);
  /**
   * 上次同步到界面的服务端值（编辑态同步的基准）。放在 state 而不是 ref：
   * 保存成功后基准变了要触发一次重渲染，「保存剧本」才会及时变回不可点（放 ref 时不重渲染，
   * 按钮看着还能点，再点一次会把原文的更新时刻刷掉，升级前出的镜头全部变成待刷新）。
   */
  const [lastSynced, setLastSynced] = useState<EditState | null>(null);

  const flow = useBreakdownFlow(workId);
  const bgRunning = flow.running;

  // project 载入 / 外部刷新：没有未保存修改时才同步服务端值（基准总是更新）
  useEffect(() => {
    if (!project) return;
    const server: EditState = { text: project.script.text, confirmed: project.script.confirmed, source: project.script.source };
    const local: EditState = { text, confirmed, source };
    const locallyEdited = lastSynced !== null && !sameEdit(local, lastSynced);
    setLastSynced(server);
    if (!locallyEdited) {
      setText(server.text);
      setConfirmed(server.confirmed);
      setSource(server.source);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);

  // 一键转短剧：转换流程写入的一次性标志 → 剧本已定稿且未拆解时自动发起 AI 拆解
  //（后续：审核卡 → 提取角色 → 提取场景 → 逐集写分集剧本 → 逐集拆镜头，全部自动）
  // 必须等本地编辑态同步完成再触发：同步 text 的 effect 与本 effect 在同一次提交里先后执行，
  // 届时闭包里的 text 还可能是空串，runBreakdown 会按「剧本为空」直接返回（生产实测抓出的 bug）。
  // 标志只在真正判定时清除；未就绪就等下一次 effect。
  useEffect(() => {
    const key = `duanju-auto-breakdown-${workId}`;
    if (sessionStorage.getItem(key) !== '1') return;
    if (!project || text !== project.script.text) return; // project 未载入 / 编辑态未同步：等下一次
    sessionStorage.removeItem(key);
    if (!project.script.confirmed || project.episodes.length > 0 || flow.running) return;
    void runBreakdown();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, workId, text]);

  if (!project) return null;

  const local: EditState = { text, confirmed, source };
  const dirty = lastSynced !== null && !sameEdit(local, lastSynced);

  async function saveScript(next?: Partial<EditState>): Promise<boolean> {
    const merged: EditState = {
      source: next?.source ?? source,
      text: next?.text ?? text,
      confirmed: next?.confirmed ?? confirmed,
    };
    const base = project!.script;
    // 内容没改的保存不更新时刻：否则升级前出的镜头会被标成待刷新（设计 3.5）
    const unchanged = base.text === merged.text && base.confirmed === merged.confirmed && base.source === merged.source;
    // 展开保留原文对象的其余字段（scope 等）——重建对象会把它们丢掉
    return patch(workId, {
      script: { ...base, ...merged, updatedAt: unchanged ? base.updatedAt : Date.now() },
    });
  }

  /** AI 拆解 → server 后台任务（切出安全）；拆解基于编辑中的文本，所以先保存 */
  async function runBreakdown(): Promise<void> {
    if (!text.trim() || flow.running || flow.pipelineBusy) return;
    flow.clearError();
    if (dirty && !(await saveScript())) return;
    await flow.submit(buildBreakdownMessages(text, project!.targetEpisodes));
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl lg:max-w-5xl flex-col gap-4 px-4 py-4" data-testid="duanju-script">
      {flow.error && (
        <p className="text-xs text-[hsl(var(--danger))]" role="alert">
          {flow.error}
          {flow.stashed && (
            <button type="button" onClick={flow.retryApply} className="ml-2 underline" data-testid="script-breakdown-retry-apply">
              重试应用
            </button>
          )}
        </p>
      )}

      {/* 来源与操作 */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-[hsl(var(--fg-muted))]">来源：{SRC_LABELS[source]}</span>
        <button
          type="button"
          onClick={() => setGenOpen(true)}
          disabled={flow.pipelineBusy}
          className="h-9 rounded-lg border border-[hsl(var(--accent))] px-3 text-xs text-[hsl(var(--accent))] disabled:opacity-40"
          data-testid="script-ai-gen"
        >
          ✨ AI 生成剧本
        </button>
        {text.trim() && (
          <button
            type="button"
            onClick={() => void runBreakdown()}
            disabled={bgRunning || flow.pipelineBusy}
            className="h-9 rounded-lg bg-[hsl(var(--accent))] px-3 text-xs font-medium text-[hsl(var(--accent-fg))] disabled:opacity-40"
            data-testid="script-breakdown"
          >
            {bgRunning
              ? `拆解中…（已等 ${flow.elapsedSec}s，可切出）`
              : project.reviewCards.summary
                ? '重新 AI 拆解'
                : 'AI 拆解 → 审核卡'}
          </button>
        )}
        {saving && <span className="text-xs text-[hsl(var(--fg-muted))]">保存中…</span>}
      </div>

      {/* 拆解完成后：审核卡 → 分集剧本；原文折叠（反馈 #4：一大段难读） */}
      {project.reviewCards.summary ? (
        <>
          <ReviewCards workId={workId} />
          <EpisodeScripts workId={workId} />
          <details className="rounded-xl border border-[hsl(var(--border-soft))] px-4 py-3" data-testid="script-raw-details">
            <summary className="cursor-pointer text-sm font-medium">📜 剧本原文（点击展开编辑）</summary>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={'粘贴剧本，或手写，或点「AI 生成剧本」……\n格式建议：每行一个镜头（场景｜人物｜动作｜台词）'}
              rows={14}
              className="mt-3 w-full rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-4 py-3 text-sm leading-7 outline-none placeholder:text-[hsl(var(--fg-muted))] focus:border-[hsl(var(--accent))]"
              data-testid="script-text"
            />
          </details>
        </>
      ) : (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'粘贴剧本，或手写，或点「AI 生成剧本」……\n格式建议：每行一个镜头（场景｜人物｜动作｜台词）'}
          rows={14}
          className="w-full rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-4 py-3 text-sm leading-7 outline-none placeholder:text-[hsl(var(--fg-muted))] focus:border-[hsl(var(--accent))]"
          data-testid="script-text"
        />
      )}

      {/* 保存 + 定稿 */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void saveScript()}
          disabled={!dirty || saving}
          className="h-10 rounded-lg border border-[hsl(var(--border-soft))] px-4 text-sm disabled:opacity-40"
          data-testid="script-save"
        >
          {saving ? '保存中…' : '保存剧本'}
        </button>
        <label className="flex items-center gap-2 text-sm text-[hsl(var(--fg-muted))]" data-testid="script-confirm">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => {
              setConfirmed(e.target.checked);
              void saveScript({ confirmed: e.target.checked });
            }}
          />
          定稿（解锁角色/场景/分镜）
        </label>
      </div>

      {bgRunning && (
        <p className="text-xs text-[hsl(var(--fg-muted))]" data-testid="breakdown-bg-hint">
          ⏳ 拆解在服务端后台进行——可切出去干别的，回来自动查看结果；拆完自动接着提取角色 / 场景、写分集剧本、拆镜头。
        </p>
      )}

      {genOpen && (
        <ScriptGenerateForm
          project={project}
          onClose={() => setGenOpen(false)}
          onGenerated={(genText) => {
            setGenOpen(false);
            setText(genText);
            setSource('ai');
            setConfirmed(false);
            void saveScript({ text: genText, source: 'ai', confirmed: false });
          }}
        />
      )}
    </div>
  );
}
