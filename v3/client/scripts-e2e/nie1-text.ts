/**
 * 聂小倩 EP1 实测 · 文本段：建作品 → 剧本（公版改编）→ LLM 拆解 → LLM 提角色 → 场景
 * 产物：workId + 完整 project（characters/scenes/episodes 就绪），写 nie-state.json 供 step2
 */
import { writeFileSync } from 'node:fs';

import { login, llmText } from './nie-lib';
import { getDuanjuProject, patchDuanjuProject } from '../src/api/duanju';
import { buildBreakdownMessages, parseBreakdown, mergeEpisodes } from '../src/features/duanju/lib/prompts/prompts-script';
import { buildCharacterExtractMessages, parseCharacterExtract } from '../src/features/duanju/lib/characterExtract';
import { buildSceneExtractMessages, parseSceneExtract } from '../src/features/duanju/lib/sceneExtract';

// 《聊斋·聂小倩》公版（蒲松龄）EP1 改编——对白驱动 + 悬疑钩子
const SCRIPT = `# 第一集 兰若寺夜遇

## 场1 外 · 金华城外山道 · 黄昏
宁采臣背着书箱走在黄昏的山道上，前方荒草深处露出一座古寺的飞檐。他加快脚步。
【画面文字】寺门匾额：兰若寺

## 场2 内 · 兰若寺大殿 · 夜
月色如水，洒在积灰的佛像上。宁采臣铺好草席，就着月光摊开书卷。殿外竹影摇动，池中野藕开得正盛。他低声自语。
宁采臣：平生不二色，此生不贪财——宁某虽穷，志不可夺。

## 场3 内 · 僧舍客房 · 深夜
宁采臣刚要睡下，忽听北窗外有女子低语。他吹熄烛火，透过石窗缝隙窥看：短墙外小院里，一个绯衣老妪与中年妇人立于月下。
妇人：小倩怎么还不见来？
老妪：就到了。她近来心中似有不平。
妇人：这点年纪，就不该让她知道太多。

## 场4 内 · 僧舍客房 · 深夜
门轴轻响。一名白衣少女立在门内，月光勾出她苍白的侧脸，眉眼极美。她缓步走向草席。
聂小倩：月夜睡不着，公子……可愿相伴？
宁采臣（正色）：姑娘请自重。深夜至此，你不怕物议，我怕人言。
聂小倩在席边站定，从袖中取出一锭黄金，轻轻放在褥上。金子在月下泛着冷光。
宁采臣：非义之财，污我囊橐！
他抓起金锭掷出门外。金锭落地的脆响在空寺里回荡。聂小倩怔住，俯身拾金，退到门口回头看他一眼，身影没入黑暗。
聂小倩（低语）：此人……是铁石心肠。

## 场5 内 · 兰若寺大殿廊下 · 黎明
晨雾漫过大殿。邻舍的兰溪生仆从仓皇跑过，哭声撕破寂静。宁采臣起身，只见燕赤霞（昨夜廊下结识的秦地剑客）按剑立于廊柱边，目光扫过殿北荒坟的方向。
宁采臣：昨夜……寺中死了人。足心血孔，如锥刺。
燕赤霞（沉声）：是魅。今夜，与我同室。
（黑场。远处乌鸦惊起。）
【画面文字】下集：夜叉索命`;

async function main(): Promise<void> {
  await login();

  // ① 建作品
  const createRes = await fetch('/api/works', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: '兰若寺·聂小倩',
      mode: 'duanju',
      genre: 'xuanhuan',
      duanju: { targetEpisodes: 6, style: '国漫', protagonists: '宁采臣：正直清贫书生；聂小倩：被妖物胁迫的温柔女鬼；燕赤霞：沉默寡言的秦地剑客' },
    }),
  });
  if (!createRes.ok) throw new Error(`建作品失败 ${createRes.status}: ${await createRes.text()}`);
  const { id: workId } = (await createRes.json()) as { id: string };
  console.log('[1] 建作品 ok:', workId);

  // ② 写剧本 + 定稿
  let project = await getDuanjuProject(workId);
  project = await patchDuanjuProject(workId, {
    revision: project.revision,
    script: { source: 'pasted', text: SCRIPT, confirmed: true, updatedAt: Date.now() },
  });
  console.log('[2] 剧本写入+定稿 ok');

  // ③ LLM 拆解（审核卡 + 分集）
  const breakdownRaw = await llmText(buildBreakdownMessages(SCRIPT, 6));
  const breakdown = parseBreakdown(breakdownRaw);
  if (!breakdown) throw new Error('拆解解析失败');
  const now = Date.now();
  project = await patchDuanjuProject(workId, {
    revision: project.revision,
    reviewCards: {
      summary: breakdown.summary,
      eventChain: breakdown.eventChain,
      conflict: breakdown.conflict,
      characterRelations: breakdown.characterRelations,
      emotionPoints: breakdown.emotionPoints,
      visualActions: breakdown.visualActions,
      riskReplacements: breakdown.riskReplacements.map((r, i) => ({
        id: `risk-${now}-${i}`,
        original: r.original,
        replacement: r.replacement,
      })),
      confirmed: {},
      updatedAt: now,
    },
    episodes: mergeEpisodes([], breakdown.episodes),
  });
  console.log('[3] 拆解 ok，集数:', project.episodes.length);

  // ④ LLM 提角色（自动带 lockPhrase）
  const charRaw = await llmText(
    buildCharacterExtractMessages(SCRIPT, breakdown.characterRelations, '宁采臣：正直清贫书生；聂小倩：被妖物胁迫的温柔女鬼；燕赤霞：沉默寡言的秦地剑客'),
  );
  const chars = parseCharacterExtract(charRaw);
  if (!chars || chars.length === 0) throw new Error('角色提取失败');
  project = await patchDuanjuProject(workId, {
    revision: project.revision,
    characters: chars.map((c, i) => ({
      id: `char-${now}-${i}`,
      name: c.name,
      profile: c.profile,
      lockPhrase: c.lockPhrase,
      sheetImages: [],
      refImageId: null,
      updatedAt: now,
    })),
  });
  console.log('[4] 角色 ok:', project.characters.map((c) => c.name).join('、'));

  // ⑤ LLM 提场景
  const sceneRaw = await llmText(buildSceneExtractMessages(SCRIPT));
  const scenes = parseSceneExtract(sceneRaw);
  if (scenes && scenes.length > 0) {
    project = await patchDuanjuProject(workId, {
      revision: project.revision,
      scenes: scenes.map((s, i) => ({
        id: `scene-${now}-${i}`,
        name: s.name,
        spec: s.spec,
        images: [],
        updatedAt: now,
      })),
    });
    console.log('[5] 场景 ok:', project.scenes.map((s) => s.name).join('、'));
  }

  console.log('[done]', '兰若寺·聂小倩', '| characters:', project.characters.length, '| scenes:', project.scenes.length, '| episodes:', project.episodes.length);
  writeFileSync('scripts-e2e/nie-state.json', JSON.stringify({ workId }, null, 1), 'utf-8');
}

main().catch((e) => {
  console.error('[FATAL]', e);
  process.exit(1);
});
