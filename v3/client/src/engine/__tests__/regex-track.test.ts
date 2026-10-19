/**
 * 正则双轨接线集成测试（review #3 修复回归）
 *
 * 引擎语义（时点过滤/placement/宏）由 regex.test.ts 覆盖；本文件验证管线接线：
 * - promptOnly 生成轨：assemblePrompt 对静态块（ai_output）与世界书条目（world_info）
 *   应用、历史消息不重复应用、markdownOnly 脚本在装配 dry-run 中完全不生效
 * - markdownOnly 渲染轨：applyDisplayRegex 改显示文本；promptOnly 脚本在显示轨跳过
 */
import { describe, expect, it } from 'vitest';

import type { TavernRegexScript } from '@shared/tavern';

import { applyDisplayRegex } from '../../lib/markdown';
import { assemblePrompt } from '../prompt/assemble';
import { EMPTY_SCAN, makeCtx, makeHistory } from './assemble-fixtures';

/** 构造脚本（regex.test.ts 同款骨架） */
function makeScript(overrides: Partial<TavernRegexScript> = {}): TavernRegexScript {
  return {
    id: 's1',
    scriptName: '测试脚本',
    findRegex: '',
    replaceString: '',
    trimStrings: [],
    placement: [2],
    disabled: false,
    markdownOnly: false,
    promptOnly: false,
    runOnEdit: true,
    substituteRegex: 0,
    minDepth: -1,
    maxDepth: -1,
    ...overrides,
  };
}

describe('promptOnly 生成轨（assemble 集成）', () => {
  it('promptOnly 脚本在静态块（ai_output）生效：main 内容被改写', () => {
    const script = makeScript({
      findRegex: 'MAIN默认主提示',
      replaceString: '[提示词已瘦身]',
      placement: [2],
      promptOnly: true,
    });
    const result = assemblePrompt(makeCtx({ regexScripts: [script] }));
    expect(result.messages.map((m) => m.content)).toContain('[提示词已瘦身]');
    expect(result.messages.map((m) => m.content)).not.toContain('MAIN默认主提示');
  });

  it('placement 区分块类型：world_info 脚本只改世界书条目，不碰 main 静态块', () => {
    const worldOnly = makeScript({
      findRegex: '秘密设定',
      replaceString: '[脱敏]',
      placement: [5], // world_info
      promptOnly: true,
    });
    const result = assemblePrompt(
      makeCtx({
        worldbookScan: { ...EMPTY_SCAN, before: ['世界书秘密设定条目'] },
        regexScripts: [worldOnly],
      }),
    );
    const contents = result.messages.map((m) => m.content);
    expect(contents).toContain('世界书[脱敏]条目');
    expect(contents).toContain('MAIN默认主提示'); // ai_output 块不受 world_info 脚本影响
  });

  it('历史消息不重复应用 promptOnly 脚本（入库原文保留）', () => {
    const script = makeScript({
      findRegex: '历史一',
      replaceString: '[已替换]',
      promptOnly: true,
    });
    const result = assemblePrompt(makeCtx({ history: makeHistory(['历史一', '历史二']), regexScripts: [script] }));
    const contents = result.messages.map((m) => m.content);
    expect(contents).toContain('历史一'); // 历史原样进上下文
    expect(contents).not.toContain('[已替换]');
  });

  it('markdownOnly 脚本不影响装配输出（dry-run 对比：带与不带脚本结果一致）', () => {
    const mdOnly = makeScript({
      findRegex: '卡描述',
      replaceString: '**卡描述**',
      markdownOnly: true,
      promptOnly: false,
    });
    const bare = assemblePrompt(makeCtx());
    const withScript = assemblePrompt(makeCtx({ regexScripts: [mdOnly] }));
    expect(withScript.messages).toEqual(bare.messages);
    expect(withScript.usage).toEqual(bare.usage);
    expect(withScript.activatedIds).toEqual(bare.activatedIds);
  });
});

describe('markdownOnly 渲染轨（applyDisplayRegex）', () => {
  it('markdownOnly 脚本改写显示文本', () => {
    const script = makeScript({ findRegex: '\\[剧透\\](.+?)\\[/剧透\\]', replaceString: '>>>$1<<<', markdownOnly: true });
    expect(applyDisplayRegex('前文[剧透]真相[/剧透]后文', [script])).toBe('前文>>>真相<<<后文');
  });

  it('promptOnly 脚本在显示轨跳过：只改提示词、不污染显示（酒馆时点三分支）', () => {
    const script = makeScript({ findRegex: '真相', replaceString: '[隐藏]', promptOnly: true });
    expect(applyDisplayRegex('真相只有一个', [script])).toBe('真相只有一个');
  });

  it('无脚本或空文本零开销原样返回；输出随后仍过 sanitize 管道（由渲染层保证）', () => {
    expect(applyDisplayRegex('正文', undefined)).toBe('正文');
    expect(applyDisplayRegex('正文', [])).toBe('正文');
    expect(applyDisplayRegex('', [makeScript({ findRegex: 'x', replaceString: 'y' })])).toBe('');
  });
});
