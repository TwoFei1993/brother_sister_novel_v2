/**
 * E2E 冒烟（Task 36，单文件串行）：登录 → 建 novel 作品 → mock 生成一章 → 🎲换一支
 * → A/C 视图切换 → chat 冒烟（builtin Seraphina 绑定后对话）。TTS 不在冒烟范围（单测已覆盖）。
 *
 * 状态衔接：登录测试结束后保存 storageState，主流程 describe 以其创建带会话的上下文；
 * 作品 URL 经模块级变量在串行测试间传递（workers=1 保证顺序）。
 * 上游：mock-llm 假上游（secrets 预置指向 :3100，见 playwright.config.ts / global-setup.ts），
 * 每次调用返回 `# 第N章 试炼之门 …`，章号按调用递增。
 */
import { join } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { E2E_DATA_DIR } from '../playwright.config';

/** 登录态持久化文件（落在已 gitignore 的 .e2e-data，globalSetup 每轮清理） */
const STATE_FILE = join(E2E_DATA_DIR, 'state.json');
const PASSWORD = 'e2etest';

/** 串行流程共享：测试内创建的作品 URL */
let novelUrl = '';

/** 生成一轮的统一等待：点续写 → 等流式开始（⏹出现）→ 等流式结束（▶回归） */
async function generateAndWait(page: Page): Promise<void> {
  await page.getByTestId('generate-btn').click();
  await expect(page.getByTestId('stop-btn')).toBeVisible();
  await expect(page.getByTestId('generate-btn')).toBeVisible({ timeout: 30_000 });
}

/** 打开新建作品弹窗（书架顶栏与空态各有一个入口，取第一个） */
async function openNewWorkDialog(page: Page): Promise<void> {
  await page.getByRole('button', { name: /新建作品/ }).first().click();
  await expect(page.getByRole('dialog', { name: '新建作品' })).toBeVisible();
}

test.describe.serial('登录', () => {
  test('未登录访问 / 重定向登录页，输密码进书架空态', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);

    await page.locator('input[type="password"]').fill(PASSWORD);
    await page.getByRole('button', { name: '进入书房' }).click();

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: '我的书架' })).toBeVisible();
    await expect(page.getByText('书架空空如也')).toBeVisible();

    // 预置 LLM 偏好（zustand persist 格式）：useGenerate 对空 model 直接报
    // 「请先在设置页选择模型」，故主流程前先把 openai 通道模型写入 localStorage，
    // 随下方 storageState 一并带给后续上下文（mock-llm 不校验模型名）。
    await page.evaluate(() => {
      localStorage.setItem(
        'v3-llm-prefs',
        JSON.stringify({ state: { llmPrefs: { source: 'openai', model: 'mock-model' } }, version: 0 }),
      );
    });

    // 会话落盘：主流程 describe 以此 storageState 免登录
    await page.context().storageState({ path: STATE_FILE });
  });
});

test.describe.serial('主流程', () => {
  test.use({ storageState: STATE_FILE });

  test('新建 novel 作品进写作台', async ({ page }) => {
    await page.goto('/');
    await openNewWorkDialog(page);

    const dialog = page.getByRole('dialog', { name: '新建作品' });
    await dialog.getByPlaceholder('给作品起个名字').fill('E2E 测试之作');
    // 模式缺省即「互动小说」、题材缺省即「穿越重生」，冒烟只验证可创建
    await dialog.getByRole('button', { name: '创建作品' }).click();

    await expect(page).toHaveURL(/\/work\//, { timeout: 15_000 });
    novelUrl = page.url();
    await expect(page.getByTestId('empty-guide')).toBeVisible();
  });

  test('指令「开篇」续写 → 流式完成出章节', async ({ page }) => {
    await page.goto(novelUrl);
    await expect(page.getByTestId('empty-guide')).toBeVisible();

    await page.getByTestId('directive-input').fill('开篇');
    await generateAndWait(page);

    // B 视图（缺省）：章标题由 mock 首行 `# 第N章 …` 后处理入库，正文非空
    await expect(page.getByRole('heading', { name: /第1章/ })).toBeVisible();
    const reading = page.getByTestId('reading-scroll');
    await expect(reading).toContainText('晨光刺破云层');
    expect((await reading.innerText()).length).toBeGreaterThan(30);
    await expect(page.getByText('共 1 章')).toBeVisible();
  });

  test('🎲换一支 → 候选追加计数 2/2', async ({ page }) => {
    await page.goto(novelUrl);
    await expect(page.getByTestId('swipe-btn')).toBeVisible(); // 仅一支候选
    await page.getByTestId('swipe-btn').click();
    await expect(page.getByTestId('stop-btn')).toBeVisible();
    await expect(page.getByTestId('generate-btn')).toBeVisible({ timeout: 30_000 });

    // 重生成追加候选并切到新候选：◀ 2/2 ▶
    await expect(page.getByTestId('swipe-position')).toHaveText('2/2');
  });

  test('A 视图出气泡，C 视图出工作台侧栏', async ({ page }) => {
    await page.goto(novelUrl);
    await expect(page.getByTestId('reading-scroll')).toBeVisible();

    await page.getByTestId('view-tab-a').click();
    await expect(page.getByTestId('chapter-bubble').first()).toBeVisible();
    await expect(page.getByTestId('chapter-title').first()).toHaveText(/第\d+章/);

    await page.getByTestId('view-tab-c').click();
    await expect(page.getByTestId('workbench-view')).toBeVisible();
    await expect(page.getByTestId('workbench-sidebar')).toBeVisible();
  });

  test('chat 冒烟：builtin 卡绑定 → 发消息 → 流式回复', async ({ page, request }) => {
    // 直调 API 导入 builtin Seraphina（比 UI 快且稳定，导入逻辑由 server 测试覆盖）
    const imported = await request.post('/api/io/resources/fetch', {
      data: { kind: 'builtin', path: 'builtin/characters/default_Seraphina.png' },
    });
    expect(imported.status()).toBe(201);
    const card = (await imported.json()) as { assetType: string; id: string; name: string };
    expect(card.assetType).toBe('characters');

    // 回书架新建 chat 作品并绑定该卡
    await page.goto(novelUrl);
    await page.getByLabel('返回书架').click();
    await expect(page.getByRole('heading', { name: '我的书架' })).toBeVisible();
    await openNewWorkDialog(page);

    const dialog = page.getByRole('dialog', { name: '新建作品' });
    await dialog.getByPlaceholder('给作品起个名字').fill('E2E 对话测试');
    await dialog.getByRole('radio', { name: /对话写作/ }).click();
    await dialog.locator('fieldset select').first().selectOption(card.id);
    await dialog.getByRole('button', { name: '创建作品' }).click();

    // 对话视图：成员栏出现 Seraphina
    await expect(page).toHaveURL(/\/work\//, { timeout: 15_000 });
    await expect(page.getByTestId('chat-view')).toBeVisible();
    await expect(page.getByText('Seraphina').first()).toBeVisible();

    // 发送消息：用户气泡 + 流式气泡 → 最终以 Seraphina 名义的回复气泡非空
    await page.getByTestId('chat-input').fill('你好，请介绍一下自己');
    await page.getByTestId('chat-send').click();
    await expect(page.getByTestId('chat-pending-bubble')).toBeVisible();
    await expect(page.getByTestId('chat-streaming-bubble')).toBeVisible();

    const reply = page.locator('[data-testid="chat-bubble"][data-side="left"]');
    await expect(reply).toHaveCount(1);
    await expect(reply).toContainText('试炼之门', { timeout: 30_000 });
  });
});
