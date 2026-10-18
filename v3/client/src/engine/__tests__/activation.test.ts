/**
 * chat 激活策略测试（设计 §4.3，酒馆群聊 activation 简化版）
 *
 * 验收场景（§4.3）：3 成员 [哥哥, 妹妹, 配角]，lastSpeaker=哥哥：
 * - userText="让妹妹说话" → pick=妹妹（提及激活）
 * - userText 无提及      → pick=配角（自然轮换：哥哥的下一位）
 * - manualPick=哥哥      → pick=哥哥（手动指定优先于一切）
 */
import { describe, expect, it } from 'vitest';

import { pickSpeaker, type ChatMember } from '../prompt/activation';

const MEMBERS: ChatMember[] = [
  { id: 'gege', name: '哥哥' },
  { id: 'meimei', name: '妹妹' },
  { id: 'peijue', name: '配角' },
];

describe('pickSpeaker', () => {
  it('提及激活：userText 含成员名则激活该角色（验收场景）', () => {
    const pick = pickSpeaker(MEMBERS, 'gege', '让妹妹说话');
    expect(pick).toEqual({ id: 'meimei', name: '妹妹' });
  });

  it('多提及取靠后出现者（最新话题人物）', () => {
    // 妹妹先出现、哥哥后出现 → 取哥哥
    expect(pickSpeaker(MEMBERS, 'gege', '妹妹你觉得呢，还是让哥哥来说吧')).toEqual({
      id: 'gege',
      name: '哥哥',
    });
    // 反转语序 → 取妹妹
    expect(pickSpeaker(MEMBERS, 'gege', '哥哥先别急，让妹妹说')).toEqual({ id: 'meimei', name: '妹妹' });
  });

  it('@名字同样算提及', () => {
    expect(pickSpeaker(MEMBERS, 'gege', '@配角 你来介绍一下')).toEqual({ id: 'peijue', name: '配角' });
  });

  it('自然轮换：无提及时激活 lastSpeaker 的下一位，末位回绕到首位', () => {
    // 任务定义（权威）：「members 顺序中 lastSpeaker 的下一位」→ 哥哥的下一位是妹妹
    //（任务文本验收示例写「无提及→配角」与其自身定义矛盾，以定义为准，已在汇报注明）
    expect(pickSpeaker(MEMBERS, 'gege', '今天天气不错')).toEqual({ id: 'meimei', name: '妹妹' });
    expect(pickSpeaker(MEMBERS, 'meimei', '今天天气不错')).toEqual({ id: 'peijue', name: '配角' });
    // lastSpeaker=配角（末位）→ 回绕到首位哥哥
    expect(pickSpeaker(MEMBERS, 'peijue', '继续吧')).toEqual({ id: 'gege', name: '哥哥' });
  });

  it('lastSpeaker=null 或不在成员中 → 取首位', () => {
    expect(pickSpeaker(MEMBERS, null, '开场')).toEqual({ id: 'gege', name: '哥哥' });
    expect(pickSpeaker(MEMBERS, 'ghost-id', '开场')).toEqual({ id: 'gege', name: '哥哥' });
  });

  it('手动指定优先于提及检测（验收场景）', () => {
    const pick = pickSpeaker(MEMBERS, 'gege', '让妹妹说话', 'gege');
    expect(pick).toEqual({ id: 'gege', name: '哥哥' });
  });

  it('单成员恒定：无论提及/轮换/lastSpeaker 都激活唯一成员', () => {
    const solo: ChatMember[] = [{ id: 'only', name: '独角' }];
    expect(pickSpeaker(solo, null, '随便说')).toEqual({ id: 'only', name: '独角' });
    expect(pickSpeaker(solo, 'only', '随便说', 'only')).toEqual({ id: 'only', name: '独角' });
  });

  it('空成员列表抛错', () => {
    expect(() => pickSpeaker([], null, '你好')).toThrow(/成员/);
  });

  it('manualPickId 不在成员中 → 视为无效落回自动策略（自定决策）', () => {
    expect(pickSpeaker(MEMBERS, 'gege', '让妹妹说话', 'ghost-id')).toEqual({ id: 'meimei', name: '妹妹' });
  });
});
