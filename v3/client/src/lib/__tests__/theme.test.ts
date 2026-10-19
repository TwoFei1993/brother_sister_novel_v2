/**
 * 主题模块测试（第二轮体验改进）：用户固定主题覆盖 / useWorkTheme 让位 / 选项元数据。
 * jsdom 提供 documentElement；.ts 无 JSX 运行时，探针组件用 createElement 构造。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { applyUserTheme, themeForGenre, useWorkTheme, USER_THEME_OPTIONS } from '../theme';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

async function mountGenreProbe(genre: string): Promise<Root> {
  const root = createRoot(document.createElement('div'));
  roots.push(root);
  await act(async () => {
    root.render(createElement(GenreProbe, { genre }));
  });
  return root;
}

function GenreProbe({ genre }: { genre: string }) {
  useWorkTheme(genre);
  return null;
}

afterEach(async () => {
  await act(async () => {
    for (const root of roots) root.unmount();
  });
  roots.length = 0;
  applyUserTheme(null); // 复位模块态，避免用例间串扰
  document.documentElement.removeAttribute('data-theme');
});

describe('themeForGenre', () => {
  it('题材映射与未知兜底 hunhe', () => {
    expect(themeForGenre('chuanyue')).toBe('chuanyue');
    expect(themeForGenre('scifi')).toBe('scifi');
    expect(themeForGenre('custom')).toBe('hunhe');
    expect(themeForGenre('未知题材')).toBe('hunhe');
  });
});

describe('applyUserTheme / useWorkTheme 优先级', () => {
  it('固定主题写入 data-theme；置 null 后移除', () => {
    applyUserTheme('scifi');
    expect(document.documentElement.getAttribute('data-theme')).toBe('scifi');
    applyUserTheme(null);
    expect(document.documentElement.getAttribute('data-theme')).toBeNull();
  });

  it('用户固定主题时 useWorkTheme 让位（不覆盖、卸载也不清除）', async () => {
    applyUserTheme('moshi');
    const root = await mountGenreProbe('chuanyue');
    expect(document.documentElement.getAttribute('data-theme')).toBe('moshi');
    await act(async () => {
      root.unmount();
    });
    roots.length = 0;
    expect(document.documentElement.getAttribute('data-theme')).toBe('moshi');
  });

  it('无固定主题时 useWorkTheme 正常应用并在卸载还原', async () => {
    const root = await mountGenreProbe('xuanhuan');
    expect(document.documentElement.getAttribute('data-theme')).toBe('xuanhuan');
    await act(async () => {
      root.unmount();
    });
    roots.length = 0;
    expect(document.documentElement.getAttribute('data-theme')).toBeNull();
  });
});

describe('USER_THEME_OPTIONS', () => {
  it('7 个固定主题：中文名与色板齐全', () => {
    expect(USER_THEME_OPTIONS).toHaveLength(7);
    for (const opt of USER_THEME_OPTIONS) {
      expect(opt.label.length).toBeGreaterThan(0);
      expect(opt.swatch.bg).toMatch(/^\d+ \d+% \d+%$/);
      expect(opt.swatch.accent).toMatch(/^\d+ \d+% \d+%$/);
    }
  });
});
