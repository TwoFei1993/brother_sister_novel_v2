/**
 * C 工作台视图渲染测试（jsdom + createRoot，模式与 ReadingView.test.tsx 一致）
 * 覆盖：StatusPanel 快照渲染与 +/- 变化标记（§5.3）/ DirectiveHistory 倒序列表与复填
 * 回调、快速指令增删 / WorkbenchView 双栏布局类名与移动抽屉。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Message } from '@shared/message';
import StatusPanel from '../StatusPanel';
import DirectiveHistory from '../DirectiveHistory';
import WorkbenchView from '../WorkbenchView';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
const containers: HTMLElement[] = [];

async function renderEl(node: React.ReactElement): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  containers.push(container);
  await act(async () => {
    root.render(node);
  });
  return container;
}

function msg(partial: Partial<Message> & { id: string; role: Message['role'] }): Message {
  return {
    name: partial.role === 'user' ? '作者' : '小说家',
    content: '正文',
    createdAt: Date.now(),
    swipes: ['正文'],
    swipeId: 0,
    extra: {},
    ...partial,
  };
}

afterEach(async () => {
  await act(async () => {
    for (const root of roots) root.unmount();
  });
  roots.length = 0;
  containers.length = 0;
  document.body.innerHTML = '';
});

describe('StatusPanel 状态变量面板（§5.3）', () => {
  it('渲染最新快照键值对，数值型带进度条；无数据显示引导文案', async () => {
    const empty = await renderEl(<StatusPanel snapshot={null} prevSnapshot={null} />);
    expect(empty.textContent).toContain('在世界书添加状态栏条目后');

    const panel = await renderEl(
      <StatusPanel snapshot={{ 精力: 80, 阵营: '兄妹同盟' }} prevSnapshot={null} />,
    );
    expect(panel.textContent).toContain('精力');
    expect(panel.textContent).toContain('80');
    expect(panel.textContent).toContain('阵营');
    expect(panel.textContent).toContain('兄妹同盟');
    const bars = panel.querySelectorAll('[data-testid="status-bar"]');
    expect(bars).toHaveLength(1); // 仅数值型有进度条
    const inner = bars[0].querySelector('div') as HTMLElement;
    expect(inner.style.width).toBe('80%');
  });

  it('对比上一条快照：数值升 ▲ 绿、降 ▼ 红，字符串变更标 ~，持平不标', async () => {
    const panel = await renderEl(
      <StatusPanel
        snapshot={{ 灵力: 90, 金币: 5, 好感: 70, 心情: '警惕' }}
        prevSnapshot={{ 灵力: 60, 金币: 20, 好感: 70, 心情: '放松' }}
      />,
    );
    const ups = panel.querySelectorAll('[data-testid="delta-up"]');
    expect(ups).toHaveLength(1);
    expect(ups[0].textContent).toBe('▲30');
    expect(ups[0].className).toContain('text-emerald-600');
    const downs = panel.querySelectorAll('[data-testid="delta-down"]');
    expect(downs).toHaveLength(1);
    expect(downs[0].textContent).toBe('▼15');
    expect(downs[0].className).toContain('text-[hsl(var(--danger))]');
    expect(panel.querySelectorAll('[data-testid="delta-changed"]')).toHaveLength(1); // 心情字符串变更
  });
});

describe('DirectiveHistory 快速指令与指令历史', () => {
  const base = {
    onPick: vi.fn(),
    onAddQuickDirective: vi.fn(),
    onRemoveQuickDirective: vi.fn(),
    quickDirectives: [] as string[],
    messages: [] as Message[],
  };

  it('user 消息倒序渲染为历史列表，点击触发 onPick 复填', async () => {
    const onPick = vi.fn();
    const messages = [
      msg({ id: 'u1', role: 'user', content: '兄妹进入遗迹', createdAt: 1000 }),
      msg({ id: 'a1', role: 'assistant', content: '章正文', createdAt: 2000 }),
      msg({ id: 'u2', role: 'user', content: '遭遇守卫', createdAt: 3000 }),
    ];
    const el = await renderEl(<DirectiveHistory {...base} onPick={onPick} messages={messages} />);
    const items = el.querySelectorAll('[data-testid="history-item"]');
    expect(items).toHaveLength(2); // assistant 不进历史
    expect(items[0].textContent).toContain('遭遇守卫'); // 倒序：最新在前
    expect(items[1].textContent).toContain('兄妹进入遗迹');
    await act(async () => {
      (items[1] as HTMLButtonElement).click();
    });
    expect(onPick).toHaveBeenCalledWith('兄妹进入遗迹');
  });

  it('快速指令：按钮点击复填、× 触发删除、＋ 提交内联输入追加', async () => {
    const onPick = vi.fn();
    const onAdd = vi.fn();
    const onRemove = vi.fn();
    const el = await renderEl(
      <DirectiveHistory
        {...base}
        onPick={onPick}
        onAddQuickDirective={onAdd}
        onRemoveQuickDirective={onRemove}
        quickDirectives={['继续探索', '跳过战斗']}
      />,
    );
    const quicks = el.querySelectorAll('[data-testid="quick-directive"]');
    expect(quicks).toHaveLength(2);
    await act(async () => {
      (el.querySelectorAll('[data-testid="remove-quick"]')[1] as HTMLButtonElement).click();
    });
    expect(onRemove).toHaveBeenCalledWith(1);
    await act(async () => {
      (quicks[0].querySelector('button') as HTMLButtonElement).click();
    });
    expect(onPick).toHaveBeenCalledWith('继续探索');

    const input = el.querySelector('[data-testid="quick-input"]') as HTMLInputElement;
    const form = input.closest('form') as HTMLFormElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(input, '新指令');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(onAdd).toHaveBeenCalledWith('新指令');
  });
});

describe('WorkbenchView 布局（§7.1 C 视图）', () => {
  const base = {
    messages: [] as Message[],
    streaming: false,
    buffer: '',
    hasMore: false,
    loadingOlder: false,
    onNeedOlder: vi.fn(),
    entryIndex: [] as Array<{ id: string; label: string }>,
    quickDirectives: [] as string[],
    onPickDirective: vi.fn(),
    onAddQuickDirective: vi.fn(),
    onRemoveQuickDirective: vi.fn(),
  };

  it('双栏布局：桌面左 320px 侧栏 + 右阅读流；移动侧栏收抽屉', async () => {
    const el = await renderEl(<WorkbenchView {...base} />);
    const root = el.querySelector('[data-testid="workbench-view"]') as HTMLElement;
    expect(root.className).toContain('flex-col');
    expect(root.className).toContain('lg:flex-row');
    const sidebar = el.querySelector('[data-testid="workbench-sidebar"]') as HTMLElement;
    expect(sidebar.className).toContain('w-80'); // 左 320px
    expect(sidebar.className).toContain('hidden');
    expect(sidebar.className).toContain('lg:block');
    const drawer = el.querySelector('[data-testid="workbench-drawer"]') as HTMLElement;
    expect(drawer.className).toContain('lg:hidden');
    expect(drawer.className).toContain('translate-x-full'); // 初始收起
    expect(el.querySelector('[data-testid="workbench-toggle"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="reading-scroll"]')).not.toBeNull(); // 主区复用 ReadingView
  });

  it('提取最新 assistant 快照与激活审计下传面板；点击历史触发 onPickDirective', async () => {
    const onPickDirective = vi.fn();
    const messages = [
      msg({ id: 'u1', role: 'user', content: '兄妹进入遗迹深处', createdAt: 500 }),
      msg({
        id: 'a1',
        role: 'assistant',
        createdAt: 1000,
        extra: { statusSnapshot: { 灵力: 60 }, activatedEntries: ['wb1:7'] },
      }),
      msg({
        id: 'a2',
        role: 'assistant',
        createdAt: 2000,
        extra: { statusSnapshot: { 灵力: 90 }, activatedEntries: ['wb1:3'] },
      }),
    ];
    const el = await renderEl(
      <WorkbenchView
        {...base}
        messages={messages}
        entryIndex={[
          { id: 'wb1:3', label: '灵力体系' },
          { id: 'wb1:5', label: '遗迹地图' },
        ]}
        onPickDirective={onPickDirective}
      />,
    );
    const sidebar = el.querySelector('[data-testid="workbench-sidebar"]') as HTMLElement;
    expect(sidebar.textContent).toContain('90'); // 最新快照（非 60）
    expect(sidebar.textContent).toContain('▲30');
    const items = sidebar.querySelectorAll('[data-testid="entry-item"]');
    expect(items).toHaveLength(2);
    expect(items[0].getAttribute('data-active')).toBe('true'); // wb1:3 点亮
    expect(items[1].getAttribute('data-active')).toBe('false');
    await act(async () => {
      (sidebar.querySelector('[data-testid="history-item"]') as HTMLButtonElement).click();
    });
    expect(onPickDirective).toHaveBeenCalledWith('兄妹进入遗迹深处');
  });
});
