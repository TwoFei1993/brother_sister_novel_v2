/**
 * 场景提取提示词契约测试（2026-11-27 用户反馈：场景档案把故事结尾的道具状态带进前面集数的
 * 画面提示词——深度测试实测第 1 集 12 镜全带第 3 集结尾的「火车票/辣椒罐」）。
 * 提示词是提取质量的唯一闸门：在这里钉住「只写稳定视觉信息」的纪律。
 */
import { describe, expect, it } from 'vitest';

import { buildSceneExtractMessages, rebuildSceneSpecMessages } from '../sceneExtract';

describe('场景提取提示词：只写稳定视觉信息', () => {
  const [system, user] = buildSceneExtractMessages('剧本全文……');

  it('spec 字段改为「固定陈设与道具（场所本来有的）」', () => {
    expect(system.content).toContain('固定陈设与道具（只写这个场所本来就有的）');
    expect(system.content).not.toContain('关键道具及其位置');
  });

  it('写明纪律：不写随剧情变化的物件状态，剧情道具由每集剧本带入', () => {
    expect(system.content).toContain('不写随剧情变化的物件状态');
    expect(system.content).toContain('剧情道具由每集自己的剧本带入');
    // 用坏例子把「剧情状态」钉死（铁盒/纸条/灯灭正是实测穿帮的三样）
    expect(system.content).toContain('铁盒');
    expect(system.content).toContain('纸条');
    expect(system.content).toContain('灯不亮');
  });

  it('仍读剧本全文（地点清单要全）并保留好例子', () => {
    expect(user.content).toContain('剧本：');
    expect(system.content).toContain('价目表');
  });

  it('重写介绍走同一纪律', () => {
    const [rewriteSystem] = rebuildSceneSpecMessages('剧本', '深巷面馆', '旧档案');
    expect(rewriteSystem.content).toContain('不写随剧情变化的物件状态');
    expect(rewriteSystem.content).toContain('固定陈设与道具');
  });
});
