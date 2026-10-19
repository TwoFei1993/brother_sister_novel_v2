/**
 * chat 流程纯逻辑测试：
 * - appendReplyLengthHint：回复长度提示注入位置与三档文案（用户反馈四问③）
 * - buildChatMainPrompt/buildFallbackPreset：兜底主提示词按档位映射字数区间
 * - 自动连播状态机（四问④）：开关/配额/扣减/判定
 */
import { describe, expect, it } from 'vitest';

import { buildChatMainPrompt, buildFallbackPreset } from '../../../hooks/generation-pipeline';
import type { GenerateMessage } from '../../../api/llm';
import {
  AUTO_CHAT_DELAY_MS,
  INITIAL_AUTO_STATE,
  appendReplyLengthHint,
  autoConsume,
  autoOnManualSend,
  autoShouldSend,
  autoToggle,
} from '../chat-flow';

const HISTORY: GenerateMessage[] = [
  { role: 'system', content: '你是哥哥' },
  { role: 'assistant', name: '哥哥', content: '我推开门' },
  { role: 'user', content: '今晚吃什么' },
];

describe('回复长度（四问③）', () => {
  it('hint 追加在最末尾（贴近生成点引导最强）且为 system 角色，三档各含对应区间与小说笔法', () => {
    const out = appendReplyLengthHint(HISTORY, 'medium');
    expect(out).toHaveLength(HISTORY.length + 1);
    expect(out.slice(0, 3)).toEqual(HISTORY); // 原消息不受影响
    const last = out.at(-1)!;
    expect(last.role).toBe('system');
    expect(last.content).toContain('400-900');
    expect(last.content).toContain('小说笔法');
    expect(appendReplyLengthHint([], 'short').at(-1)!.content).toContain('150-300');
    expect(appendReplyLengthHint([], 'long').at(-1)!.content).toContain('800-1500');
  });

  it('chat 兜底主提示词按档位映射（medium 取代旧 200-500）；novel 主提示词不消费长度档', () => {
    expect(buildChatMainPrompt('short').content).toContain('150-300');
    expect(buildChatMainPrompt('medium').content).toContain('400-900');
    expect(buildChatMainPrompt('medium').content).not.toContain('200-500');
    expect(buildFallbackPreset('userMessage', 'long').prompts[0]!.content).toContain('800-1500');
    const novel = buildFallbackPreset('directive', 'long').prompts[0]!;
    expect(novel.content).not.toContain('800-1500');
    expect(novel.content).toContain('1500 字'); // novel 固定章长文案保持不变
  });
});

describe('自动连播状态机（四问④）', () => {
  it('连发序列：开启后自动连发 members.length 轮暂停；中途手动发送重置配额（防无限自嗨）', () => {
    let s = autoToggle(INITIAL_AUTO_STATE, 2); // 开启自动 → 满额配额
    expect(s).toEqual({ enabled: true, remaining: 2 });
    expect(autoShouldSend(s)).toBe(true);
    s = autoConsume(s); // 自动发第 1 轮
    expect(s.remaining).toBe(1);
    s = autoOnManualSend(s, 2); // 中途用户手动插一轮 → 配额重置为满额
    expect(s.remaining).toBe(2);
    s = autoConsume(s); // 自动发（1）
    s = autoConsume(s); // 自动发（2）
    expect(s.remaining).toBe(0);
    expect(autoShouldSend(s)).toBe(false); // 配额尽 → 暂停等待用户
    expect(AUTO_CHAT_DELAY_MS).toBe(1500); // 任务定义的轮间隔
  });

  it('toggle 开关：开启发满配额、关闭复位；关闭状态下手动发送不激活', () => {
    expect(autoToggle(INITIAL_AUTO_STATE, 3)).toEqual({ enabled: true, remaining: 3 });
    expect(autoToggle({ enabled: true, remaining: 3 }, 3)).toEqual(INITIAL_AUTO_STATE);
    const off = autoOnManualSend(INITIAL_AUTO_STATE, 3);
    expect(off.enabled).toBe(false);
    expect(autoShouldSend(off)).toBe(false);
  });
});
