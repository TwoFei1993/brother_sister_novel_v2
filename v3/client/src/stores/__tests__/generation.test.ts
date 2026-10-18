/**
 * generationStore 状态机测试（设计 §9.2 生成事务性）：
 * start → appendChunk×N → finish（入库前 buffer 保留）/ fail（错误或用户停止）/ reset
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { useGenerationStore } from '../generation';

beforeEach(() => {
  useGenerationStore.getState().reset();
});

describe('generationStore 状态机', () => {
  it('start 置流式态并登记作品与目标消息', () => {
    useGenerationStore.getState().start('w1', 'm1');
    const s = useGenerationStore.getState();
    expect(s.streaming).toBe(true);
    expect(s.buffer).toBe('');
    expect(s.workId).toBe('w1');
    expect(s.targetMessageId).toBe('m1');
    expect(s.error).toBeNull();
    expect(s.partialKept).toBe(false);
  });

  it('appendChunk 累加 buffer，不影响流式态', () => {
    const g = useGenerationStore.getState();
    g.start('w1', 'm1');
    g.appendChunk('第一');
    g.appendChunk('章');
    const s = useGenerationStore.getState();
    expect(s.buffer).toBe('第一章');
    expect(s.streaming).toBe(true);
  });

  it('finish 结束流式但保留 buffer（入库前供读取）', () => {
    const g = useGenerationStore.getState();
    g.start('w1', 'm1');
    g.appendChunk('正文');
    g.finish();
    const s = useGenerationStore.getState();
    expect(s.streaming).toBe(false);
    expect(s.buffer).toBe('正文');
    expect(s.error).toBeNull();
  });

  it('fail 置错误与 partialKept（断流保留半成品路径）', () => {
    const g = useGenerationStore.getState();
    g.start('w1', 'm1');
    g.appendChunk('半成品');
    g.fail({ code: 'LLM_NET', message: '连接中断' }, true);
    const s = useGenerationStore.getState();
    expect(s.streaming).toBe(false);
    expect(s.error).toEqual({ code: 'LLM_NET', message: '连接中断' });
    expect(s.partialKept).toBe(true);
    expect(s.buffer).toBe('半成品');
  });

  it('fail(null) 表示用户主动停止：无错误但保留半成品', () => {
    const g = useGenerationStore.getState();
    g.start('w1', 'm1');
    g.appendChunk('已写部分');
    g.fail(null, true);
    const s = useGenerationStore.getState();
    expect(s.streaming).toBe(false);
    expect(s.error).toBeNull();
    expect(s.partialKept).toBe(true);
  });

  it('无产出即失败：partialKept=false', () => {
    const g = useGenerationStore.getState();
    g.start('w1', 'm1');
    g.fail({ code: 'LLM_AUTH', message: '密钥无效' }, false);
    const s = useGenerationStore.getState();
    expect(s.partialKept).toBe(false);
    expect(s.error?.code).toBe('LLM_AUTH');
  });

  it('start 的 initialBuffer 支撑「继续」场景（半成品作基底）', () => {
    useGenerationStore.getState().start('w1', 'm1', '已有开头');
    const s = useGenerationStore.getState();
    expect(s.buffer).toBe('已有开头');
    expect(s.streaming).toBe(true);
  });

  it('reset 清空全部状态', () => {
    const g = useGenerationStore.getState();
    g.start('w1', 'm1');
    g.appendChunk('x');
    g.fail({ code: 'LLM_NET', message: 'e' }, true);
    g.reset();
    const s = useGenerationStore.getState();
    expect(s).toMatchObject({
      streaming: false,
      buffer: '',
      workId: null,
      targetMessageId: null,
      error: null,
      partialKept: false,
    });
  });

  it('clearError 只清错误，保留半成品与 partialKept', () => {
    const g = useGenerationStore.getState();
    g.start('w1', 'm1');
    g.appendChunk('半成品');
    g.fail({ code: 'LLM_TIMEOUT', message: '超时' }, true);
    g.clearError();
    const s = useGenerationStore.getState();
    expect(s.error).toBeNull();
    expect(s.buffer).toBe('半成品');
    expect(s.partialKept).toBe(true);
    expect(s.streaming).toBe(false);
  });
});
