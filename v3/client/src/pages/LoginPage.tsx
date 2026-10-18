/**
 * 登录页（设计 §7.1 /login）：单密码登录
 *
 * 流程：POST /api/auth/login → 拉取 GET /api/config（容错：Task 5 未部署/失败均不阻塞）
 * → 写入 settingsStore → 跳书架。
 */
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { apiFetch, ApiError } from '../api/client';
import { useSettingsStore, type ConfigDto } from '../stores/settings';

/** 登录失败 → 人话提示（server 消息已人话化，这里仅补关键状态码的明确文案） */
function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return '密码错误，请重试';
    if (err.status === 503) return '服务端未配置访问密码（ACCESS_PASSWORD），请先在服务端环境变量中设置';
    return err.message;
  }
  return '无法连接服务器，请稍后重试';
}

export default function LoginPage() {
  const navigate = useNavigate();
  const setConfig = useSettingsStore((s) => s.setConfig);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // 已登录访问 /login 直接进书架；探测失败静默留在登录页
  useEffect(() => {
    let alive = true;
    apiFetch('/api/auth/check', { keepOn401: true })
      .then(() => {
        if (alive) navigate('/', { replace: true });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [navigate]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (!password || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ password }),
      });
      // 运行配置容错拉取：404（Task 5 未部署）/网络失败都不阻塞登录
      try {
        const config = await apiFetch<ConfigDto>('/api/config');
        setConfig(config);
      } catch {
        // config 属增强信息，缺失可接受
      }
      navigate('/', { replace: true });
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="safe-top safe-bottom flex min-h-screen flex-col items-center justify-center bg-[hsl(var(--bg))] px-4 text-[hsl(var(--fg))]">
      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="w-full max-w-sm rounded-2xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] p-8 shadow-xl"
      >
        <h1 className="mb-1 text-center text-2xl font-semibold tracking-wide">兄妹小说</h1>
        <p className="mb-8 text-center text-sm text-[hsl(var(--fg-muted))]">请输入访问密码</p>

        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="访问密码"
          autoFocus
          autoComplete="current-password"
          className="mb-4 w-full rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-4 py-3 text-base outline-none placeholder:text-[hsl(var(--fg-muted))] focus:border-[hsl(var(--accent))]"
        />

        {error && (
          <p role="alert" className="mb-4 text-sm text-[hsl(var(--danger))]">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={!password || submitting}
          className="w-full rounded-lg bg-[hsl(var(--accent))] py-3 text-base font-medium text-[hsl(var(--accent-fg))] transition-opacity disabled:opacity-40"
        >
          {submitting ? '登录中…' : '进入书房'}
        </button>
      </form>
    </main>
  );
}
