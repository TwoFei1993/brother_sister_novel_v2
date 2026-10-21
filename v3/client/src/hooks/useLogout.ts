/**
 * 登出 hook（D5）：顶栏「退出」统一入口（RootPage / WorkPage 共用）
 *
 * POST /api/auth/logout 清服务端 cookie → 清 settingsStore 内存态（config；
 * llmPrefs 属设备偏好，登出语义=清会话不清偏好）→ 跳 /login。
 * 请求失败（网络断开等）也照常清本地并跳转——登出必须总能完成，服务端
 * cookie 残留仅是 7 天 TTL 内的自洽 token，本地会话已终止。
 */
import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

import { apiFetch } from '../api/client';
import { useSettingsStore } from '../stores/settings';

export function useLogout(): () => Promise<void> {
  const navigate = useNavigate();
  return useCallback(async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // best-effort：服务端不可达时仍执行本地登出
    }
    useSettingsStore.getState().setConfig(null);
    navigate('/login', { replace: true });
  }, [navigate]);
}
