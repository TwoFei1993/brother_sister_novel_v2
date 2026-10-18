/**
 * 密钥面板：三通道（OpenAI 兼容 / Gemini / Claude）录入卡
 *
 * - 保存：PUT /api/secrets（服务端为整文件覆盖写，GET 只回掩码不回明文）
 *   → 会话内合并策略：保存时把「本会话已提交过的其他通道明文」一并 PUT，
 *     避免逐通道保存互相覆盖；若存在「掩码已配置但本会话未持有明文」的通道，
 *     先 confirm 警示清空风险再继续（多设备先后配置的边缘场景）。
 * - 测试连接：POST /api/llm/test，成功绿 / 失败红 + 错误码人话映射。
 */
import { useCallback, useEffect, useState } from 'react';

import { ApiError } from '../../api/client';
import type { LlmSource } from '../../stores/settings';

import { getSecretsMask, putSecrets, testLlm } from './api';
import { describeLlmCode, type SecretsMask, type SecretsPutBody } from './types';

/** 单通道元数据（卡片循环渲染） */
const CHANNELS: ReadonlyArray<{ source: LlmSource; label: string; desc: string }> = [
  {
    source: 'openai',
    label: 'OpenAI 兼容',
    desc: 'OpenAI 官方或任何兼容接口（中转站可自定义 Base URL）',
  },
  { source: 'gemini', label: 'Google Gemini', desc: 'Gemini 原生接口，密钥从 Google AI Studio 获取' },
  { source: 'claude', label: 'Anthropic Claude', desc: 'Claude 原生接口，密钥从 Anthropic Console 获取' },
];

/** 单通道已提交明文（仅会话内存，不落 localStorage，刷新即弃） */
interface CommittedSecret {
  apiKey: string;
  baseUrl?: string;
}

type TestOutcome = { kind: 'ok' } | { kind: 'fail'; text: string; code?: string };

const EMPTY_INPUTS: Record<LlmSource, { apiKey: string; baseUrl: string }> = {
  openai: { apiKey: '', baseUrl: '' },
  gemini: { apiKey: '', baseUrl: '' },
  claude: { apiKey: '', baseUrl: '' },
};

/** openai 之外的通道统一忽略 baseUrl */
function channelBody(source: LlmSource, apiKey: string, baseUrl: string): CommittedSecret {
  if (source === 'openai' && baseUrl.trim()) return { apiKey, baseUrl: baseUrl.trim() };
  return { apiKey };
}

