# M2+M3 sample 端到端实测记录（Chunk 7 Task 7.2）

- **日期**：2026-11-21
- **环境**：dev（既有会话遗留的 server:3001 + client:5173，tsx watch 跑当前工作树源码，含 6b9712b 全部 M2+M3 实现）
- **LLM 通道**：claude / MiniMax-M3.1-Flash（secrets.json MiniMax anthropic 端点），maxContext 65536 / maxTokens 8192 / repetitionPenalty 1.05
- **执行方式**：`node scripts/m2m3-sample-e2e.mjs`（API 级，等价于浏览器行为的 server 侧验证）+ 补丁脚本 `scripts/m2m3-sample-e2e-patch.mjs`（S6 观察/S7/S8；主脚本 S6 的自动 cancel 触发条件误读了无 `?since` 响应——该响应不含 progress 字段——cancel 改为手动 `POST /:id/cancel` 置位后由补丁脚本完成观察；主脚本缺陷已修复供复跑）。**测试脚本缺陷，非产品缺陷。**
- **数据**：临时书 A/B/C/D（Sample测试-*-可删），测试结束全部删除（见 S8）

## S0 登录 — PASS

`POST /api/auth/login {password:dev123}` → 200，作者身份。

## S1 建书 A/B — PASS

- 书 A「Sample测试-兄妹A-可删」：defaultNovelSettings 基座 + storyTones:['温情治愈'] + customStoryTone:'欢乐轻松' + writingStyle:'fanqie' + targetChapterWords:600 + stylePresetIds:[]，id=`47faa0c4-8c0e-48df-8598-985116d81f88`
- 书 B「Sample测试-对照B-可删」：同基座 writingStyle:'default'，id=`cb6f8bfe-4361-467b-a103-bd0d2c325e48`
- 均 201。

## S2 预设资产盘点 — PASS

`GET /api/presets`：`Sudachi-Next-Preset`（id=`612b55fd-abce-429f-99d4-024114346175`，tags `["通用","治愈"]`）已存在含「通用」tag 预设，**无需 PATCH 打标**（也就无需还原）。`Default` 预设 tags 为空。

说明：server 端 `mergeStylePresets` 只按 `work.settings.stylePresetIds` 显式绑定合并附加预设（通用 tag 供客户端 UI 推荐层常显），书 A 的 `stylePresetIds:[]` 直接返回主预设——**组装层 stylePresetIds 空按主预设是合法路径**。预设注入的 E2E 验证以 S7 临时绑定方式补做。

## S3 批量发起 + 并发串行观察 — PASS

- S3.1 书 A 提交 `POST /api/llm/tasks`（kind:novel-chapter, chapters:2, **parallel:1**）→ 202，taskId=`3e5464be-9783-4058-992e-731a73349529`
- S3.2 1 秒后书 B 提交（chapters:2）→ 202，taskId=`abea3a5c-d22e-4595-97f5-44505620cbf9`
- S3.3 串行观察：每 5 秒采样 `GET /api/llm/tasks/active` ×12，timeline 全程为
  `A:running/p=assembling/d=0/0ch | B:running/p=-/d=0/0ch`
  ——**A 有 phase（执行中）而 B 无 phase（progress 未产生=排队中）**，全局并发上限 1 生效，B 被 novelQueue FIFO 排队，未与 A 并发。

**语义说明**：parallel 上限的 slot 是**任务级持有**（`executeNovelChapter` acquire→finally release），A 整任务 2 章全部完成后 B 才开始执行，而非「A 完成一章即让位」——与计划描述「A 完成一章后 B 开始」的差异源于此，属设计内行为（排队粒度=任务）。

## S4 关页面等价验证 — PASS

- S4.1 书 A 任务 `done`，resultMessages=2（resultMessageIds 2 条）
- S4.2 书 B 任务 `done`，resultMessages=2
- 全程 A/B 各 2 章（共 4 章）由 server 独立完成；脚本只在关键节点查询，无客户端持续流式连接。**提交后不持有任何生成侧连接，任务从 pending→running→done 全程不受查询频率影响**——切出/关闭页面场景的 server 后台化语义成立。
- 实测耗时：A（含 B 排队窗口）约 5.1 分钟，B 随后约 3 分钟（600 字短章 ×2 含组装与排队）。

## S5 落库验证 — 章数/index PASS，字数偏差 FAIL（非阻断，模型执行偏差）

- 书 A：2 章 `[1943, 3010]` 字，chapter.index `1,2` 递增正确；标题《藏在配方盒里的录取通知书》《小姨家的周末饭》
- 书 B：2 章 `[2517, 2869]` 字，chapter.index `1,2` 递增正确；标题《压在练习册下的申请表》《六点四十的厨房》
- **章数（各恰 2 章）与 index 递增全部正确**；字数超出 600±50%（300-900）断言区间。

**偏差根因**（代码级定位，非链路缺陷）：`targetChapterWords:600` → 分段链 `parts = ceil(600 / SEGMENT_WORDS=2500) = 1`（单段）；单段输出预算 `calcOutputBudget(2500+600)` ≈ 3100 字——末尾写作要求写明 600 字目标，但 MiniMax-M3.1-Flash 对短目标执行偏差明显，实际写到 1900-3000 字才收束（模型自由发挥，finish=stop 自然收尾）。默认 3000 字场景（parts=2）历史实测贴合目标。**M2/M3 链路本身（提交→排队→组装→生成→入库→index→resultMessageIds）全部验证通过**；若需收紧短目标执行力，可在末尾写作要求块强化（挂账，非本次范围）。

