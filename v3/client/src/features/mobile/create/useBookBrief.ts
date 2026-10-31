/**
 * 预读取书籍资料 hook（反馈②）：绑定角色卡人设 + 世界书要点 + 作品设定 → 对话提示词简介。
 *
 * - 复用 loadAssembleAssets（与正文生成同源：按章绑定生效、并行拉取、单卡失败跳过）——review #3
 * - 全部绑定资产拉取失败时明确报「读取失败」（review #7），不再误报「未绑定」
 * - 供大纲迭代聊天注入提示词；数据来自全局 hooks 层，本文件只做展示整形
 */
import { useEffect, useState } from 'react';

import type { Work } from '@shared/work';

import { loadAssembleAssets } from '../../../hooks/generation-pipeline';

export interface BookBriefResult {
  /** 组装好的资料文本（注入提示词用；不可用时为空串） */
  brief: string;
  /** 顶部摘要行（已读取 N / 读取失败 / 未绑定） */
  stat: string;
  /** 资料是否可用（false 时重写提示词不含本书资料段） */
  ok: boolean;
}

const clip = (v: unknown, n: number): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');

export function useBookBrief(work: Work): BookBriefResult {
  const [result, setResult] = useState<BookBriefResult>({ brief: '', stat: '读取书籍资料中…', ok: false });

  useEffect(() => {
    let alive = true;
    setResult({ brief: '', stat: '读取书籍资料中…', ok: false });
    loadAssembleAssets(work)
      .then((assets) => {
        if (!alive) return;
        const parts: string[] = [];
        const s = work.settings;
        const settingBits = [
          s.subGenre || s.genre,
          s.coreConflict ? `核心矛盾：${clip(s.coreConflict, 80)}` : '',
          s.powerSystem ? `力量体系：${clip(s.powerSystem, 60)}` : '',
        ].filter(Boolean);
        if (settingBits.length > 0) parts.push(`设定：${settingBits.join('；')}`);
        let charN = 0;
        let wbN = 0;
        for (const card of assets.cards) {
          const d = card.data ?? {};
          const bits = [clip(d.description, 150), clip(d.personality, 80)].filter(Boolean);
          if (bits.length === 0) continue;
          charN += 1;
          parts.push(`角色「${clip(d.name, 24) || '未命名'}」：${bits.join('；')}`);
        }
        for (const wb of assets.worldbooks) {
          const entries = Object.values(wb.raw?.entries ?? {});
          const head = entries
            .map((e) => clip(e.comment, 40) || clip(e.content, 40))
            .filter(Boolean)
            .slice(0, 6)
            .join('；');
          if (!head) continue;
          wbN += 1;
          parts.push(`世界书《${clip(wb.name, 24)}》：${head}`);
        }
        const bound = work.characterIds.length + work.worldbookIds.length;
        const loaded = assets.cards.length + assets.worldbooks.length;
        // 绑定了资产却一个都没读到 = 网络故障（review #7），与「未绑定」区分
        if (loaded === 0 && bound > 0) {
          setResult({ brief: '', stat: '⚠️ 书籍资料读取失败（网络问题），本轮对话未注入设定', ok: false });
          return;
        }
        const ok = charN + wbN > 0;
        setResult({
          brief: parts.join('\n'),
          stat: ok
            ? `已读取资料：角色 ${charN} · 世界书 ${wbN}`
            : '未绑定角色卡/世界书（可先在「资料」分区选用）',
          ok,
        });
      })
      .catch(() => {
        if (alive) setResult({ brief: '', stat: '⚠️ 书籍资料读取失败（网络问题），本轮对话未注入设定', ok: false });
      });
    return () => {
      alive = false;
    };
    // 绑定清单变化才重读；work 其余字段（标题/设定）同会话内视为稳定
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [work.id, work.characterIds.join(','), work.worldbookIds.join(',')]);

  return result;
}
