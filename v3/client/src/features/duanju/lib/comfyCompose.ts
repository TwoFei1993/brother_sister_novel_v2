/**
 * 设定图双段合成（v3·用户样图复刻）：左大特写 704×1024 + 右三视图 1344×1024 → 2048×1024（2:1 横版）。
 *
 * 样图规范：特写占宽 ~35% 垂直占满；右三张全身像横排脚底对齐；纯白背景无边框无文字。
 * 两段各自按生成原尺寸落位（零压缩）；canvas 仅做拼接与白底。
 */
const CANVAS_W = 2048;
const CANVAS_H = 1024;
const LEFT_W = 704; // 特写区宽 = B 段生成宽（占 34%，样图 ~35%）
const RIGHT_W = 1344; // 三视图区宽 = A 段生成宽（原尺寸落位）
const BG = '#ffffff'; // 纯白背景（样图规范）

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
  // 左：大特写原尺寸落位（生成即 704×1024，垂直占满）
  ctx.drawImage(pImg, 0, 0, LEFT_W, CANVAS_H);
  // 右：三视图原尺寸落位（生成即 1344×1024，零压缩）
  ctx.drawImage(tImg, LEFT_W, 0, RIGHT_W, CANVAS_H);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/png'),
  );
  if (!blob) throw new Error('设定图合成失败：canvas 导出异常');
  return blob;
}

/**
 * 从三视图原图（1344×1024，内含左中右三个全身）裁中间格——正面全身单图。
 * 2511 三参考档的 image2（锁身体/服装）：零生成成本（canvas 裁剪），归档后 prompt 带【正面全身】前缀。
 */
export async function cropFrontView(triView: Blob): Promise<Blob> {
  const img = await blobToBitmap(triView);
  const w = Math.round(img.width / 3);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('正面全身裁剪失败：canvas 不可用');
  ctx.drawImage(img, w, 0, w, img.height, 0, 0, w, img.height); // 中间格
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('正面全身裁剪失败'))), 'image/png'),
  );
}
