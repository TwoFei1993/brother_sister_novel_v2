/**
 * 短剧试验台数据模型测试（设计共识 2026-11-26 第 2 节；M2 增强：参考图）
 */
import { describe, expect, it } from 'vitest';

import {
  CLOUD_IMAGE_SIZES,
  EMPTY_LAB_FILE,
  LAB_PROMPT_LIMITS,
  LAB_REF_LIMITS,
  LabFileSchema,
  LabGenerateBodySchema,
  LabInputSchema,
  LabRecordSchema,
  LabRefUploadedSchema,
  LabTaskCheckpointSchema,
  LabUploadMetaSchema,
} from '../duanju/lab';

const ref = { path: 'duanju/images/labref-0f3a9c1e-7b2d-4e6f.png', caption: '底图：客厅夜景' };

const meta = {
  brief: '雨夜霓虹街头的女剑客',
  prompt: '电影感单帧……',
  kind: 'free',
  aspect: '9:16',
  width: 768,
  height: 1344,
  characterIds: [],
  sceneIds: [],
  refs: [] as unknown[],
};

function record(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'lab-1',
    createdAt: 1,
    brief: '雨夜霓虹街头的女剑客',
    prompt: '电影感单帧……',
    kind: 'free',
    provider: 'comfy',
    aspect: '9:16',
    width: 768,
    height: 1344,
    seed: 42,
    refs: [],
    characterIds: [],
    sceneIds: [],
    image: { id: 'img-1', path: 'duanju/images/a.png', prompt: '电影感单帧……', createdAt: 1 },
    elapsedSec: 91,
    ...overrides,
  };
}

describe('LabRecordSchema', () => {
  it('合法记录通过；三种通道 × 四种画幅 × 四种画面类型均为合法枚举', () => {
    for (const provider of ['comfy', 'seedream', 'zhipu']) {
      for (const aspect of ['9:16', '16:9', '1:1', '4:5']) {
        for (const kind of ['free', 'character', 'scene', 'frame']) {
          expect(LabRecordSchema.safeParse(record({ provider, aspect, kind })).success).toBe(true);
        }
      }
    }
  });

  it('未知字段 / 非法枚举 / 空提示词 / 超过 3 张参考图 → 拒绝', () => {
    expect(LabRecordSchema.safeParse(record({ hack: true })).success).toBe(false);
    expect(LabRecordSchema.safeParse(record({ provider: 'minimax' })).success).toBe(false);
    expect(LabRecordSchema.safeParse(record({ prompt: '' })).success).toBe(false);
    expect(LabRecordSchema.safeParse(record({ refs: [ref, ref, ref, ref] })).success).toBe(false);
    expect(LabRecordSchema.safeParse(record({ seed: -1 })).success).toBe(false);
  });

  it('通道提示词上限：本地 3000 / Seedream 2000 / GLM 1000；参考图上限 3 / 1 / 0', () => {
    expect(LAB_PROMPT_LIMITS).toEqual({ comfy: 3000, seedream: 2000, zhipu: 1000 });
    expect(LAB_REF_LIMITS).toEqual({ comfy: 3, seedream: 1, zhipu: 0 });
  });
});

describe('参考图（refs）', () => {
  it('路径 + 说明的记录合法；png 与 jpg 都认', () => {
    expect(LabRecordSchema.safeParse(record({ refs: [ref, { path: 'duanju/images/labref-1a2b3c4d.jpg', caption: '' }] })).success).toBe(
      true,
    );
    expect(LabRefUploadedSchema.safeParse({ path: ref.path }).success).toBe(true);
  });

  it('路径不在上传白名单内 → 拒绝（别的目录 / 别的文件名 / webp / 目录穿越）', () => {
    const bad = [
      'duanju/images/a.png',
      'duanju/images/labref-x.png', // 文件名不是 uuid 段
      'duanju/images/labref-0f3a9c1e.webp',
      'data/secrets.json',
      'duanju/images/../../secrets.json',
      '/etc/passwd',
    ];
    for (const path of bad) {
      expect(LabRecordSchema.safeParse(record({ refs: [{ path, caption: '' }] })).success).toBe(false);
      expect(LabRefUploadedSchema.safeParse({ path }).success).toBe(false);
    }
  });

  it('说明过长 → 拒绝', () => {
    expect(LabRecordSchema.safeParse(record({ refs: [{ ...ref, caption: '长'.repeat(201) }] })).success).toBe(false);
  });
});

