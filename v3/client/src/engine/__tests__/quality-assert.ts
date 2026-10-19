/**
 * 质量测试断言与报告（从 quality-helpers.ts 迁出）
 *
 * 职责：断言记录器（测试产物 → test-results/quality-artifacts.json，gitignore 内）
 * 与字数/token 估算工具。环境/组装/入库装置见 quality-helpers.ts（本模块单向依赖它）。
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MODEL, type SseUsage } from './quality-helpers';

export interface ChapterRecord {
  scene: string;
  index: number;
  title: string;
  titleSource: 'model' | 'fallback';
  chars: number;
  firstSentence: string;
  directive: string;
  activatedIds: string[];
  rawHadThinkTag: boolean;
  usage: SseUsage;
  promptTokens: number;
  generationMs: number;
  content: string;
}

export interface CheckRecord {
  scene: string;
  name: string;
  pass: boolean;
  detail?: string;
}

const chapters: ChapterRecord[] = [];
const checks: CheckRecord[] = [];
const usageTotals: Record<string, SseUsage> = {};

export const recorder = {
  chapter: (rec: ChapterRecord): void => {
    chapters.push(rec);
    const acc = usageTotals[rec.scene] ?? { inputTokens: 0, outputTokens: 0 };
    usageTotals[rec.scene] = {
      inputTokens: acc.inputTokens + rec.usage.inputTokens + rec.promptTokens,
      outputTokens: acc.outputTokens + rec.usage.outputTokens + estimateTokens(rec.content),
    };
  },
  check: (scene: string, name: string, pass: boolean, detail?: string): void => {
    checks.push({ scene, name, pass, detail });
  },
  /** 场景内全部断言记录（报告矩阵 + 末尾聚合 expect 的数据源） */
  checksOf: (scene: string): CheckRecord[] => checks.filter((c) => c.scene === scene),
  /** 场景内失败断言详情（空数组 = 全过） */
  failuresOf: (scene: string): string[] =>
    checks.filter((c) => c.scene === scene && !c.pass).map((f) => `${f.name}${f.detail ? ` — ${f.detail}` : ''}`),
  usageOf: (scene: string): SseUsage => usageTotals[scene] ?? { inputTokens: 0, outputTokens: 0 },
  /** 落盘测试产物（人工审阅摘录与断言矩阵的数据源；test-results/ 在 .gitignore 内） */
  flush: (): void => {
    try {
      const dir = artifactsDir();
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, 'quality-artifacts.json'),
        JSON.stringify({ generatedAt: new Date().toISOString(), model: MODEL, usageTotals, checks, chapters }, null, 2),
        'utf8',
      );
    } catch {
      // 产物落盘失败不影响测试结论
    }
  },
};

/** 测试产物目录：v3/client/test-results/（jsdom 下 import.meta.url 可能非 file scheme，退回 cwd） */
function artifactsDir(): string {
  try {
    return fileURLToPath(new URL('../../../../test-results', import.meta.url));
  } catch {
    return join(process.cwd(), 'test-results');
  }
}

/** 中文正文字数（去空白） */
export function charCount(text: string): number {
  return text.replace(/\s/g, '').length;
}

/** 中文 token 粗估（MiniMax 中文 ≈0.6 token/字） */
export function estimateTokens(text: string): number {
  return Math.round(charCount(text) * 0.6);
}
