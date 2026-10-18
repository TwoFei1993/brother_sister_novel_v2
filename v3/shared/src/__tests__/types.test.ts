/**
 * shared 类型与 schema 测试（TDD）
 *
 * 样本来源（真实酒馆资产，roundtrip 可信度最高）：
 * - 世界书条目：酒馆 default/content/Eldoria.json 第一条（含 role:null、
 *   delayUntilRecursion:false、displayIndex 等真实脏数据）
 * - 预设：default/content/presets/openai/Default.json
 * - V2 卡：default/content/default_Seraphina.png tEXt chunk 提取
 *   （解析逻辑对照酒馆 src/character-card-parser.js：keyword + NUL + base64，ccv3 优先）
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CharacterAssetSchema,
  MessageSchema,
  PresetAssetSchema,
  TavernCardV2Schema,
  TavernPresetSchema,
  TavernPromptSchema,
  TavernRegexScriptSchema,
  TavernWorldInfoEntrySchema,
  WorldbookAssetSchema,
  WorkSchema,
  defaultNovelSettings,
} from '../index';

// ---------- 真实样本加载 ----------
const repoRoot = resolve(fileURLToPath(import.meta.url), '../../../../..');
const tavernContent = resolve(repoRoot, '酒馆代码/SillyTavern/default/content');

/** 对照酒馆 character-card-parser.js read()：tEXt chunk，ccv3 优先于 chara */
function readCardFromPng(buf: Buffer): unknown {
  let off = 8;
  const texts: Array<{ keyword: string; text: string }> = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const name = buf.toString('ascii', off + 4, off + 8);
    if (name === 'tEXt') {
      const data = buf.subarray(off + 8, off + 8 + len);
      const nul = data.indexOf(0);
      texts.push({
        keyword: data.toString('ascii', 0, nul),
        text: data.subarray(nul + 1).toString('latin1'),
      });
    }
    off += 12 + len;
    if (name === 'IEND') break;
  }
  const pick =
    texts.find((t) => t.keyword.toLowerCase() === 'ccv3') ??
    texts.find((t) => t.keyword.toLowerCase() === 'chara');
  if (!pick) throw new Error('PNG 无 chara/ccv3 元数据');
  return JSON.parse(Buffer.from(pick.text, 'base64').toString('utf8'));
}

const eldoria = JSON.parse(readFileSync(resolve(tavernContent, 'Eldoria.json'), 'utf8'));
const eldoriaEntry0 = Object.values(eldoria.entries)[0] as Record<string, unknown>;
const defaultPreset = JSON.parse(
  readFileSync(resolve(tavernContent, 'presets/openai/Default.json'), 'utf8'),
);
const seraphinaCard = readCardFromPng(
  readFileSync(resolve(tavernContent, 'default_Seraphina.png')),
);

// ---------- 内部格式：严格校验 ----------
describe('MessageSchema（内部，strict）', () => {
  const valid = {
    id: 'm-1',
    role: 'assistant',
    name: '小说家',
    content: '# 第1章 风起\n正文……',
    createdAt: 1_760_000_000_000,
    swipes: ['第一版', '第二版'],
    swipeId: 0,
    chapter: { index: 1, title: '风起' },
    directive: '写第一章，兄妹初遇',
    extra: { model: 'gpt-test', tokenCount: 1024, activatedEntries: ['0'] },
  };

  it('合法样本通过 schema', () => {
    const r = MessageSchema.safeParse(valid);
    expect(r.success).toBe(true);
  });

  it('缺 id 拒绝', () => {
    const { id: _omit, ...rest } = valid;
    expect(MessageSchema.safeParse(rest).success).toBe(false);
  });

  it('未知字段拒绝（strict 防脏数据）', () => {
    expect(MessageSchema.safeParse({ ...valid, typoField: 1 }).success).toBe(false);
  });

  it('role 非法值拒绝', () => {
    expect(MessageSchema.safeParse({ ...valid, role: 'system' }).success).toBe(false);
  });
});

describe('WorkSchema / NovelSettingsSchema（内部，strict）', () => {
  const valid: Record<string, unknown> = {
    id: 'w-1',
    revision: 3,
    title: '兄妹修仙传',
    mode: 'novel',
    genre: 'xuanhuan',
    characterIds: ['c1', 'c2'],
    worldbookIds: ['wb1'],
    presetId: 'p1',
    regexScriptIds: [],
    settings: {
      ...defaultNovelSettings,
      authorNote: '保持兄妹羁绊主线，勿写崩人设',
      noteDepth: 4,
    },
    voiceMap: { 哥哥: 'yj_emale', 妹妹: 'yj_female' },
    viewPreference: 'b',
    createdAt: 1_760_000_000_000,
    updatedAt: 1_760_000_100_000,
  };

  it('合法样本通过（含 authorNote/noteDepth）', () => {
    expect(WorkSchema.safeParse(valid).success).toBe(true);
  });

  it('settings 缺 authorNote 拒绝（新字段必填）', () => {
    const s = { ...defaultNovelSettings };
    delete (s as Record<string, unknown>).authorNote;
    expect(WorkSchema.safeParse({ ...valid, settings: s }).success).toBe(false);
  });

  it('mode 非法值拒绝', () => {
    expect(WorkSchema.safeParse({ ...valid, mode: 'script' }).success).toBe(false);
  });

  it('旧站 NovelSettings 字段全量可解析（genre/人设/关系/基调/章数/大纲）', () => {
    const settings = WorkSchema.shape.settings.parse({
      ...defaultNovelSettings,
      genre: 'hunhe',
      brotherPersonalities: ['冷酷腹黑', '疯批危险'],
      sisterPersonalities: ['表面软萌实则腹黑'],
      relationType: '妹妹反向救赎哥哥型',
      storyTones: ['热血爽文', '虐中带甜'],
      writingStyle: 'qidian',
      desiredChapterCount: 80,
      outlineChapterCount: 80,
      pastedOutline: '第一章……',
    });
    expect(settings.brotherPersonalities).toHaveLength(2);
    expect(settings.noteDepth).toBe(4);
  });
});