export default function SecretsPanel() {
  const [mask, setMask] = useState<SecretsMask | null>(null);
  const [inputs, setInputs] = useState(EMPTY_INPUTS);
  const [committed, setCommitted] = useState<Partial<Record<LlmSource, CommittedSecret>>>({});
  const [saving, setSaving] = useState<Partial<Record<LlmSource, boolean>>>({});
  const [testing, setTesting] = useState<Partial<Record<LlmSource, boolean>>>({});
  const [testOutcome, setTestOutcome] = useState<Partial<Record<LlmSource, TestOutcome | null>>>({});
  const [saveError, setSaveError] = useState<Partial<Record<LlmSource, string>>>({});

  const refreshMask = useCallback(() => {
    getSecretsMask()
      .then(setMask)
      .catch(() => setMask(null));
  }, []);

  useEffect(() => {
    refreshMask();
  }, [refreshMask]);

  async function handleSave(source: LlmSource): Promise<void> {
    const cur = inputs[source];
    const apiKey = cur.apiKey.trim();
    if (!apiKey || saving[source]) return;
    // baseUrl 前端预校验（服务端 zod .url() 校验失败会 400）
    if (source === 'openai' && cur.baseUrl.trim()) {
      try {
        new URL(cur.baseUrl.trim());
      } catch {
        setSaveError((p) => ({ ...p, [source]: 'Base URL 格式不正确，须为完整 URL（含 https://）' }));
        return;
      }
    }
    // 组装请求体：目标通道用输入框值，其余通道带上本会话已提交的明文（合并防覆盖）
    const body: SecretsPutBody = {
      ...(source === 'openai' ? { openai: channelBody(source, apiKey, cur.baseUrl) } : {}),
      ...(source === 'gemini' ? { gemini: { apiKey } } : {}),
      ...(source === 'claude' ? { claude: { apiKey } } : {}),
      ...(committed.openai && source !== 'openai' ? { openai: committed.openai } : {}),
      ...(committed.gemini && source !== 'gemini' ? { gemini: committed.gemini } : {}),
      ...(committed.claude && source !== 'claude' ? { claude: committed.claude } : {}),
    };
    // 覆盖风险：掩码已配置、但请求体不含（本会话无明文）的通道将被清空
    const lost = CHANNELS.filter((c) => c.source !== source && mask?.[c.source] && !body[c.source]).map(
      (c) => c.label,
    );
    if (lost.length > 0) {
      const ok = window.confirm(
        `服务端还配置着「${lost.join('」「')}」的密钥，但本浏览器未持有其明文，` +
          '本次保存会清空这些通道，之后需要重新录入。确定继续吗？',
      );
      if (!ok) return;
    }
    setSaving((p) => ({ ...p, [source]: true }));
    setSaveError((p) => ({ ...p, [source]: null }));
    try {
      await putSecrets(body);
      setCommitted((prev) => ({
        ...prev,
        ...(body.openai ? { openai: body.openai } : {}),
        ...(body.gemini ? { gemini: body.gemini } : {}),
        ...(body.claude ? { claude: body.claude } : {}),
      }));
      // 明文不回显、不留驻输入框；掩码以服务端真相为准刷新
      setInputs((prev) => ({ ...prev, [source]: { apiKey: '', baseUrl: '' } }));
      refreshMask();
    } catch (err) {
      setSaveError((p) => ({
        ...p,
        [source]: err instanceof ApiError ? err.message : '保存失败，请稍后重试',
      }));
    } finally {
      setSaving((p) => ({ ...p, [source]: false }));
    }
  }

  async function handleTest(source: LlmSource): Promise<void> {
    if (testing[source]) return;
    setTesting((p) => ({ ...p, [source]: true }));
    setTestOutcome((p) => ({ ...p, [source]: null }));
    try {
      const r = await testLlm(source);
      setTestOutcome((p) => ({
        ...p,
        [source]: r.ok ? { kind: 'ok' } : { kind: 'fail', text: describeLlmCode(r.code), code: r.code },
      }));
    } catch (err) {
      setTestOutcome((p) => ({
        ...p,
        [source]: {
          kind: 'fail',
          text: err instanceof ApiError ? err.message : '请求失败，请稍后重试',
        },
      }));
    } finally {
      setTesting((p) => ({ ...p, [source]: false }));
    }
  }

  return (
    <section aria-label="LLM 接入" className="flex flex-col gap-4">
      <p className="text-sm text-[hsl(var(--fg-muted))]">
        密钥仅保存在服务端（data/secrets.json），浏览器不存储明文。配置后可在下方测试连通性。
      </p>
      {mask === null && (
        <p role="status" className="text-sm text-[hsl(var(--danger))]">
          配置状态加载失败，请刷新重试。
        </p>
      )}
      {CHANNELS.map((ch) => {
        const configured = mask?.[ch.source] === true;
        const outcome = testOutcome[ch.source];
        return (
          <div
            key={ch.source}
            className="rounded-2xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] p-5"
          >
            <div className="mb-1 flex items-center justify-between gap-2">
              <h3 className="text-base font-semibold">{ch.label}</h3>
              {configured && (
                <span className="rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-0.5 text-xs text-emerald-400">
                  已配置
                </span>
              )}
            </div>
            <p className="mb-4 text-xs text-[hsl(var(--fg-muted))]">{ch.desc}</p>

            <label className="mb-1 block text-sm" htmlFor={`apikey-${ch.source}`}>
              API Key
            </label>
            <input
              id={`apikey-${ch.source}`}
              type="password"
              value={inputs[ch.source].apiKey}
              onChange={(e) =>
                setInputs((p) => ({ ...p, [ch.source]: { ...p[ch.source], apiKey: e.target.value } }))
              }
              placeholder={configured ? '已配置（输入新值可更新）' : '粘贴 API Key'}
              autoComplete="off"
              className="mb-3 w-full rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-3 py-2.5 text-base outline-none placeholder:text-[hsl(var(--fg-muted))] focus:border-[hsl(var(--accent))]"
            />

            {ch.source === 'openai' && (
              <>
                <label className="mb-1 block text-sm" htmlFor="baseurl-openai">
                  Base URL（选填，默认官方地址）
                </label>
                <input
                  id="baseurl-openai"
                  type="url"
                  value={inputs.openai.baseUrl}
                  onChange={(e) =>
                    setInputs((p) => ({ ...p, openai: { ...p.openai, baseUrl: e.target.value } }))
                  }
                  placeholder="https://api.openai.com/v1"
                  autoComplete="off"
                  className="mb-3 w-full rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-3 py-2.5 text-base outline-none placeholder:text-[hsl(var(--fg-muted))] focus:border-[hsl(var(--accent))]"
                />
              </>
            )}

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                disabled={!inputs[ch.source].apiKey.trim() || saving[ch.source] === true}
                onClick={() => void handleSave(ch.source)}
                className="min-h-[36px] rounded-lg bg-[hsl(var(--accent))] px-4 text-sm font-medium text-[hsl(var(--accent-fg))] transition-opacity disabled:opacity-40"
              >
                {saving[ch.source] ? '保存中…' : '保存'}
              </button>
              <button
                type="button"
                disabled={testing[ch.source] === true}
                onClick={() => void handleTest(ch.source)}
                className="min-h-[36px] rounded-lg border border-[hsl(var(--border-soft))] px-4 text-sm transition-colors hover:border-[hsl(var(--accent))] disabled:opacity-40"
              >
                {testing[ch.source] ? '测试中…' : '测试连接'}
              </button>
            </div>

            {saveError[ch.source] && (
              <p role="alert" className="mt-3 text-sm text-[hsl(var(--danger))]">
                {saveError[ch.source]}
              </p>
            )}
            {outcome?.kind === 'ok' && (
              <p role="status" className="mt-3 text-sm text-emerald-400">
                连接成功，该通道可用。
              </p>
            )}
            {outcome?.kind === 'fail' && (
              <p role="alert" className="mt-3 text-sm text-[hsl(var(--danger))]">
                {outcome.text}
                {outcome.code && <span className="ml-1 text-xs opacity-70">（{outcome.code}）</span>}
              </p>
            )}
          </div>
        );
      })}
    </section>
  );
}
