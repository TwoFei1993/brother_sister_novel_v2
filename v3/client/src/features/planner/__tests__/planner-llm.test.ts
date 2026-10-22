/**
 * 聊天式创作向导协议层测试（纯函数）：解析/消息组装/章节设置转换
 */
import { describe, expect, it } from 'vitest';

import {
  parsePlannerReply,
  plannerMessages,
  proposalToChapterSettings,
  type PlannerProposal,
} from '../planner-llm';

const VALID_REPLY = JSON.stringify({
  reply: '策划案已生成，看看方向对不对？',
  questions: ['主角的金手指强度要再压一压吗？'],
  title: '末世净火',
  genre: '末世',
  outline: {
    characters: [
      { name: '苏檀', role: '妹妹', traits: ['冷静', '净化系'] },
      { name: '苏韧', role: '哥哥', traits: ['沉稳'] },
    ],
    background: '病毒爆发后的废土世界，幸存者聚居在据点中。',
    abilities: ['妹妹的净化异能'],
    factions: ['铁旗武装', '北城据点'],
    conflict: '净化异能是解药还是诱饵',
    chapters: [
      { index: 1, title: '第1章 废墟醒来', plot: '兄妹在废墟中醒来，遭遇丧尸，妹妹觉醒净化异能。' },
      { index: 2, title: '第2章 北城', plot: '兄妹抵达北城据点，遭遇排斥。' },
    ],
  },
});

describe('parsePlannerReply', () => {
  it('标准 JSON → reply/questions/完整策划案', () => {
    const r = parsePlannerReply(VALID_REPLY);
    expect(r?.reply).toContain('策划案已生成');
    expect(r?.questions).toHaveLength(1);
    expect(r?.proposal?.title).toBe('末世净火');
    expect(r?.proposal?.extracted.characters).toHaveLength(2);
    expect(r?.proposal?.extracted.chapters).toHaveLength(2);
  });

  it('容忍 ```json 包裹与尾随讨论文字', () => {
    const r = parsePlannerReply('好的：\n```json\n{"reply":"改好了","questions":[],"title":"T","genre":"都市","outline":{"characters":[{"name":"林昭","role":"主角","traits":["冷静"]}],"background":"都市。","abilities":[],"factions":[],"conflict":"K"}}\n```\n请过目');
    expect(r?.proposal?.title).toBe('T');
  });

  it('outline 为 null（纯闲聊）→ proposal null 但 reply 保留', () => {
    const r = parsePlannerReply('{"reply":"今天聊聊别的？","questions":[]}');
    expect(r?.reply).toBe('今天聊聊别的？');
    expect(r?.proposal).toBeNull();
  });

  it('无 JSON → null（调用方降级为纯文本显示）', () => {
    expect(parsePlannerReply('这不是 JSON')).toBeNull();
  });

  it('outline.characters 空数组 → proposal null（不可导入）', () => {
    const r = parsePlannerReply('{"reply":"x","title":"T","genre":"G","outline":{"characters":[],"background":"b"}}');
    expect(r?.proposal).toBeNull();
  });

  it('字段类型异常（characters 非数组）→ proposal null 不抛错', () => {
    const r = parsePlannerReply('{"reply":"x","outline":{"characters":"oops","background":1}}');
    expect(r?.proposal).toBeNull();
  });
});

describe('plannerMessages（对话组装）', () => {
  it('system 打头，历史居中', () => {
    const msgs = plannerMessages(
      [
        { role: 'user', content: '想写末世兄妹' },
        { role: 'assistant', content: '好的' },
      ],
      null,
    );
    expect(msgs[0]!.role).toBe('system');
    expect(msgs.at(-1)!.content).toBe('好的');
  });

  it('有策划案时追加基准 JSON 消息（修改继承用）', () => {
    const proposal: PlannerProposal = {
      title: '末世净火',
      genre: '末世',
      extracted: {
        characters: [{ name: '苏檀', role: '妹妹', traits: [] }],
        background: '废土',
        abilities: [],
        factions: [],
        conflict: '',
      },
    };
    const msgs = plannerMessages([], proposal);
    expect(msgs.at(-1)!.content).toContain('当前策划案基准');
    expect(msgs.at(-1)!.content).toContain('末世净火');
  });
});

describe('proposalToChapterSettings', () => {
  it('裁剪为三字段并取最大章号为目标章数', () => {
    const proposal: PlannerProposal = {
      title: 'T',
      genre: 'G',
      extracted: {
        characters: [],
        background: '',
        abilities: [],
        factions: [],
        conflict: '',
        chapters: [
          { index: 1, title: 'a', plot: 'pa', highlight: '多余字段' },
          { index: 5, title: 'b', plot: 'pb' },
        ],
      },
    };
    const s = proposalToChapterSettings(proposal);
    expect(s.chapterOutlines).toEqual([
      { index: 1, title: 'a', plot: 'pa' },
      { index: 5, title: 'b', plot: 'pb' },
    ]);
    expect(s.desiredChapterCount).toBe(5);
  });
});
