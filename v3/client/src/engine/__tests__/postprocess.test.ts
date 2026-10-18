/**
 * 后处理测试（设计 §5.1⑥ / §5.3 COT 状态栏）
 * 管道：getRegexedString（ai_output 双 false 轨道，显示清理）→
 * parseStatusBlock（尾部 ```status 块解析剥离）→ parseChapterTitle（首行标题剥离+兜底）。
 */
import { describe, expect, it } from 'vitest';

import type { TavernRegexScript } from '@shared/tavern';

import { parseChapterTitle, parseStatusBlock, postprocessMessage } from '../prompt/postprocess';

/** 正则脚本快捷构造：ai_output（placement 2）双 false = 全时轨道 */
function makeScript(overrides: Partial<TavernRegexScript> = {}): TavernRegexScript {
  return {
    id: 's1',
    scriptName: '清理脚本',
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

describe('parseChapterTitle', () => {
  it('首行 `# 第N章 xxx` 剥离为标题，剩余为正文', () => {
    const { title, content } = parseChapterTitle('# 第3章 遗迹之门\n\n正文第一段。\n正文第二段。', undefined, 2);
    expect(title).toBe('第3章 遗迹之门');
    expect(content).toBe('正文第一段。\n正文第二段。');
  });

  it('首行 `# 纯标题`（无章节号）同样剥离', () => {
    const { title, content } = parseChapterTitle('# 风起之夜\n正文。', undefined, 4);
    expect(title).toBe('风起之夜');
    expect(content).toBe('正文。');
  });

  it('无标题标记时兜底 directive 首句（≤20 字）', () => {
    const { title, content } = parseChapterTitle(
      '正文开头没有标题行。',
      '主角推开遗迹大门，发现内部别有洞天，深处传来低语',
      6,
    );
    expect(title).toBe('主角推开遗迹大门，发现内部别有洞天，深处'); // 恰 20 字截断
    expect(content).toBe('正文开头没有标题行。');
  });

  it('无 directive 时兜底 `第N章`（index+1）', () => {
    const { title } = parseChapterTitle('只有正文。', undefined, 0);
    expect(title).toBe('第1章');
  });
});

describe('parseStatusBlock', () => {
  it('尾部 ```status 块解析为快照并从正文剥离；数值尝试转 number', () => {
    const raw = '正文结尾。\n\n```status\n等级: 12\n金币: 350.5\n状态: 轻伤\n```\n';
    const { statusSnapshot, content } = parseStatusBlock(raw);
    expect(statusSnapshot).toEqual({ 等级: 12, 金币: 350.5, 状态: '轻伤' });
    expect(content).toBe('正文结尾。');
  });

  it('无状态块时原样返回（statusSnapshot 为 undefined）', () => {
    const { statusSnapshot, content } = parseStatusBlock('普通正文。');
    expect(statusSnapshot).toBeUndefined();
    expect(content).toBe('普通正文。');
  });
});

describe('postprocessMessage 串联', () => {
  it('管道：正则显示清理 → 状态块剥离 → 标题解析', () => {
    const scripts = [
      makeScript({ findRegex: '【旁白：.*?】', replaceString: '' }),
      // promptOnly 脚本不应在显示轨运行
      makeScript({ findRegex: 'SECRET', replaceString: '已隐藏', promptOnly: true }),
    ];
    const result = postprocessMessage('# 第1章 开端\n【旁白：深夜】SECRET 正文。', {
      chapterIndex: 0,
      regexScripts: scripts,
    });
    expect(result.title).toBe('第1章 开端');
    expect(result.content).toBe('SECRET 正文。'); // 双 false 脚本生效、promptOnly 跳过
    expect(result.statusSnapshot).toBeUndefined();
  });

  it('状态块先剥离再解析标题：快照与标题同时产出', () => {
    const result = postprocessMessage('# 第2章 试炼\n正文内容。\n```status\nHP: 88\n```', {
      directive: '通过试炼',
      chapterIndex: 1,
    });
    expect(result.title).toBe('第2章 试炼');
    expect(result.content).toBe('正文内容。');
    expect(result.statusSnapshot).toEqual({ HP: 88 });
  });
});
