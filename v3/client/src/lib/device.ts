/**
 * 设备判定（移动端自动路由守卫用）
 *
 * - 移动设备 = 移动 UA（Android/iPhone/iPad/Mobile；APK WebView 天然命中）或窄屏（<768px）
 * - 逃生门：localStorage 'v3-desktop-override' = '1' 时视为桌面（作者在窄窗口想用桌面版时手动开启）
 */
export function isMobileDevice(): boolean {
  try {
    if (localStorage.getItem('v3-desktop-override') === '1') return false;
  } catch {
    /* localStorage 不可用时继续按 UA 判定 */
  }
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const uaMobile = /Android|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(ua);
  const narrow = typeof window !== 'undefined' && window.innerWidth < 768;
  return uaMobile || narrow;
}
