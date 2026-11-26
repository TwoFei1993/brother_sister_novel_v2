/**
 * 试验台出图分流与归档（设计共识 2026-11-26 第 2.2 / 2.5 / 2.6 节；M2：参考图、切出后恢复）
 *
 * - 本地通道（comfy）：浏览器直连引擎生成 → 产物经回流端点归档。提交成功即回调 onSubmitted 交出任务检查点，
 *   页面重载后凭它 resumeLabImage 续接（执行在引擎侧，不受页面生命周期影响）。
 * - 云端通道（seedream / zhipu）：服务端生成并转存（Seedream 可带 1 张参考图）。
 * 归档成功返回记录；失败抛人话错误（不落记录）。
 */
import { LAB_PROMPT_LIMITS, type LabAspect, type LabKind, type LabProvider, type LabRecord, type LabRef, type LabUploadMeta } from '@shared/duanju/lab';
import { generateLabCloud, uploadLabComfy } from '../../../../api/duanjuLab';
import { loadComfyConfig } from '../comfy';
import { cloudSizeFor, labSizeFor, type ImageSize } from './aspects';
import { pollLabComfy, submitLabComfy } from './comfyRefs';
import { effectiveRefs, fetchWorkImage } from './refs';
import type { LabTaskCheckpoint } from './taskState';

export interface LabGenerateInput {
  workId: string;
  brief: string;
  /** 审批后的完整提示词（实际送生成的那一版） */
  prompt: string;
  kind: LabKind;
  provider: LabProvider;
  aspect: LabAspect;
  /** 本地通道的随机种子（同种子同提示词可复现；云端通道不可指定） */
  seed: number;
  characterIds: string[];
  sceneIds: string[];
  /** 界面上的参考图（按通道上限截取后才是实际送生成的） */
  refs: LabRef[];
}

/** 画幅在该通道下的尺寸（本地与云端各按自己的尺寸表） */
export function labSizeForProvider(provider: LabProvider, aspect: LabAspect): ImageSize {
  return provider === 'comfy' ? labSizeFor(aspect) : cloudSizeFor(provider, aspect);
}

/** 归档用的公共字段。通道相关的 provider / seed 由各分支自己加——云端请求体是严格校验的，多一个字段就会被拒 */
type ArchiveMeta = Omit<LabUploadMeta, 'elapsedSec' | 'provider' | 'seed'>;

function archiveMeta(input: LabGenerateInput): ArchiveMeta {
  const { width, height } = labSizeForProvider(input.provider, input.aspect);
  return {
    brief: input.brief,
    prompt: input.prompt,
    kind: input.kind,
    aspect: input.aspect,
    width,
    height,
    characterIds: input.characterIds,
    sceneIds: input.sceneIds,
    refs: effectiveRefs(input.provider, input.refs),
  };
}

/** 出图前的拦截理由（通过则 null）：空提示词 / 超过通道上限（拒绝而不是截断——审批的就是送去生成的） */
export function produceProblem(params: Pick<LabGenerateInput, 'prompt' | 'provider'>): string | null {
  if (!params.prompt.trim()) return '提示词是空的——先扩写或自己写一段';
  const limit = LAB_PROMPT_LIMITS[params.provider];
  if (params.prompt.length > limit) {
    return `提示词 ${params.prompt.length} 字，超过该通道上限 ${limit} 字——请删减后再出图（不会自动截断）`;
  }
  return null;
}

/** 出图并归档。onSubmitted：本地通道提交成功后立即回调（调用方据此落任务检查点） */
export async function generateLabImage(
  input: LabGenerateInput,
  onSubmitted?: (task: LabTaskCheckpoint) => void,
): Promise<LabRecord> {
  const meta = archiveMeta(input);
  if (input.provider !== 'comfy') {
    return generateLabCloud(input.workId, { ...meta, provider: input.provider });
  }
  const cfg = loadComfyConfig();
  if (!cfg.url.trim()) throw new Error('本地 ComfyUI 未配置地址——请到设置页「本地引擎」填写并保存');
  const startedAt = Date.now();
  const refBlobs = await Promise.all(
    meta.refs.map(async (ref) => ({
      blob: await fetchWorkImage(input.workId, ref.path),
      ext: ref.path.endsWith('.jpg') ? ('jpg' as const) : ('png' as const),
    })),
  );
  const task = await submitLabComfy(cfg, { prompt: input.prompt, width: meta.width, height: meta.height, seed: input.seed, refBlobs });
  const comfyMeta = { ...meta, provider: 'comfy' as const, seed: input.seed };
  onSubmitted?.({ ...comfyMeta, base: task.base, promptId: task.promptId, startedAt });
  return archiveComfy(input.workId, await pollLabComfy(task), comfyMeta, startedAt);
}

/** 续接：页面回来后凭检查点接着等引擎的结果并归档 */
export async function resumeLabImage(workId: string, task: LabTaskCheckpoint): Promise<LabRecord> {
  const blob = await pollLabComfy({ base: task.base, promptId: task.promptId });
  return archiveComfy(workId, blob, archiveMetaOf(task), task.startedAt);
}

/** 检查点 → 归档用的字段。检查点里还有引擎任务号等续接专用字段，归档接口是严格校验的，不能整份传 */
function archiveMetaOf(task: LabTaskCheckpoint): Omit<LabUploadMeta, 'elapsedSec'> {
  const { brief, prompt, kind, provider, aspect, width, height, seed, refs, characterIds, sceneIds } = task;
  return { brief, prompt, kind, provider, aspect, width, height, seed, refs, characterIds, sceneIds };
}

async function archiveComfy(
  workId: string,
  blob: Blob,
  meta: Omit<LabUploadMeta, 'elapsedSec'>,
  startedAt: number,
): Promise<LabRecord> {
  const file = new File([blob], 'lab.png', { type: blob.type || 'image/png' });
  const records = await uploadLabComfy(workId, file, { ...meta, elapsedSec: Math.round((Date.now() - startedAt) / 1000) });
  return records.at(-1)!; // 归档即最新一条
}
