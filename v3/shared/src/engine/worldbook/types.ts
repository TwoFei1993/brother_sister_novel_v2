/**
 * 世界书扫描引擎类型（设计 §5.1② / §5.2 一期行为全集）
 *
 * 语义锚点：酒馆 world-info.js checkWorldInfo(:4709)。
 * 引擎为纯函数：随机源经 ScanInput.rng 注入，宏替换经 MacroEnv 回调。
 */
import type { MacroEnv } from '../types';

/** 扫描全局设置（酒馆 world_info_depth/case_sensitive/match_whole_words/recursive/max_recursion_steps） */
export interface ScanSettings {
  /** 扫描深度：取聊天文本前 N 条（新→旧）参与匹配 */
  scanDepth: number;
  /** 大小写敏感（默认 false，条目级可覆盖） */
  caseSensitive: boolean;
  /** 全词匹配（默认 false，条目级可覆盖；仅纯拉丁词启用边界正则） */
  matchWholeWords: boolean;
  /** 递归扫描开关 */
  recursive: boolean;
  /** 递归最大轮数 */
  maxRecursionSteps: number;
}

/** 扫描输入 */
export interface ScanInput {
  /** 参与扫描的世界书（多本合并） */
  books: import('@shared/worldbook').WorldbookAsset[];
  /** 聊天文本，新→旧排序（chatTexts[0] 为最新消息） */
  chatTexts: string[];
  settings: ScanSettings;
  /** 宏替换环境；缺省时不做宏替换 */
  macroEnv?: MacroEnv;
  /** 随机源（probability roll）；缺省 Math.random，测试注入固定值锁定行为 */
  rng?: () => number;
}

/** 深度注入条目（position=4 atDepth 归一化结果） */
export interface DepthEntry {
  content: string;
  /** 注入深度：倒数第 depth 条消息位置（缺省 4，酒馆 DEFAULT_DEPTH） */
  depth: number;
  role: 'system' | 'user' | 'assistant';
  /** 同 depth 内排序键：降序（高优先在前），缺省 100 */
  order: number;
}

/** 扫描结果：装配层（assemble.ts）按位置消费 */
export interface ScanResult {
  /** 插入聊天历史之前的条目内容（position 0/2/5），order 降序 */
  before: string[];
  /** 插入聊天历史之后的条目内容（position 1/3/6），order 降序 */
  after: string[];
  /** 深度注入条目（position 4），depth 降序、同 depth 按 order 降序 */
  depthEntries: DepthEntry[];
  /** 激活条目审计 ID，格式 "bookId:uid"（写入 extra.activatedEntries） */
  activatedIds: string[];
}
