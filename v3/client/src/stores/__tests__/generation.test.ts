/**
 * generationStore 状态机测试（设计 §9.2 生成事务性）：
 * start → appendChunk×N → finish（入库前 buffer 保留）/ fail（错误或用户停止）/ reset
 * 多槽化（2026-11-21 M2 Chunk 4）：per-work 槽位——双书并发互不干扰 / A finish 不动 B buffer /
 * reset 保留 finishReason（「上次输出结束原因」供截断续写判据在 finalize 后读取）。
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { getGenSlot, selectStreamingWorkId, useGenerationStore } from '../generation';

const slotOf = (workId: string) => getGenSlot(workId)!;

beforeEach(() => {
  useGenerationStore.setState({ slots: {} });
});

describe('generationStore 状态机（per-work 槽位）', () => {
  it('start 置流式态并登记目标消息', () => {
    useGenerationStore.getState().start('w1', 'm1');
    const s = slotOf('w1');
    expect(s.streaming).toBe(true);
    expect(s.buffer).toBe('');
    expect(s.targetMessageId).toBe('m1');
    expect(s.error).toBeNull();
    expect(s.partialKept).toBe(false);
  });

  it('appendChunk 累加 buffer，不影响流式态', () => {
    const g = useGenerationStore.getState();
    g.start('w1', 'm1');
    g.appendChunk('w1', '第一');
    g.appendChunk('w1', '章');
    const s = slotOf('w1');
    expect(s.buffer).toBe('第一章');
    expect(s.streaming).toBe(true);
  });

  it('finish 结束流式但保留 buffer（入库前供读取）', () => {
    const g = useGenerationStore.getState();
    g.start('w1', 'm1');
    g.appendChunk('w1', '正文');
    g.finish('w1');
    const s = slotOf('w1');
    expect(s.streaming).toBe(false);
    expect(s.buffer).toBe('正文');
    expect(s.error).toBeNull();
  });

  it('fail 置错误与 partialKept（断流保留半成品路径）', () => {
    const g = useGenerationStore.getState();
    g.start('w1', 'm1');
    g.appendChunk('w1', '半成品');
    g.fail('w1', { code: 'LLM_NET', message: '连接中断' }, true);
    const s = slotOf('w1');
    expect(s.streaming).toBe(false);
    expect(s.error).toEqual({ code: 'LLM_NET', message: '连接中断' });
    expect(s.partialKept).toBe(true);
    expect(s.buffer).toBe('半成品');
  });

  it('fail(null) 表示用户主动停止：无错误但保留半成品', () => {
    const g = useGenerationStore.getState();
    g.start('w1', 'm1');
    g.appendChunk('w1', '已写部分');
    g.fail('w1', null, true);
    const s = slotOf('w1');
    expect(s.streaming).toBe(false);
    expect(s.error).toBeNull();
    expect(s.partialKept).toBe(true);
  });

  it('无产出即失败：partialKept=false', () => {
    const g = useGenerationStore.getState();
    g.start('w1', 'm1');
    g.fail('w1', { code: 'LLM_AUTH', message: '密钥无效' }, false);
    const s = slotOf('w1');
    expect(s.partialKept).toBe(false);
    expect(s.error?.code).toBe('LLM_AUTH');
  });

  it('start 的 initialBuffer 支撑「继续」场景（半成品作基底）', () => {
    useGenerationStore.getState().start('w1', 'm1', '已有开头');
    const s = slotOf('w1');
    expect(s.buffer).toBe('已有开头');
    expect(s.streaming).toBe(true);
  });

  it('reset 清空生成现场但保留 finishReason（截断续写判据在 finalize 后读取）', () => {
    const g = useGenerationStore.getState();
    g.start('w1', 'm1');
    g.appendChunk('w1', 'x');
    g.setFinishReason('w1', 'length');
    g.fail('w1', { code: 'LLM_NET', message: 'e' }, true);
    g.reset('w1');
    const s = slotOf('w1');
    expect(s).toMatchObject({
      streaming: false,
      buffer: '',
      targetMessageId: null,
      error: null,
      partialKept: false,
      finishReason: 'length', // 唯一保留：结果元数据语义
    });
  });

  it('clearError 只清错误，保留半成品与 partialKept', () => {
    const g = useGenerationStore.getState();
    g.start('w1', 'm1');
    g.appendChunk('w1', '半成品');
    g.fail('w1', { code: 'LLM_TIMEOUT', message: '超时' }, true);
    g.clearError('w1');
    const s = slotOf('w1');
    expect(s.error).toBeNull();
    expect(s.buffer).toBe('半成品');
    expect(s.partialKept).toBe(true);
    expect(s.streaming).toBe(false);
  });

  it('setTaskId 记录/清除后台任务 id（undefined 时字段移除）', () => {
    const g = useGenerationStore.getState();
    g.start('w1', 'm1');
    g.setTaskId('w1', 'task-1');
    expect(slotOf('w1').taskId).toBe('task-1');
    g.setTaskId('w1', undefined);
    expect(slotOf('w1').taskId).toBeUndefined();
  });
});

describe('generationStore 多槽并发（M2 Chunk 4）', () => {
  it('双书并发槽互不干扰：各自 append/fail 只作用于本槽', () => {
    const g = useGenerationStore.getState();
    g.start('wA', 'mA');
    g.start('wB', 'mB');
    g.appendChunk('wA', '甲书正文');
    g.appendChunk('wB', '乙书正文');
    g.fail('wA', { code: 'LLM_TIMEOUT', message: '超时' }, true);
    expect(slotOf('wA')).toMatchObject({ buffer: '甲书正文', streaming: false, error: { code: 'LLM_TIMEOUT' } });
    expect(slotOf('wB')).toMatchObject({ buffer: '乙书正文', streaming: true, error: null });
  });

  it('A finish/reset 不影响 B 的 buffer（入库收束只收本书槽）', () => {
    const g = useGenerationStore.getState();
    g.start('wA', 'mA');
    g.start('wB', 'mB');
    g.appendChunk('wB', '乙书在写的内容');
    g.finish('wA');
    g.reset('wA');
    expect(slotOf('wA').buffer).toBe('');
    expect(slotOf('wB')).toMatchObject({ buffer: '乙书在写的内容', streaming: true });
  });

  it('selectStreamingWorkId：任一 streaming 槽的 workId（旧全局语义兼容）', () => {
    const g = useGenerationStore.getState();
    expect(selectStreamingWorkId(useGenerationStore.getState())).toBeNull();
    g.start('wA', 'mA');
    expect(selectStreamingWorkId(useGenerationStore.getState())).toBe('wA');
    g.start('wB', 'mB');
    g.finish('wA');
    expect(selectStreamingWorkId(useGenerationStore.getState())).toBe('wB');
  });

  it('未 start 的书 appendChunk 不产生半初始化脏槽', () => {
    useGenerationStore.getState().appendChunk('wGhost', '孤儿文本');
    expect(useGenerationStore.getState().slots.wGhost).toBeUndefined();
  });
});
