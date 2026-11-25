#!/usr/bin/env tsx
/**
 * 提示词探针（零 LLM 成本）：为某本书的下一章组装最终提示词，检查指定关键词是否真的在里面。
 *
 * 背景：预设 / 文风 / 基调这类「注入类功能」的验收标准是最终发给模型的提示词里有它——
 * 只看任务状态或界面选项会漏掉透传断链（历史上线上无效过）。
 *
 * 用法（经 scripts/probe-prompt.sh 调用）：
 *   bash scripts/probe-prompt.sh <workId> [关键词1] [关键词2] ...
 * 不给关键词时只打印提示词规模与要求块开头。
 */
// 数据目录沿用服务端默认（v3/data）；要探别的数据目录时外部设 DATA_DIR

type ProbeModule = typeof import('../server/src/services/novel-gen/assemble');

const [workId, ...needles] = process.argv.slice(2);
if (!workId) {
  console.error('用法：bash scripts/probe-prompt.sh <workId> [关键词...]');
  process.exit(1);
}

const { readWork } = await import('../server/src/routes/works/works');
const { loadAssembleAssets } = await import('../server/src/services/novel-gen/assets');
const { buildMacroEnv, scanAndAssemble } = (await import(
  '../server/src/services/novel-gen/assemble'
)) as ProbeModule;
const { readAll } = await import('../server/src/storage/jsonl');
const { messagesFile } = await import('../server/src/routes/works/messages');

const work = await readWork(workId);
const messages = await readAll<import('@shared/message').Message>(messagesFile(workId));
const assets = await loadAssembleAssets(work);
const env = buildMacroEnv(work, assets.cards[0]?.data.name ?? undefined, { work: new Map(), global: new Map() }, {});
const prefs = {
  source: 'claude' as const,
  model: 'MiniMax-M3.1-Flash',
  thinking: false,
  maxContext: 65536,
  maxTokens: 8192,
};
const fitted = await scanAndAssemble(work, messages, { kind: 'directive', text: '' }, assets, env, prefs);
const full = fitted.messages.map((m) => m.content).join('\n');

const s = work.settings;
console.log(`作品《${work.title}》：${messages.filter((m) => m.chapter).length} 章 | 写作风格=${s.writingStyle} | 基调=${s.storyTones.join('、')}${s.customStoryTone ? '+' + s.customStoryTone : ''} | 主预设=${work.presetId || '（未绑定）'} | 预设覆盖 ${Object.keys(s.presetPromptOverrides ?? {}).length} 项`);
console.log(`提示词：${fitted.messages.length} 条消息，${full.length} 字符，约 ${fitted.promptTokens} token`);
if (needles.length === 0) process.exit(0);
let missing = 0;
for (const n of needles) {
  const at = full.indexOf(n);
  if (at < 0) {
    missing += 1;
    console.log(`✗ 未找到「${n}」`);
  } else {
    console.log(`✓ 「${n}」位于第 ${at} 字符：…${full.slice(Math.max(0, at - 24), at + 56).replace(/\s+/g, ' ')}…`);
  }
}
process.exit(missing > 0 ? 2 : 0);