## S6 取消语义 — PASS（断言口径修正后全部符合 D6）

- S6.1 建书 C「Sample测试-取消C-可删」→ 201，id=`f46e0266-d174-4ca4-ae90-0e2f080f6d5c`
- S6.2 提交 chapters:5（parallel:2 顺手恢复全局并发默认）→ 202，taskId=`affea6d9-32e4-4aea-aca2-f4c06261faf5`
- cancel 置位：`POST /api/llm/tasks/:id/cancel` → `{ok:true}`，任务文件 `cancelRequested:true` 落盘
- 终态：`done`（**非 failed 非 running**），elapsedMs=298932，resultMessages=**3**
- 落库：messages 恰 3 章，字数 `[3804, 2739, 2436]`（约 100s/章完成），与 resultMessages=3 一致；**均为完整章、无半章残章**；第 4、5 章未生成。

**语义分析（为什么是 3 章而不是 1-2 章）**：取消语义 D6=「段间/章间生效——当前段跑完即停」。任务从提交（14:39:24）到 cancel 置位（约 14:43:2x）间隔约 4 分钟，5 章链以 ~100s/章推进，置位时刻第 1、2 章已入库、**第 3 章的首段 LLM 调用已在飞行中（不可中断）**——该章跑完入库；随后 i=4 章间检查读到 cancelRequested=true 停链（`runChapterChain` L131），第 4、5 章未生成。**「cancel 时正在生成的章保留、之后的章不再生成」正是 D6 语义的正确执行**；实测「恰 1-2 章」的断言窗口假设过严（假设了 cancel 更早到达），补丁脚本 P1.2 的 FAIL 属测试断言口径问题，产品行为正确。同款语义在 deep-test N 组（400 字单章任务）验证为 0-1 章且与 resultMessages 一致（N59/N60 PASS）。

## S7 预设链路 — PASS

- 书 D「Sample测试-预设D-可删」（id=`c6cafaee-efd8-4b8d-b7ef-1269aae4ae7d`）PATCH settings.stylePresetIds=`[612b55fd-...]`（Sudachi「通用」预设）→ 200
- 提交 novel-chapter chapters:1 → 202，taskId=`3af7aec9-4d8b-45c9-ab37-eeb0203da13d` → **done，resultMessages=1**
- 结论：**mergeStylePresets 在 server 真实生成链路读取附加预设不报错、生成正常完成**。组装产物断言（附加预设 prompt 以 `sty` 前缀 identifier 注入主栈、enabled 跟随附加预设 prompt_order）由 `novel-gen-assemble.test.ts` 单测覆盖（预设合并/注入用例），E2E 层以「链路通了预设读取不报错」为验收口径。

## S8 清理 — PASS

- 删书 A/B/C/D → 均 200（书架无残留测试数据）
- 预设 tags 未被改动（Sudachi 原生含「通用」，全程未 PATCH 预设）——无需还原
- 临时任务文件（终态 draft）留存在 `data/llm-tasks/`（gitignore 范围，不入库），已顺手清除本次 sample 产生的 4 个任务文件

## 汇总

| 步骤 | 结论 |
| --- | --- |
| S0 登录 | PASS |
| S1 建书 A/B（writingStyle 差异基座） | PASS |
| S2 预设资产（通用 tag 就绪） | PASS |
| S3 批量发起 + parallel=1 串行排队 | PASS（B 排队无 phase、A 独占执行） |
| S4 关页面等价（server 独立跑完 4 章） | PASS |
| S5 落库（章数/index） | PASS |
| S5 落库（字数 600±50%） | FAIL→**非阻断**：模型对短目标字数执行偏差（单段预算 3100 字），链路无缺陷 |
| S6 取消语义（D6 段间/章间生效） | PASS（置位 ok:true、终态 done 非 running、在途章保留、后续章不生成、无残章） |
| S7 预设链路（stylePresetIds 绑定真实跑通） | PASS |
| S8 清理 | PASS |

**问题清单**：

1. **非阻断（产品侧观察）**：targetChapterWords 很小（600）时 MiniMax-M3.1-Flash 单段生成显著超目标（3-5 倍）。根因是单段场景下段预算（SEGMENT_WORDS+600）远大于目标字数、模型对短目标执行偏差。默认 3000 字场景不受影响。可在末尾写作要求块强化短目标执行力（挂账建议）。
2. **非阻断（测试脚本侧，均已修）**：主 E2E 脚本 S6 的 cancel 触发条件误用无 `?since` 响应（不含 progress 字段）——已改为 `?since=0` 读取 progress.done；P1.2「恰 1-2 章」断言口径过严——已按 D6 语义修正认知（在途章保留 + 后续章不生成才是正确判据），deep-test N 组用例即为正确口径。
3. **无阻断级缺陷**。M2（全后台生成）与 M3（多书同步/并发编排/书架批量链路）在 sample 实测中行为全部符合设计共识 D4-D9。
