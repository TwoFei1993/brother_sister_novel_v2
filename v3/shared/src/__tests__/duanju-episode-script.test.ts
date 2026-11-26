/**
 * 分集剧本与流水线的数据契约测试（设计共识 2026-11-26 第 3.1 / 3.6 节）
 * 重点：新增字段全部可选——旧作品数据不改也能通过校验。
 */
import { describe, expect, it } from 'vitest';

import {
  BuiltFromHintSchema,
  DuanjuPatchSchema,
  DuanjuProjectSchema,
  type DuanjuProject,
  PIPELINE_STEPS,
  PipelineCheckpointSchema,
  ScriptScopeSchema,
  newDuanjuProject,
} from '../duanju';

const now = 1_700_000_000_000;

/** 升级前的作品形状：没有任何分集剧本 / 流水线字段 */
function legacyProject(): DuanjuProject {
  const p = newDuanjuProject({ targetEpisodes: 12, style: '动漫风', protagonists: '' }, now);
  return JSON.parse(JSON.stringify(p)) as DuanjuProject;
}

describe('集的分集剧本字段（全部可选）', () => {
  it('旧作品数据原样通过；带新字段的数据也通过', () => {
    const legacy = legacyProject();
    const parsedLegacy = DuanjuProjectSchema.parse(legacy);
    expect(parsedLegacy.pipeline).toBeUndefined();

    const withFields = {
      ...legacy,
      script: { ...legacy.script, scope: 'full' },
      pipeline: { pauseAfterScripts: true },
      episodes: [
        {
          id: 'ep1',
          index: 1,
          title: '命纹灼烧',
          synopsis: '陆沉舟腕上命纹亮起……',
          script: '场1 内·宗门演武场·日\n陆沉舟一脚踹在木桩上。',
          scriptSource: 'adapted',
          scriptUpdatedAt: now,
          sourceStart: '铛——！',
          sourceEnd: '他才停下。',
        },
        { id: 'ep2', index: 2, title: '裂纹之钥', synopsis: '……' },
      ],
    };
    const parsed = DuanjuProjectSchema.parse(withFields);
    expect(parsed.episodes[0]!.scriptSource).toBe('adapted');
    expect(parsed.episodes[1]!.script).toBeUndefined();
    expect(parsed.script.scope).toBe('full');
    expect(parsed.pipeline?.pauseAfterScripts).toBe(true);
  });

  it('非法来源 / 非法原文性质 / 叙事机制超过 2 个 → 拒绝', () => {
    const bad = legacyProject();
    expect(
      DuanjuProjectSchema.safeParse({
        ...bad,
        episodes: [{ id: 'e', index: 1, title: 't', synopsis: 's', scriptSource: 'written' }],
      }).success,
    ).toBe(false);
    expect(DuanjuProjectSchema.safeParse({ ...bad, script: { ...bad.script, scope: 'whole' } }).success).toBe(false);
    expect(ScriptScopeSchema.options).toEqual(['full', 'episode1']);
    expect(
      DuanjuPatchSchema.safeParse({ revision: 1, episodes: [{ id: 'e', index: 1, title: 't', synopsis: 's', mechanisms: ['a', 'b', 'c'] }] })
        .success,
    ).toBe(false);
  });

  it('PATCH 可单独写 pipeline 与 episodes', () => {
    expect(DuanjuPatchSchema.safeParse({ revision: 3, pipeline: { pauseAfterScripts: false } }).success).toBe(true);
    expect(DuanjuPatchSchema.safeParse({ revision: 3, pipeline: { hack: 1 } }).success).toBe(false);
  });
});

describe('出图时的上游态快照', () => {
  it('接受全部可空的四项；拒绝负数时间戳', () => {
    expect(BuiltFromHintSchema.safeParse({}).success).toBe(true);
    expect(
      BuiltFromHintSchema.safeParse({ scriptAt: 1, charAt: { c1: 2 }, sceneAt: { s1: 3 }, episodeScriptAt: 0 }).success,
    ).toBe(true);
    expect(BuiltFromHintSchema.safeParse({ episodeScriptAt: -1 }).success).toBe(false);
  });
});

describe('流水线断点', () => {
  it('阶段顺序固定；断点可往返序列化', () => {
    expect(PIPELINE_STEPS).toEqual(['character', 'scene', 'script', 'storyboard']);
    const cp = {
      workId: 'w1',
      step: 'script',
      cursor: 3,
      taskId: 't-1',
      failed: [{ step: 'script', index: 2, reason: '模型未返回正文' }],
      paused: true,
      updatedAt: now,
    };
    expect(PipelineCheckpointSchema.parse(JSON.parse(JSON.stringify(cp)))).toEqual(cp);
    expect(PipelineCheckpointSchema.safeParse({ ...cp, step: 'export' }).success).toBe(false);
    expect(PipelineCheckpointSchema.safeParse({ ...cp, cursor: 0 }).success).toBe(false);
    expect(PipelineCheckpointSchema.safeParse({ ...cp, failed: [{ step: 'character', index: 1, reason: 'x' }] }).success).toBe(false);
  });
});
