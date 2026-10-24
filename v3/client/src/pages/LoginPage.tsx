/**
 * 登录页（设计 §7.1 /login + P3.1 双角色）
 *
 * - 作者：沿用旧习惯只输密码（用户名缺省由服务端哈希匹配兜底命中作者种子）
 * - 读者：输入用户名+密码；没有账号走「注册读者」表单（username/password/昵称）
 * 流程：POST /api/auth/login|register → 写身份 store → 拉 /api/config（容错）→ 跳转
 */
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { apiFetch, ApiError } from '../api/client';
import { useAuthStore, type AuthUser } from '../stores/auth';
import { useSettingsStore, type ConfigDto } from '../stores/settings';

function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return '用户名或密码错误，请重试';
    if (err.status === 503) return '服务端未配置访问密码（ACCESS_PASSWORD），请先在服务端环境变量中设置';
    return err.message;
  }
  return '无法连接服务器，请稍后重试';
}

export default function LoginPage() {
  const navigate = useNavigate();
  const setConfig = useSettingsStore((s) => s.setConfig);
  const setUser = useAuthStore((s) => s.setUser);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // 已登录访问 /login 直接进书房；顺带补拉身份（store 刷新后为空）
  useEffect(() => {
    let alive = true;
    apiFetch('/api/auth/check', { keepOn401: true })
      .then(async () => {
        if (!alive) return;
        let role: AuthUser['role'] | undefined;
        try {
          const me = await apiFetch<{ user: AuthUser | null }>('/api/auth/me');
          setUser(me.user);
          role = me.user?.role;
        } catch {
          /* 身份缺失不阻塞跳转 */
        }
        navigate(role === 'reader' ? '/m/read' : '/m/create', { replace: true });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [navigate, setUser]);

  async function afterAuth(user: AuthUser | null): Promise<void> {
    setUser(user);
    try {
      const config = await apiFetch<ConfigDto>('/api/config');
      setConfig(config);
    } catch {
      // config 属增强信息，缺失可接受
    }
    // P3：移动端为默认形态——登录一律进 /m/*（桌面版保留给高级操作，手动输 / 进入）
    navigate(user?.role === 'reader' ? '/m/read' : '/m/create', { replace: true });
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (!password || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      if (mode === 'register') {
        const r = await apiFetch<{ ok: boolean; user: AuthUser }>('/api/auth/register', {
          method: 'POST',
          body: JSON.stringify({ username: username.trim(), password, displayName: displayName.trim() || undefined }),
        });
        await afterAuth(r.user);
        return;
      }
      const r = await apiFetch<{ ok: boolean; user?: AuthUser }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: username.trim() || undefined, password }),
      });
      await afterAuth(r.user ?? null);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSubmitting(false);
    }
  }

  const inputCls =
    'mb-3 w-full rounded-lg border bg-[hsl(var(--bg))] px-4 py-3 text-base outline-none placeholder:text-[hsl(var(--fg-muted))] focus:border-[hsl(var(--accent))]';

  return (
    <main className="safe-top safe-bottom flex min-h-screen flex-col items-center justify-center bg-[hsl(var(--bg))] px-4 text-[hsl(var(--fg))]">
      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="w-full max-w-sm rounded-2xl border border-[hsl(var(--accent))]/35 bg-[hsl(var(--surface))] p-8 shadow-xl"
      >
        <h1 className="mb-1 text-center text-2xl font-semibold tracking-wide">兄妹小说</h1>
        <div className="mx-auto mb-4 h-0.5 w-10 rounded-full bg-[hsl(var(--accent))]/60" aria-hidden="true" />
        <p className="mb-6 text-center text-sm text-[hsl(var(--fg-muted))]">
          {mode === 'login' ? '作者可只输密码进入；读者请输入用户名' : '注册读者账号（阅读+评论+留言）'}
        </p>

        {(mode === 'register' || username.length > 0) && (
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="用户名"
            autoComplete="username"
            className={`${inputCls} border-[hsl(var(--border-soft))]`}
          />
        )}
        {mode === 'register' && (
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="昵称（评论署名，可选）"
            className={`${inputCls} border-[hsl(var(--border-soft))]`}
          />
        )}
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="密码"
          autoFocus
          autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
          className={`mb-4 w-full rounded-lg border bg-[hsl(var(--bg))] px-4 py-3 text-base outline-none placeholder:text-[hsl(var(--fg-muted))] focus:border-[hsl(var(--accent))] ${
            error ? 'border-[hsl(var(--danger))]' : 'border-[hsl(var(--border-soft))]'
          }`}
        />

        {error && (
          <p role="alert" className="mb-4 text-sm text-[hsl(var(--danger))]">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={!password || submitting}
          data-testid="login-submit"
          className="w-full rounded-lg bg-[hsl(var(--accent))] py-3 text-base font-medium text-[hsl(var(--accent-fg))] transition-opacity disabled:opacity-40"
        >
          {submitting ? '请稍候…' : mode === 'login' ? '进入书房' : '注册并进入'}
        </button>

        <button
          type="button"
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login');
            setError(null);
          }}
          className="mt-4 w-full text-center text-xs text-[hsl(var(--fg-muted))] underline"
        >
          {mode === 'login' ? '没有账号？注册读者账号' : '已有账号？返回登录'}
        </button>
      </form>
    </main>
  );
}
