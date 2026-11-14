/**
 * 分镜帧 VLM 质检（P3，glm-4v 免费档）：POST /works/:id/duanju/qc-frame
 *
 * 双图对比（图1=角色定妆照特写 / 图2=分镜帧）→ 身份相似度 0-100 + 问题清单。
 * 低分建议重roll（跨帧角色漂移的自动哨兵）。智谱 OpenAI 兼容协议，key 读 secrets.zhipu。
 */
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';

import type { RequestHandler } from 'express';
import { z } from 'zod';

import { HttpError, zodBody } from '../../middleware/validate';
import { readJson } from '../../storage/store';
import { dataDir } from '../core/paths';
import { assertSafeId, worksDir, wrap } from '../works/works';

const ZHIPU_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
const QC_MODEL = 'glm-4v-flash';
const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

const qcSchema = z.strictObject({
  refPath: z.string().min(1), // 定妆照（duanju/images/xx.png 相对 work）
  framePath: z.string().min(1), // 分镜帧
});

interface SecretsZ {
  zhipu?: { apiKey?: string };
}

async function zhipuKey(): Promise<string> {
  const s = await readJson<SecretsZ>(join(dataDir(), 'secrets.json'));
  return s?.zhipu?.apiKey ?? '';
}

async function toDataUrl(workId: string, relPath: string): Promise<string> {
  const name = relPath.split('/').pop() ?? '';
  const sub = relPath.includes('/videos/') ? 'videos' : 'images';
  const file = join(worksDir(), workId, 'duanju', sub, name);
  const buf = await readFile(file);
  const mime = MIME[extname(file).toLowerCase()] ?? 'image/png';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

const QC_PROMPT = `图1 是某角色的定妆照（标准像），图2 是同一作品的分镜帧。
判断图2 中的该角色与图1 的身份一致性，输出一个 JSON 对象（不要 markdown 代码块）：
{"score": 0-100 的整数, "verdict": "通过/边缘/漂移", "issues": ["具体问题一句话，无则空数组"]}
评分标准：五官脸型发型毛色（或发色瞳色肤色）一致 85+；小偏差（毛色深浅/发型细节）70-84；
明显不一致（换了张脸/关键特征丢失）<70。图2 中没有该角色时 score=0 且 issues 写明。
只输出 JSON。`;

export const qcDuanjuFrame: RequestHandler = async (req, res, next) => {
  try {
    const id = req.params.id;
    assertSafeId(id);
    const { refPath, framePath } = req.body as z.infer<typeof qcSchema>;
    const key = await zhipuKey();
    if (!key) throw new HttpError(503, '服务端未配置智谱密钥（secrets.zhipu.apiKey）');

    const [refUrl, frameUrl] = await Promise.all([toDataUrl(id, refPath), toDataUrl(id, framePath)]);
    const upstream = await fetch(ZHIPU_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: QC_MODEL,
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: refUrl } },
            { type: 'image_url', image_url: { url: frameUrl } },
            { type: 'text', text: QC_PROMPT },
          ],
        }],
        max_tokens: 300,
        temperature: 0.1,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!upstream.ok) {
      const t = await upstream.text().catch(() => '');
      throw new HttpError(502, `智谱质检上游错误（HTTP ${upstream.status}）：${t.slice(0, 120)}`);
    }
    const j = (await upstream.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = j.choices?.[0]?.message?.content ?? '';
    // 容错提取 JSON（模型偶发围栏）
    const m = raw.match(/\{[\s\S]*\}/);
    let parsed: { score?: unknown; verdict?: unknown; issues?: unknown } = {};
    try {
      parsed = m ? (JSON.parse(m[0]) as typeof parsed) : {};
    } catch {
      parsed = {};
    }
    const score = typeof parsed.score === 'number' ? Math.max(0, Math.min(100, Math.round(parsed.score))) : -1;
    res.json({
      ok: true,
      score,
      verdict: typeof parsed.verdict === 'string' ? parsed.verdict : '未解析',
      issues: Array.isArray(parsed.issues) ? parsed.issues.filter((x): x is string => typeof x === 'string') : [],
      raw: score < 0 ? raw.slice(0, 200) : undefined,
    });
  } catch (err) {
    next(err);
  }
};

export function mountDuanjuQc(router: import('express').Router): void {
  router.post('/works/:id/duanju/qc-frame', zodBody(qcSchema), wrap(qcDuanjuFrame));
}
