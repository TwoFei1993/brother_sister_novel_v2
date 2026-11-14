/**
 * 短剧链路 E2E（2026-11-14 对比学习轮回归）：新建短剧 → 粘贴剧本+定稿 → AI 拆镜头（mock JSON）
 * → 断言本轮新 UI：镜头卡 endState/hookType（A5/B1）、视觉签名（B3）、角色卡大头照按钮与服装库（B4/B5）、
 * 设置页优化器开关（C1）。生图/生视频真实生成不在 e2e 范围（单测 + 手动实测覆盖）。
 *
 * mock 分发：scripts/mock-llm.mjs 对 system 含「短剧分镜师」的请求返回镜头 JSON（含 endState/hookType）。
 */
import { join } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { E2E_DATA_DIR } from '../playwright.config';

const PASSWORD = 'e2etest';
/** 登录态持久化（beforeAll 写入，describe 内所有测试经 storageState 复用——对齐 smoke 模式） */
const STATE_FILE = join(E2E_DATA_DIR, 'duanju-state.json');
let duanjuUrl = '';

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole('button', { name: '进入书房' }).click();
  await page.waitForURL(/m\/create|\/$/);
}

async function openNewWorkDialog(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: /新建作品/ }).first().click();
  await expect(page.getByRole('dialog', { name: '新建作品' })).toBeVisible();
}

test.describe.serial('短剧工作台（本轮改动回归）', () => {
  test('登录 + 新建短剧 + 剧本定稿（建基石）', async ({ page }) => {
    await login(page);
    await openNewWorkDialog(page);

    // 新建短剧：模式卡片（role=radio）+ 标题（弹窗内第一个 input）
    const dialog = page.getByRole('dialog', { name: '新建作品' });
    await dialog.getByRole('radio', { name: /短剧/ }).click();
    await dialog.locator('input').first().fill('E2E 短剧回归');
    await dialog.getByRole('button', { name: '创建作品' }).click();
    await page.waitForURL(/\/work\//);
    duanjuUrl = page.url();
    await page.context().storageState({ path: STATE_FILE });
  });

  test('剧本粘贴 + 定稿解锁 + 拆解出集（已登录态）', async ({ browser }) => {
    const page = await (await browser.newContext({ storageState: STATE_FILE })).newPage();
    page.on('pageerror', (e) => console.log(`[PAGEERROR] ${e.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') console.log(`[CONSOLE] ${msg.text().slice(0, 200)}`);
    });
    await page.goto(duanjuUrl);
    await expect(page.getByTestId('duanju-workbench')).toBeVisible();

    await page.getByTestId('script-text').fill('李薇在雨夜巷口逼问线人，对方逃脱后她发现手机里的惊天秘密。');
    await page.getByTestId('script-save').click();
    // 保存成功 → dirty 归零 → 按钮回到 disabled（无改动可存）
    await expect(page.getByTestId('script-save')).toBeDisabled({ timeout: 10_000 });
    await page.getByTestId('script-confirm').locator('input').check();
    await expect(page.getByTestId('duanju-tab-storyboard')).toBeEnabled({ timeout: 10_000 });

    // 拆解出集（mock 制片审核助手 JSON）：审核卡出现 + 集列表含「雨夜真相」
    await page.getByTestId('script-breakdown').click();
    await expect(page.getByTestId('duanju-review-cards').getByText('雨夜真相')).toBeVisible({ timeout: 30_000 });

    // 拆解 onDone 自动流水线（角色→场景→拆镜头）在本页面跑——关页即中断，须等 shots 落库后再结束
    const wid = duanjuUrl.split('/work/')[1]?.split(/[/?#]/)[0] ?? '';
    const alertText = page.getByTestId('duanju-script').locator('[role="alert"], p.text-\\[hsl\\(var\\(--danger\\)\\)\\]');
    await expect(async () => {
      const err = await alertText.allTextContents();
      if (err.some((t) => t.includes('流水线中断'))) throw new Error(`流水线中断：${err.join(' | ')}`);
      const r = await page.request.get(`/api/works/${wid}/duanju`);
      const p = (await r.json()) as { shots?: unknown[] };
      expect(p.shots?.length ?? 0).toBeGreaterThan(0);
    }).toPass({ timeout: 120_000, intervals: [1_000, 2_000, 5_000] });
  });

  test('流水线拆镜头（mock）→ 镜头卡渲染 endState/hookType（A5/B1）+ 视觉签名（B3）', async ({ browser }) => {
    const page = await (await browser.newContext({ storageState: STATE_FILE })).newPage();
    await page.goto(duanjuUrl);
    await page.getByTestId('duanju-tab-storyboard').click();
    await expect(page.getByTestId('duanju-storyboard')).toBeVisible();

    // 拆解 onDone 自动流水线（角色→场景→拆镜头）已产出镜头（test2 API 已断言落库）——DOM 渲染等待
    const hooks = page.getByTestId('duanju-storyboard').locator('select[title*="叙事钩子"]');
    await expect(hooks).toHaveCount(2, { timeout: 60_000 });
    // B1：第二镜钩子为 reveal
    await expect(hooks.nth(1)).toHaveValue('reveal');
    // A5：首镜段末状态值 = mock endState（input value 非文本节点；按示例 placeholder 定位）
    await expect(page.getByTestId('duanju-storyboard').locator('input[placeholder*="李薇站在巷口路灯下"]').first()).toHaveValue(/李薇背靠砖墙坐在积水中/);

    // A5：段末状态输入框
    await expect(page.getByTestId('duanju-storyboard').locator('input[placeholder*="李薇站在巷口路灯下"]')).toHaveCount(2);

    // B3：视觉签名输入框
    await expect(page.getByTestId('duanju-storyboard').locator('input[aria-label="项目视觉签名"]')).toBeVisible();
  });

  test('角色卡：大头照按钮 + 服装库（B4/B5）', async ({ browser }) => {
    const page = await (await browser.newContext({ storageState: STATE_FILE })).newPage();
    await page.goto(duanjuUrl);
    await page.getByTestId('duanju-tab-characters').click();
    await expect(page.getByTestId('duanju-characters')).toBeVisible();

    // 流水线已建角色（李薇）——直接在首卡断言
    await expect(page.getByTestId('duanju-character-card')).toHaveCount(1, { timeout: 10_000 });
    await expect(page.getByTestId('char-gen-anchor')).toBeVisible();

    // 服装库折叠区展开后有 outfits 编辑与当前穿着
    await page.getByText(/服装库（0 套）/).click();
    await expect(page.getByTestId('duanju-character-card').locator('textarea[aria-label="服装库"]')).toBeVisible();
    await expect(page.getByTestId('duanju-character-card').locator('input[aria-label="当前穿着"]')).toBeVisible();
  });

  test('设置页：优化器开关（C1）', async ({ browser }) => {
    const page = await (await browser.newContext({ storageState: STATE_FILE })).newPage();
    await page.goto('/settings');
    await expect(page.getByTestId('comfyui-prompt-optimizer')).toBeVisible({ timeout: 15_000 });
  });
});
