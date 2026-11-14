/**
 * 挑帧路径解析。
 *
 * UI（FramesGrid）传「帧号-1」（0-3）；帧数组按 index 升序但**不保证连续**
 * （帧不全时下标≠帧号-1）。必须按 index 查找，不可按下标取——
 * 旧实现 frames[pickIdx] 在 F1/F3/F4 有图时点 F3 会取到 F4。
 */
import type { DuanjuShot } from '@shared/duanju';

/** pickIdx=帧号-1（0-3）。返回该帧图片路径；帧无图时 undefined（调用方兜底最早帧）。 */
export function pickFramePath(shot: Pick<DuanjuShot, 'frames'>, pickIdx: number): string | undefined {
  return (shot.frames ?? []).find((f) => f.index === pickIdx + 1)?.image?.path;
}