// ---------- 酒馆原生格式：宽松校验 + passthrough 保留未知字段 ----------
describe('TavernWorldInfoEntrySchema（酒馆原生，passthrough）', () => {
  it('Eldoria.json 第一条真实数据通过（含 role:null、delayUntilRecursion:false 脏数据）', () => {
    const r = TavernWorldInfoEntrySchema.safeParse(eldoriaEntry0);
    expect(r.success).toBe(true);
  });

  it('未知字段 displayIndex 原样保留（roundtrip 不丢）', () => {
    const r = TavernWorldInfoEntrySchema.parse(eldoriaEntry0) as Record<string, unknown>;
    expect(r.displayIndex).toBe(0);
    // 已知脏类型也原样保留
    expect(r.role).toBeNull();
    expect(r.delayUntilRecursion).toBe(false);
  });

  it('JSON.stringify roundtrip 深比较无字段丢失', () => {
    const parsed = TavernWorldInfoEntrySchema.parse(eldoriaEntry0);
    expect(JSON.parse(JSON.stringify(parsed))).toEqual(eldoriaEntry0);
  });

  it('缺 uid 拒绝', () => {
    expect(TavernWorldInfoEntrySchema.safeParse({ comment: 'no uid' }).success).toBe(false);
  });
});

describe('TavernPresetSchema / TavernPromptSchema（酒馆原生）', () => {
  it('Default.json prompts[0] 通过 TavernPromptSchema', () => {
    const r = TavernPromptSchema.safeParse(defaultPreset.prompts[0]);
    expect(r.success).toBe(true);
    expect(r.success && r.data.identifier).toBe('main');
  });

  it('Default.json 整体通过 TavernPresetSchema，官方采样键可读', () => {
    const r = TavernPresetSchema.safeParse(defaultPreset);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.temperature).toBe(1);
      expect(r.data.openai_max_tokens).toBe(300);
    }
  });

  it('prompt_order[1] character_id=100001（chat completion 排序）可读', () => {
    const parsed = TavernPresetSchema.parse(defaultPreset);
    const order = parsed.prompt_order?.find((o) => o.character_id === 100001);
    expect(order?.order[0]).toMatchObject({ identifier: 'main', enabled: true });
  });
});

describe('TavernCardV2Schema（酒馆原生，PNG 提取）', () => {
  it('Seraphina PNG 提取的 V2 卡通过 schema', () => {
    const r = TavernCardV2Schema.safeParse(seraphinaCard);
    expect(r.success).toBe(true);
  });

  it('spec/spec_version 与关键字段可读', () => {
    const card = TavernCardV2Schema.parse(seraphinaCard);
    expect(card.spec).toContain('chara_card_v');
    expect((card.data.name ?? '').length).toBeGreaterThan(0);
    expect((card.data.first_mes ?? '').length).toBeGreaterThan(0);
  });

  it('未知字段 group_only_greetings 保留（passthrough）', () => {
    const data = TavernCardV2Schema.parse(seraphinaCard).data as Record<string, unknown>;
    expect('group_only_greetings' in data).toBe(true);
  });

  it('spec 缺失拒绝', () => {
    expect(TavernCardV2Schema.safeParse({ data: { name: 'x' } }).success).toBe(false);
  });
});

describe('TavernRegexScriptSchema（酒馆原生）', () => {
  it('合法正则脚本通过', () => {
    const r = TavernRegexScriptSchema.safeParse({
      id: 'r1',
      scriptName: '去思考块',
      findRegex: '<think>[\\s\\S]*?</think>',
      replaceString: '',
      trimStrings: [],
      placement: [1, 2],
      disabled: false,
      markdownOnly: false,
      promptOnly: true,
      runOnEdit: true,
      substituteRegex: 0,
      minDepth: null,
      maxDepth: null,
    });
    expect(r.success).toBe(true);
  });
});

// ---------- 资产壳：内部 strict 壳 + 酒馆宽松 raw 组合 ----------
describe('资产壳 Schema（Character/Worldbook/Preset Asset）', () => {
  it('CharacterAsset：壳 strict + card 宽松组合可用', () => {
    const r = CharacterAssetSchema.safeParse({
      id: 'c1',
      name: 'Seraphina',
      card: seraphinaCard,
    });
    expect(r.success).toBe(true);
  });

  it('WorldbookAsset：Eldoria 原样入库', () => {
    const r = WorldbookAssetSchema.safeParse({ id: 'wb1', name: 'Eldoria', raw: eldoria });
    expect(r.success).toBe(true);
    if (r.success) {
      const keys = Object.keys((r.data.raw as { entries: object }).entries);
      expect(keys.length).toBeGreaterThan(0);
    }
  });

  it('PresetAsset：Default.json 原样入库', () => {
    const r = PresetAssetSchema.safeParse({ id: 'p1', name: 'Default', raw: defaultPreset });
    expect(r.success).toBe(true);
  });

  it('资产壳未知字段拒绝（strict），raw 内未知字段保留（passthrough）', () => {
    expect(
      WorldbookAssetSchema.safeParse({ id: 'x', name: 'x', raw: eldoria, oops: 1 }).success,
    ).toBe(false);
    const wb = WorldbookAssetSchema.parse({ id: 'x', name: 'x', raw: eldoria });
    const e0 = Object.values(
      (wb.raw as { entries: Record<string, Record<string, unknown>> }).entries,
    )[0];
    expect(e0.displayIndex).toBe(0);
  });
});
