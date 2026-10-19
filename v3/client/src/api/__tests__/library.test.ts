/**
 * describeAsset 展示摘要测试（审计 L5）：角色卡描述里的 {{char}} 宏
 * 在展示层替换为资产名（其余宏如 {{user}} 保留原样，不误伤编辑语义）。
 */
import { describe, expect, it } from 'vitest';
import type { CharacterAsset } from '@shared/card';

import { describeAsset } from '../library';

/** 最小合法 V2 卡资产（字段与 editors 测试 helper 同形，仅摘要所需） */
function characterAsset(name: string, description: string, firstMes?: string): CharacterAsset {
  return {
    id: 'c1',
    name,
    card: {
      spec: 'chara_card_v2',
      spec_version: '2.0',
      data: {
        name,
        description,
        alternate_greetings: [],
        extensions: {},
        ...(firstMes !== undefined ? { first_mes: firstMes } : {}),
      },
    },
  };
}

describe('describeAsset（审计 L5）', () => {
  it('角色卡描述中的 {{char}} 替换为资产名', () => {
    const s = describeAsset(characterAsset('妹妹', '{{char}}的身份是妹妹'));
    expect(s).toBe('妹妹的身份是妹妹');
  });

  it('其余宏（{{user}}）保留原样；description 缺失时回落 first_mes 并同样替换', () => {
    const s = describeAsset(characterAsset('Seraphina', '', '{{char}}看着{{user}}'));
    expect(s).toBe('Seraphina看着{{user}}');
  });

  it('卡无名字时 {{char}} 回落为「该角色」', () => {
    const a = characterAsset('', '{{char}}的身份未知');
    a.card.data.name = '';
    expect(describeAsset(a)).toBe('该角色的身份未知');
  });
});
