/**
 * 设置页渲染冒烟测试（jsdom + createRoot，无 testing-library 依赖，模式同 Bookshelf.test）
 * 覆盖：三分区导航 / 密钥通道卡片与"已配置"徽标 / TTS 地址展示 / 界面偏好占位
 * API 层（features/settings/api）模块级 mock，不触网。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { getConfig, getSecretsMask } from '../api';
import type { SecretsMask } from '../types';
import SettingsPage from '../../../pages/SettingsPage';

vi.mock('../api', () => ({
  getSecretsMask: vi.fn(),
  putSecrets: vi.fn(),
  getConfig: vi.fn(),
  putConfig: vi.fn(),
  testLlm: vi.fn(),
  getHealth: vi.fn(),
}));

const maskMock = vi.mocked(getSecretsMask);
const configMock = vi.mocked(getConfig);

// React 19 act 环境声明（同 Bookshelf.test，暂就地声明）
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
const containers: HTMLElement[] = [];

async function renderSettings(): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  containers.push(container);
  await act(async () => {
    root.render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    );
  });
  return container;
}

/** 点击分区导航按钮（按可见文本查找） */
async function clickSection(container: HTMLElement, label: string): Promise<void> {
  const btn = [...container.querySelectorAll('button')].find((b) => b.textContent === label);
  expect(btn, `找不到分区按钮：${label}`).toBeDefined();
  await act(async () => {
    btn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

beforeEach(() => {
  maskMock.mockReset();
  configMock.mockReset();
  document.body.innerHTML = '';
});

afterEach(async () => {
  await act(async () => {
    for (const root of roots) root.unmount();
  });
  roots.length = 0;
  containers.length = 0;
  document.body.innerHTML = '';
});

describe('SettingsPage', () => {
  it('默认展示 LLM 接入：三通道卡片 + 已配置徽标', async () => {
    const mask: SecretsMask = { openai: true, gemini: false, claude: false };
    maskMock.mockResolvedValue(mask);
    const container = await renderSettings();
    const text = container.textContent ?? '';
    expect(text).toContain('LLM 接入');
    expect(text).toContain('OpenAI 兼容');
    expect(text).toContain('Google Gemini');
    expect(text).toContain('Anthropic Claude');
    expect(text).toContain('已配置'); // 仅 openai 徽标
    expect(maskMock).toHaveBeenCalledOnce();
    // 密码框数量 = 三通道 API Key + openai Base URL
    expect(container.querySelectorAll('input[type="password"]').length).toBe(3);
    expect(container.querySelectorAll('input[type="url"]').length).toBe(1);
  });

  it('切到 TTS 分区：展示服务地址', async () => {
    maskMock.mockResolvedValue({ openai: false, gemini: false, claude: false });
    configMock.mockResolvedValue({ ttsBaseUrl: 'https://tts.example.com' });
    const container = await renderSettings();
    await clickSection(container, 'TTS');
    const text = container.textContent ?? '';
    expect(text).toContain('TTS 听书服务');
    const input = container.querySelector<HTMLInputElement>('input[type="url"]');
    expect(input?.value).toBe('https://tts.example.com');
  });

  it('切到界面偏好分区：占位说明', async () => {
    maskMock.mockResolvedValue({ openai: false, gemini: false, claude: false });
    const container = await renderSettings();
    await clickSection(container, '界面偏好');
    expect(container.textContent).toContain('界面偏好');
  });

  it('切到旧站迁移分区：展示导出引导与上传入口（Task 31）', async () => {
    maskMock.mockResolvedValue({ openai: false, gemini: false, claude: false });
    const container = await renderSettings();
    await clickSection(container, '旧站迁移');
    const text = container.textContent ?? '';
    expect(text).toContain('旧站数据迁移');
    expect(text).toContain('localStorage.getItem'); // 控制台导出命令
    expect(container.querySelector('input[type="file"]')).not.toBeNull();
  });
});
