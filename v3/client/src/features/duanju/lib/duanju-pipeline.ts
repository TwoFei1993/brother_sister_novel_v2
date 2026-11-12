/**
 * 剧本拆解完成后的自动流水线（用户需求 2026-11-12：拆完剧本自动接着拆角色/场景/分镜）：
 *
 * 提取角色 → 提取场景 → 逐集拆镜头，每步一个后台 LLM 任务（提交 + 轮询 + 容错），
 * 全程可切出 App（server 端执行不中断）；onStep 实时回报当前步骤供 UI 展示。
 *
 * 写入走 duanju project PATCH（乐观锁）：角色/场景合并（同名更新、新名追加），镜头按集替换。
 */
import { apiFetch } from '../../../api/client';
import { buildCharacterExtractMessages, parseCharacterExtract } from './characterExtract';
import { buildSceneExtractMessages, parseSceneExtract } from './sceneExtract';
import { buildStoryboardMessages, parseStoryboard } from './prompts/prompts-storyboard';
import type { DuanjuCharacter, DuanjuProject, DuanjuScene, DuanjuShot } from '@shared/duanju';

export interface PipelinePrefs {
  source: string;
  model: string;
  thinking?: boolean;
}

export interface PipelineOpts {
  workId: string;
  /** 拆解完成后的项目快照（完整 project——拆镜头解析需全量角色/场景做 id 映射） */
  project: DuanjuProject;
  /** 实时步骤回调（UI 展示「流水线：xxx 中…」） */
  onStep: (label: string) => void;
}

const POLL_MS = 4000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000;

/** 提交后台 LLM 任务并轮询至终态，返回结果文本（failed/lost/超时抛人话错误） */
async function runTask(body: Record<string, unknown>, label: string): Promise<string> {
  const sub = await apiFetch<{ taskId: string }>(`/api/llm/tasks`, {
    method: 'POST',
    body: JSON.stringify({ ...body, label }),
  });
  const { taskId } = sub;
  const t0 = Date.now();
  for (;;) {
    if (Date.now() - t0 > POLL_TIMEOUT_MS) throw new Error(`${label} 超时（10 分钟未完成），可稍后手动补跑`);
    await new Promise((r) => setTimeout(r, POLL_MS));
    try {
      const j = await apiFetch<{ status: string; text?: string; error?: string }>(
        `/api/llm/tasks/${taskId}`,
      );
      if (j.status === 'done') return j.text ?? '';
      if (j.status === 'failed' || j.status === 'lost') throw new Error(j.error ?? `${label} 失败`);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') throw err;
      // 单次轮询抖动静默重试（继续循环，总时长仍受 10 分钟上限约束）
    }
  }
}

/** 读当前 project + 乐观锁 PATCH 字段（角色/场景/镜头合并写入的统一通道） */
async function patchProjectFields(
  workId: string,
  mutate: (p: DuanjuProject) => Partial<DuanjuProject>,
): Promise<void> {
  const cur = await apiFetch<DuanjuProject>(`/api/works/${workId}/duanju`);
  const fields = mutate(cur);
  await apiFetch(`/api/works/${workId}/duanju`, {
    method: 'PATCH',
    body: JSON.stringify({ revision: cur.revision, ...fields }),
  });
}

/**
 * 拆解完成后的自动流水线。抛错=某步失败（错误消息人话；已完成的步骤不回滚——
 * 用户可手动补跑失败的那一步，其余步骤成果保留）。
 */
export async function runBreakdownPipeline(
  opts: PipelineOpts,
  prefs: PipelinePrefs,
): Promise<void> {
  const { workId, project, onStep } = opts;
  const scriptText = project.script.text;
  if (!scriptText.trim()) throw new Error('剧本为空，流水线跳过');
  const llmBase = { source: prefs.source, model: prefs.model, thinking: prefs.thinking !== false };

  // —— 步骤 1：提取角色（同名更新 profile，新名追加）——
  onStep('提取角色档案');
  const charRaw = await runTask(
    {
      ...llmBase,
      messages: buildCharacterExtractMessages(scriptText, project.reviewCards.characterRelations, project.protagonists),
      params: { max_tokens: 16000 },
    },
    '流水线·角色提取',
  );
  const charList = parseCharacterExtract(charRaw);
  if (charList && charList.length > 0) {
    await patchProjectFields(workId, (cur) => {
      const now = Date.now();
      const merged = [...cur.characters];
      for (const c of charList) {
        const idx = merged.findIndex((x) => x.name === c.name);
        if (idx >= 0) merged[idx] = { ...merged[idx], profile: c.profile, updatedAt: now };
        else
          merged.push({
            id: `char-${now}-${Math.random().toString(36).slice(2, 6)}`,
            name: c.name,
            profile: c.profile,
            sheetImages: [],
            createdAt: now,
            updatedAt: now,
          } as DuanjuCharacter);
      }
      return { characters: merged };
    });
  }

  // —— 步骤 2：提取场景（同名更新 spec，新名追加）——
  onStep('提取场景档案');
  const sceneRaw = await runTask(
    {
      ...llmBase,
      messages: buildSceneExtractMessages(scriptText),
      params: { max_tokens: 16000 },
    },
    '流水线·场景提取',
  );
  const sceneList = parseSceneExtract(sceneRaw);
  if (sceneList && sceneList.length > 0) {
    await patchProjectFields(workId, (cur) => {
      const now = Date.now();
      const merged = [...cur.scenes];
      for (const s of sceneList) {
        const idx = merged.findIndex((x) => x.name === s.name);
        if (idx >= 0) merged[idx] = { ...merged[idx], spec: s.spec, updatedAt: now };
        else
          merged.push({
            id: `scene-${now}-${Math.random().toString(36).slice(2, 6)}`,
            name: s.name,
            spec: s.spec,
            images: [],
            createdAt: now,
            updatedAt: now,
          } as DuanjuScene);
      }
      return { scenes: merged };
    });
  }

  // —— 步骤 3：逐集拆镜头（每集一个后台任务串行；单集解析失败跳过不阻塞后续集）——
  for (const ep of project.episodes) {
    onStep(`拆镜头·第 ${ep.index} 集《${ep.title}》`);
    const raw = await runTask(
      {
        ...llmBase,
        messages: buildStoryboardMessages(`${ep.title}：${ep.synopsis}`, scriptText, project.characters, project.scenes),
        params: { max_tokens: 32000 },
      },
      `流水线·拆镜头第${ep.index}集`,
    );
    const list = parseStoryboard(raw, ep.id, project);
    if (list.length === 0) continue;
    await patchProjectFields(workId, (proj) => {
      const others = proj.shots.filter((s) => s.episodeId !== ep.id);
      return { shots: [...others, ...(list as DuanjuShot[])] };
    });
  }
}
