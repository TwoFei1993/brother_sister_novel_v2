/**
 * 登录身份 store（P3.1）：当前用户 {id, username, displayName?, role}
 *
 * 登录/注册响应带 user 即写入；刷新后经 GET /api/auth/me 补拉（AuthGuard 时序）；
 * 登出清空。评论署名 / 我的页身份 / 读者入口显隐都从这里读。
 */
import { create } from 'zustand';

export interface AuthUser {
  id: string;
  username: string;
  displayName?: string;
  role: 'author' | 'reader';
}

interface AuthState {
  user: AuthUser | null;
  setUser: (user: AuthUser | null) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  setUser: (user) => set({ user }),
}));

/** 展示名（displayName 缺省回退 username） */
export function displayNameOf(u: AuthUser | null): string {
  return u?.displayName || u?.username || '未登录';
}
