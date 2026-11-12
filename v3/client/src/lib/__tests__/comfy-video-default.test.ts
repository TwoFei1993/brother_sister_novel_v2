/**
 * 本地视频默认 workflow 单测：H3 内置模板占位符 + effectiveVideoWorkflow 默认逻辑 + 时长→帧数换算
 */
import { describe, expect, it } from 'vitest';

import { effectiveVideoWorkflow, framesForDuration } from '../../features/duanju/lib/comfy';
import { HYPERFLOW_I2V_DEFAULT_WORKFLOW } from '../../features/duanju/lib/comfyDefaultWorkflow';
import type { ComfyuiConfig } from '../../features/duanju/lib/comfy';

describe('HYPERFLOW_I2V_DEFAULT_WORKFLOW（内置 H3 视频模板）', () => {
  it('三个占位符齐备且为合法 JSON', () => {
    expect(HYPERFLOW_I2V_DEFAULT_WORKFLOW).toContain('<<FRAME>>');
    expect(HYPERFLOW_I2V_DEFAULT_WORKFLOW).toContain('<<PROMPT>>');
    expect(HYPERFLOW_I2V_DEFAULT_WORKFLOW).toContain('<<LENGTH>>');
    const parsed = JSON.parse(HYPERFLOW_I2V_DEFAULT_WORKFLOW) as Record<string, { class_type: string }>;
    const types = Object.values(parsed).map((n) => n.class_type);
    expect(types).toContain('HyperFlowLoader');
    expect(types).toContain('MiniMaxH3ImageToVideo');
    expect(types).toContain('SaveVideo');
  });

  it('<<LENGTH>>/<<SEED>> 位于注入位，画布竖屏 768×1344 与分镜帧同比例免缩放', () => {
    const parsed = JSON.parse(HYPERFLOW_I2V_DEFAULT_WORKFLOW) as Record<
      string,
      { class_type: string; inputs: Record<string, unknown> }
    >;
    const node = Object.values(parsed).find((n) => n.class_type === 'MiniMaxH3ImageToVideo');
    expect(node?.inputs.length).toBe('<<LENGTH>>');
    expect(node?.inputs.width).toBe(768);
    expect(node?.inputs.height).toBe(1344);
    expect(HYPERFLOW_I2V_DEFAULT_WORKFLOW).toContain('<<SEED>>');
  });
});

describe('effectiveVideoWorkflow（空模板 = 内置默认）', () => {
  it('空/空白模板回退内置 H3 默认', () => {
    const empty: ComfyuiConfig = { url: 'http://127.0.0.1:8188', videoWorkflow: '', imageWorkflow: '' };
    expect(effectiveVideoWorkflow(empty)).toBe(HYPERFLOW_I2V_DEFAULT_WORKFLOW);
    const blank: ComfyuiConfig = { url: '', videoWorkflow: '   \n  ', imageWorkflow: '' };
    expect(effectiveVideoWorkflow(blank)).toBe(HYPERFLOW_I2V_DEFAULT_WORKFLOW);
  });

  it('用户自定义模板优先', () => {
    const custom: ComfyuiConfig = { url: '', videoWorkflow: '{"1":{"class_type":"X"}}', imageWorkflow: '' };
    expect(effectiveVideoWorkflow(custom)).toBe('{"1":{"class_type":"X"}}');
  });
});

describe('framesForDuration（时长→帧数，24fps snap 17k+5）', () => {
  it('教程/官方基准秒数换算', () => {
    expect(framesForDuration(3)).toBe(73); // 17*4+5
    expect(framesForDuration(5)).toBe(124); // 17*7+5（官方默认）
    expect(framesForDuration(8)).toBe(192); // 17*11+5
    expect(framesForDuration(10)).toBe(243); // 17*14+5（INT8 t2v 默认）
  });

  it('raw%17 > 5 的负取模盲区（JS % 语义修正回归）', () => {
    expect(framesForDuration(4)).toBe(107); // raw 96，96%17=11 → +11 = 107 = 17*6+5（未修正会得 90）
    expect(framesForDuration(2)).toBe(56); // raw 48，48%17=14 → +8 = 56 = 17*3+5
  });

  it('短于/等于下限：不足 5 帧兜底 max(5,·)，结果仍落 17k+5 网格', () => {
    for (const sec of [0, 0.2, 1, 2, 4, 6, 12]) {
      const f = framesForDuration(sec);
      expect(f >= 5).toBe(true);
      expect((f - 5) % 17).toBe(0); // 网格校验
    }
  });

  it('时长越大帧数单调不减', () => {
    let prev = 0;
    for (const sec of [1, 2, 3, 5, 8, 10, 15]) {
      const f = framesForDuration(sec);
      expect(f).toBeGreaterThanOrEqual(prev);
      prev = f;
    }
  });
});
