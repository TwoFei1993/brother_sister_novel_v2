/**
 * 软键盘遮挡兜底（反馈：点击输入框输入法遮住半边屏幕看不到输入内容）。
 *
 * Android WebView 两层防护：
 * 1) Manifest windowSoftInputMode=adjustResize —— WebView 高度随键盘收缩，flex 布局自动适配；
 * 2) edge-to-edge 模式（API 35+ 强制）adjustResize 可能失效 —— 此处监听 visualViewport：
 *    键盘弹起时把被遮高度写入 CSS 变量 --kb-height，输入行（.safe-bottom）据此抬升，
 *    聊天流（flex 链）自动压缩。桌面/无键盘环境 --kb-height=0 无副作用。
 */
let installed = false;

export function watchKeyboard(): void {
  if (installed || typeof window === 'undefined') return;
  const vv = window.visualViewport;
  if (!vv) return;
  installed = true;
  const apply = (): void => {
    const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    document.documentElement.style.setProperty('--kb-height', `${kb}px`);
    document.body.classList.toggle('kb-open', kb > 120);
  };
  vv.addEventListener('resize', apply);
  vv.addEventListener('scroll', apply);
  apply();
}
