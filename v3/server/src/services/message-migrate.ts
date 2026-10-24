/**
 * 存量消息版本迁移（安卓 app Phase1）：swipes string[] → 结构化 MessageVersion[]
 *
 * 启动时跑一次（main.ts listen 前）：扫 data/works/<id>/messages.jsonl，逐条归一化
 * （shared normalizeSwipes：旧候选自动命名 v1…，origin='ai'），有变化才整文件原子重写。
 * 幂等：已结构化的消息 normalizeSwipes 返回原引用，无变化不写回，重跑零副作用。
 * publishedVersionId 不在此设值（缺省=未上架），上架一律走显式开关。
 */
import { join } from 'node:path';

import { normalizeSwipes, type Message } from '@shared/message';

import { logger } from '../middleware/logger';
import { listDir } from '../storage/store';
import { readAll, rewriteAll } from '../storage/jsonl';

export interface MessageMigrateResult {
  /** 扫描的消息文件数 */
  files: number;
  /** 实际重写（发生迁移）的文件数 */
  rewritten: number;
}

/** 单文件归一化：返回是否发生变化（任一消息的 swipes 被升级） */
function normalizeFileMessages(messages: Message[]): boolean {
  let changed = false;
  for (let i = 0; i < messages.length; i += 1) {
    const msg = messages[i]!;
    const next = normalizeSwipes(msg.swipes, msg.createdAt);
    if (next !== msg.swipes) {
      messages[i] = { ...msg, swipes: next };
      changed = true;
    }
  }
  return changed;
}

/** 扫描全部作品消息文件并迁移；目录不存在（全新部署）返回零值 */
export async function migrateMessageVersions(dataDir: string): Promise<MessageMigrateResult> {
  const worksDir = join(dataDir, 'works');
  const workIds = await listDir(worksDir);
  let files = 0;
  let rewritten = 0;
  for (const id of workIds) {
    const file = join(worksDir, id, 'messages.jsonl');
    const messages = await readAll<Message>(file);
    if (messages.length === 0) continue; // 无消息或文件不存在：跳过
    files += 1;
    if (normalizeFileMessages(messages)) {
      await rewriteAll(file, messages);
      rewritten += 1;
    }
  }
  if (rewritten > 0) {
    logger.info(`消息版本迁移完成：扫描 ${files} 个文件，重写 ${rewritten} 个（swipes → 结构化版本）`);
  }
  return { files, rewritten };
}
