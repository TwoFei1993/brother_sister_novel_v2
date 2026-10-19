/**
 * E2E globalSetup：每轮开始前重建干净的临时数据目录并预置 secrets。
 *
 * - DATA_DIR = client/.e2e-data（gitignore）：server 进程以 env DATA_DIR 指向这里，
 *   作品/库资产全部落在隔离目录，不污染开发数据（每轮清空 = 可重复冒烟）。
 * - secrets.json 预置 openai 通道指向 mock-llm（:3100）：前端 llmPrefs 默认即 openai
 *   通道，因此生成链路零 UI 配置直通假上游（与 docs/验收记录.md M2/M3 验收环境一致）。
 * globalSetup 先于 webServer 启动，保证 server 首次读盘即可见 secrets。
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { E2E_DATA_DIR } from '../playwright.config';

export default function globalSetup(): void {
  rmSync(E2E_DATA_DIR, { recursive: true, force: true });
  mkdirSync(E2E_DATA_DIR, { recursive: true });
  // 与 server secretsSchema 对齐：openai.apiKey 必填，baseUrl 覆盖为假上游
  writeFileSync(
    join(E2E_DATA_DIR, 'secrets.json'),
    JSON.stringify({ openai: { apiKey: 'mock-key-e2e', baseUrl: 'http://localhost:3100/v1' } }, null, 2),
  );
}
