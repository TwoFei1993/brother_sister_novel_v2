/**
 * 对话大纲迭代协议层测试（P2.3，深度测试 6 例）
 * 覆盖：关键词命中（含空格容错/不误触）/ 迭代消息组装 / 严格 JSON 解析（含坏格式兜底）/ 重写消息组装 / think 剥离
 */
import { describe, expect, it } from 'vitest';

import {
  ITER_KEYWORD,
  buildIterChatMessages,
  buildRewriteMessages,
  extractRewriteText,
  hitsIterKeyword,
  parseIterReply,
} from '../iter-llm';

describe('hitsIterKeyword（关键词触发）', () => {
  it('原文精确命中', () => {
    expect(hitsIterKeyword(`好的，${ITER_KEYWORD}`)).toBe(true);
  });

  it('手滑空格/换行不影响命中（规范化比对）', () => {
    expect(hitsIterKeyword('我确定 要给本书这一章节\n增加新的版本')).toBe(true);
  });

  it('近似表述不误触（少字/改字都不算）', () => {
    expect(hitsIterKeyword('我确定要给本书这一章增加新版本')).toBe(false);
    expect(hitsIterKeyword('我确定要给本书这一章节增加新的版本吗')).toBe(true); // 问句含完整关键词也命中（宽松包含）
    expect(hitsIterKeyword('随便聊聊天气')).toBe(false);
  });
});

describe('buildIterChatMessages（迭代对话组装）', () => {
  it('含书名 system、章节目录、历史（近 12 条）与用户消息，顺序正确', () => {
    const msgs = buildIterChatMessages({
      workTitle: '嫡女风华',
      chapters: [{ index: 1, title: '初入侯门', excerpt: '她睁开眼，发现自己成了侯府嫡女……' }],
      history: [
        { role: 'user', content: '第1章想加一场雨戏' },
        { role: 'assistant', content: '{"reply":"好","chapterIndex":1,"rewriteBrief":"加雨戏"}' },
      ],
      userText: '改成夜雨更压抑',
    });
    expect(msgs[0]!.role).toBe('system');
    expect(msgs[0]!.content).toContain('嫡女风华');
    expect(msgs[0]!.content).toContain('第1章《初入侯门》');
    expect(msgs.at(-1)).toMatchObject({ role: 'user', content: '改成夜雨更压抑' });
    expect(msgs).toHaveLength(4); // system + 2 历史 + user
  });
});

describe('parseIterReply（严格 JSON 解析）', () => {
  it('标准 JSON + 前后噪声文本均可解析', () => {
    const r = parseIterReply('好的，明白了。{"reply":"要改成夜雨吗？","chapterIndex":2,"rewriteBrief":null}请确认');
    expect(r).toEqual({ reply: '要改成夜雨吗？', chapterIndex: 2, rewriteBrief: null });
  });

  it('非 JSON / 缺 reply 字段 → null（调用方原文显示兜底）', () => {
    expect(parseIterReply('就是普通聊天，没有 JSON')).toBeNull();
    expect(parseIterReply('{"chapterIndex":1}')).toBeNull();
    expect(parseIterReply('{"reply":"x","chapterIndex":1.5}')).toMatchObject({ chapterIndex: null }); // 非整章号归 null
  });
});

describe('buildRewriteMessages + extractRewriteText（重写链路）', () => {
  it('重写消息含章号/要点/原文全文', () => {
    const msgs = buildRewriteMessages({
      workTitle: '嫡女风华',
      chapter: { index: 2, title: '夜宴', content: '宴席上，她端起酒杯……' },
      brief: '结尾加入反转：酒中有毒',
    });
    expect(msgs[0]!.role).toBe('system');
    expect(msgs[1]!.content).toContain('第2章 夜宴');
    expect(msgs[1]!.content).toContain('酒中有毒');
    expect(msgs[1]!.content).toContain('她端起酒杯');
  });

  it('extractRewriteText 剥 <think> 块留正文', () => {
    expect(extractRewriteText('<think>让我想想</think>正文开始')).toBe('正文开始');
    expect(extractRewriteText('<thinking>推导</thinking>\n正文A')).toBe('正文A');
    expect(extractRewriteText('干净正文')).toBe('干净正文');
  });
});
