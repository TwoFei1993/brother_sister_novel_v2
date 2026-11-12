/**
 * 设定图双段合成（版式硬规定·v2 零压缩）：左头像特写 448×768 + 右三视图 1344×768 → 1792×768。
 *
 * 两次生成各自是模型高遵循任务（纯头像 / 纯三视图），版式拼接由 canvas 保证——
 * 不依赖模型对复杂版式指令的运气。v1 曾把右区压到 896 宽（1344 画布）被否决；
 * v2 画布加宽到 1792，两段均按生成原尺寸落位、零缩放。背景浅灰遮拼缝。
 */
const CANVAS_W = 1792;
const CANVAS_H = 768;
const LEFT_W = 448; // 特写区宽 = B 段生成宽（原尺寸落位）
const RIGHT_W = 1344; // 三视图区宽 = A 段生成宽（原尺寸落位，零压缩）
const BG = '#dcdcdc'; // 浅灰背景（与设定图提示词「浅灰色干净背景」一致）

async function blobToBitmap(blob: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob);
  } catch {
    throw new Error('设定图合成失败：生成图片无法解码');
  }
}

export async function composeCharacterSheet(portrait: Blob, triView: Blob): Promise<Blob> {
  const [pImg, tImg] = await Promise.all([blobToBitmap(portrait), blobToBitmap(triView)]);
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('设定图合成失败：canvas 不可用');

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  // 左：头像特写原尺寸落位（生成即 448×768）
  ctx.drawImage(pImg, 0, 0, LEFT_W, CANVAS_H);
  // 右：三视图原尺寸落位（生成即 1344×768，零缩放不压缩）
  ctx.drawImage(tImg, LEFT_W, 0, RIGHT_W, CANVAS_H);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/png'),
  );
  if (!blob) throw new Error('设定图合成失败：canvas 导出异常');
  return blob;
}
