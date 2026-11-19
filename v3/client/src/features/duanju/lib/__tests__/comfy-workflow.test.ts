/**
 * H3-Image 内置模板测试（comfyDefaultWorkflow.ts）
 *
 * 覆盖：三个生图模板 JSON 可解析、模型文件名指向已部署的 MiniMax-H3 权重、
 * 占位符齐全（文生图四件 / 参考通道 PROMPT+REF+SCENE_REF+SEED）、
 * 三参考模板的 image 槽语义（image_1=脸 image_2=全身 image_3=场景）、
 * 采样参数与实测一致（6 步 LCM / cfg 1 / tiled decode）、旧 Z-Image/2511 模板已移除。
 */
import { describe, expect, it } from 'vitest';

import {
  MINIMAX_H3_IMAGE_T2I_WORKFLOW,
  MINIMAX_H3_IMAGE_EDIT_WORKFLOW,
  MINIMAX_H3_IMAGE_EDIT_TRI_WORKFLOW,
} from '../comfyDefaultWorkflow';

/** 模板含裸占位符（<<WIDTH>>/<<HEIGHT>>/<<SEED>> 不带引号，提交前由 comfy.ts 替换）——parse 前替换成哑值；
 *  <<PROMPT>>/<<REF>> 等带引号的字符串占位符合法 JSON，保留原文以便断言引用关系 */
const parse = (tpl: string): Record<string, { class_type: string; inputs: Record<string, unknown> }> =>
  JSON.parse(tpl.replace('<<WIDTH>>', '704').replace('<<HEIGHT>>', '1024').replace('<<SEED>>', '42'));

const nodesOf = (tpl: string) => Object.values(parse(tpl));

describe('MINIMAX_H3_IMAGE_T2I_WORKFLOW（文生图默认）', () => {
  const g = parse(MINIMAX_H3_IMAGE_T2I_WORKFLOW);

  it('JSON 可解析且节点类型正确', () => {
    expect(g['1'].class_type).toBe('UNETLoader');
    expect(g['30'].class_type).toBe('MiniMaxH3ImageConditioning');
    expect(g['33'].class_type).toBe('VAEDecodeTiled');
  });

  it('模型指向 MiniMax-H3 已部署权重', () => {
    expect((g['1'].inputs.unet_name as string)).toBe('minimax_h3_image_pruned_int8_convrot.safetensors');
    expect((g['2'].inputs.clip_name as string)).toBe('qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors');
    expect((g['3'].inputs.vae_name as string)).toBe('minimax_h3_image_vae_fp16.safetensors');
  });

  it('占位符齐全（PROMPT/WIDTH/HEIGHT/SEED）', () => {
    expect(MINIMAX_H3_IMAGE_T2I_WORKFLOW).toContain('<<PROMPT>>');
    expect(MINIMAX_H3_IMAGE_T2I_WORKFLOW).toContain('<<WIDTH>>');
    expect(MINIMAX_H3_IMAGE_T2I_WORKFLOW).toContain('<<HEIGHT>>');
    expect(MINIMAX_H3_IMAGE_T2I_WORKFLOW).toContain('<<SEED>>');
  });

  it('采样参数与 2026-11-18 实测一致（6 步 LCM / cfg 1 / tiled 768）', () => {
    expect((g['37'].inputs.steps as number)).toBe(6);
    expect((g['36'].inputs.cfg as number)).toBe(1);
    expect((g['38'].class_type)).toBe('SamplerLCM');
    expect((g['33'].inputs.tile_size as number)).toBe(768);
  });

  it('文生图不连参考图槽', () => {
    const inputs = JSON.stringify(g['30'].inputs);
    expect(inputs).not.toContain('images.image_');
  });
});

describe('MINIMAX_H3_IMAGE_EDIT_WORKFLOW（双参考分镜帧）', () => {
  const g = parse(MINIMAX_H3_IMAGE_EDIT_WORKFLOW);

  it('image_1=定妆照 image_2=场景图，占位符齐全', () => {
    expect((g['1'].inputs.image as string)).toBe('<<REF>>');
    expect((g['2'].inputs.image as string)).toBe('<<SCENE_REF>>');
    expect(MINIMAX_H3_IMAGE_EDIT_WORKFLOW).toContain('<<PROMPT>>');
    expect(MINIMAX_H3_IMAGE_EDIT_WORKFLOW).toContain('<<SEED>>');
  });

  it('分镜帧尺寸固定 2016×3584（8 MP 档——四参考编辑实测可用上限，远景脸像素 ×7.5）', () => {
    expect((g['30'].inputs.width as number)).toBe(2016);
    expect((g['30'].inputs.height as number)).toBe(3584);
  });
});

describe('MINIMAX_H3_IMAGE_EDIT_TRI_WORKFLOW（三参考分镜帧）', () => {
  const g = parse(MINIMAX_H3_IMAGE_EDIT_TRI_WORKFLOW);
  const cond = g['30'].inputs as Record<string, unknown>;

  it('image_1=脸(REF) image_2=全身(BODY_REF) image_3=场景(SCENE_REF)', () => {
    expect((g['1'].inputs.image as string)).toBe('<<REF>>');
    expect((g['3'].inputs.image as string)).toBe('<<BODY_REF>>');
    expect((g['2'].inputs.image as string)).toBe('<<SCENE_REF>>');
    expect(cond['images.image_1']).toEqual(['1', 0]);
    expect(cond['images.image_2']).toEqual(['3', 0]);
    expect(cond['images.image_3']).toEqual(['2', 0]);
  });

  it('三槽连续（H3 自动增长输入要求键完整）', () => {
    expect(cond['images.image_1']).toBeDefined();
    expect(cond['images.image_2']).toBeDefined();
    expect(cond['images.image_3']).toBeDefined();
  });
});

describe('旧模板移除', () => {
  it('Z-Image 与 2511 模板不再导出（权重已删，防误用）', async () => {
    const mod = await import('../comfyDefaultWorkflow');
    expect(mod).not.toHaveProperty('Z_IMAGE_TURBO_DEFAULT_WORKFLOW');
    expect(mod).not.toHaveProperty('QWEN_EDIT_2511_WORKFLOW');
    expect(mod).not.toHaveProperty('QWEN_EDIT_2511_TRI_WORKFLOW');
  });
});
