# 短剧链路对照 drama-skills 差距报告与修复计划

> 2026-11-14 / 对照对象：[zenstory-ai/drama-skills](https://github.com/zenstory-ai/drama-skills)（12 skill，已装 ~/.claude/skills/）
> 核对范围：剧本 → 视觉设定 → 分镜 → 帧生成 → H3 视频提示词 → 成片，逐环节。
> 结论：工程化（省钱/提速/手机/超分/抽卡）我们领先；创作纪律的机械化（字符串级防漂移）有 18 项差距。

## P0：H3 方言六项修复（全部 prompt 模板层，立即修）

| # | 差距 | drama-skills 依据 | 修复 |
| --- | --- | --- | --- |
| 1 | 缺 `non_diegetic_music: N/A` 字段——H3 省略会自己补配乐 | minimax-h3.md 三段结构 | prompt 末行加字段 |
| 2 | 无字幕/文字叠加禁令——H3 会乱加乱码字幕 | 提示词要求·文字边界 | 显式正向声明（有画内文字时逐字例外声明） |
| 3 | `<d>` 无说话人绑定——多角色镜 H3 猜谁开口 | H3 方言·说话人绑定 | shot.speaker 字段 + `(S1)` 绑定 |
| 4 | 同框不说话者无闭嘴声明——口型误落 | H3 方言·同框闭嘴 | 其他角色显式 lips closed |
| 5 | 开口延迟未计入（H3 首帧模式 1.3-2.4s 才出声） | H3 方言·对白预算 | prompt 加自然停顿 + 机检对白容量 |
| 6 | t2v 无画风守护——H3 文生偏真人实拍 | H3 方言·craft_default | textToVideo 时首句 not live-action + 每 Shot 重复 |

对白预算机检：中文 4.1 可发声字/秒，扣 1.8s 开口中值——validateStoryboardIssues 加算术检查。

## P1：四项小迭代

| # | 差距 | 修复 |
| --- | --- | --- |
| 7 | 场景站位/180°轴线缺失（跨镜越轴） | 拆镜头 prompt：同场多镜共享站位语境 + staging 写轴线参考与机位侧 |
| 8 | 连续性锁缺失（profile 每帧 LLM 自由转述 = 漂移机会） | character.lockPhrase（英文锁面短语）逐字注入帧/视频 prompt——字符串级一致 |
| 9 | 转身/出画镜的帧意识（H3 忽略提示词转身方向） | 帧 prompt：转身镜画「转身进行中一半」姿态 |
| 10 | 画内文字链路缺失（手机屏幕/招牌——霸总刚需） | 剧本 [画面文字] 标签 → shot.onScreenText → 帧 prompt 逐字渲染 + 视频 prompt 例外声明 |

## P2：架构级（不下载任何模型，纯代码）

| # | 差距 | 资源需求 |
| --- | --- | --- |
| 11 | 状态按场追踪（血迹/湿衣随场次演进） | 零（数据模型+UI） |
| 12 | 道具资产类别 | 零（数据模型+UI；道具图走现有 ComfyUI） |
| 13 | 成片剪辑（ffmpeg 拼接+字幕逐字+响度统一） | docker 镜像 +ffmpeg 层约 100MB，无模型下载 |

## 我方独有优势（drama-skills 没有，保留不动）

hookType 完播率钩子系统 / 成本仪表盘 spendLog / trial 抽卡 / SeedVR2 超分 / 分帧单帧重roll / 手机全链路+CF 隧道。