describe('客户端检查点（规则放这里：客户端包不依赖 zod）', () => {
  const checkpoint = {
    brief: '一句话',
    prompt: '完整提示词',
    kind: 'free',
    aspect: '9:16',
    width: 768,
    height: 1344,
    provider: 'comfy',
    seed: 42,
    refs: [ref],
    characterIds: [],
    sceneIds: [],
    base: 'http://127.0.0.1:8188',
    promptId: 'pid-1',
    startedAt: 100,
  };

  it('出图检查点：归档字段 + 引擎任务号；缺任务号、路径不在白名单、带未知字段 → 拒绝', () => {
    expect(LabTaskCheckpointSchema.safeParse(checkpoint).success).toBe(true);
    expect(LabTaskCheckpointSchema.safeParse({ ...checkpoint, promptId: '' }).success).toBe(false);
    expect(LabTaskCheckpointSchema.safeParse({ ...checkpoint, refs: [{ path: '../secrets.json', caption: '' }] }).success).toBe(false);
    expect(LabTaskCheckpointSchema.safeParse({ ...checkpoint, elapsedSec: 3 }).success).toBe(false);
  });

  it('输入参数：语言只认 zh / en；brief 可为空、不超过 300 字', () => {
    const input = { brief: '', kind: 'frame', aspect: '16:9', language: 'en', provider: 'comfy', characterIds: [], sceneIds: [], refs: [ref] };
    expect(LabInputSchema.safeParse(input).success).toBe(true);
    expect(LabInputSchema.safeParse({ ...input, language: 'ja' }).success).toBe(false);
    expect(LabInputSchema.safeParse({ ...input, brief: 'x'.repeat(301) }).success).toBe(false);
  });
});

describe('LabFileSchema', () => {
  it('空文件合法', () => {
    expect(LabFileSchema.parse(EMPTY_LAB_FILE)).toEqual({ records: [] });
    expect(LabFileSchema.safeParse({}).success).toBe(false);
    expect(LabFileSchema.safeParse({ records: [record()] }).success).toBe(true);
  });
});

describe('请求体契约', () => {
  it('云端生成：seedream / zhipu 合法；comfy 与未知字段拒绝', () => {
    expect(LabGenerateBodySchema.safeParse({ ...meta, provider: 'seedream' }).success).toBe(true);
    expect(LabGenerateBodySchema.safeParse({ ...meta, provider: 'zhipu' }).success).toBe(true);
    expect(LabGenerateBodySchema.safeParse({ ...meta, provider: 'comfy' }).success).toBe(false);
    expect(LabGenerateBodySchema.safeParse({ ...meta, provider: 'seedream', seed: 1 }).success).toBe(false);
  });

  it('本地回流 meta：须带 seed / refs / elapsedSec 且 provider=comfy', () => {
    const ok = { ...meta, provider: 'comfy', seed: 42, elapsedSec: 91 };
    expect(LabUploadMetaSchema.safeParse(ok).success).toBe(true);
    expect(LabUploadMetaSchema.safeParse(meta).success).toBe(false);
    expect(LabUploadMetaSchema.safeParse({ ...ok, elapsedSec: -1 }).success).toBe(false);
    expect(LabUploadMetaSchema.safeParse({ ...ok, refPaths: [] }).success).toBe(false); // 旧字段名不再认
  });

  it('云端尺寸表：两通道比例一致；关键尺寸与服务端历史取值相同', () => {
    expect(Object.keys(CLOUD_IMAGE_SIZES.seedream)).toEqual(Object.keys(CLOUD_IMAGE_SIZES.zhipu));
    expect(CLOUD_IMAGE_SIZES.seedream['9:16']).toBe('1440x2560');
    expect(CLOUD_IMAGE_SIZES.seedream['3:4']).toBe('1536x2048');
    expect(CLOUD_IMAGE_SIZES.zhipu['1:1']).toBe('1024x1024');
    expect(CLOUD_IMAGE_SIZES.zhipu['3:4']).toBe('864x1152');
    for (const table of Object.values(CLOUD_IMAGE_SIZES)) {
      for (const size of Object.values(table)) expect(size).toMatch(/^\d+x\d+$/);
    }
  });
});
