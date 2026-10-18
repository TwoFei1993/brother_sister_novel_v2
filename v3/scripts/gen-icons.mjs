#!/usr/bin/env node
/**
 * PWA 图标生成器（Task 33）：零依赖手写 PNG 编码（zlib deflate + CRC32）
 *
 * 设计对齐 client/index.html 的内联 SVG favicon：紫底圆角方块 + 白色"翻开的书"形。
 * maskable 安全：主体居中且四周留 10% 边距，全幅紫底无透明角。
 *
 * 用法：node scripts/gen-icons.mjs   （输出 client/public/icon-{192,512}.png + icon.svg）
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../client/public');

/** 品牌紫（与 favicon #7c5cbf 一致） */
const BG = [124, 92, 191, 255];
const FG = [255, 255, 255, 255];

/** 圆角矩形命中测试（坐标 0-1 归一化） */
function inRoundRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.max(x0 + r, Math.min(x, x1 - r));
  const cy = Math.max(y0 + r, Math.min(y, y1 - r));
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r || (x >= x0 + r && x <= x1 - r) || (y >= y0 + r && y <= y1 - r);
}

/** 翻开的书形：左右两页 + 中缝留白（归一化坐标） */
function bookPixel(nx, ny) {
  const r = 0.04;
  const left = inRoundRect(nx, ny, 0.18, 0.3, 0.47, 0.7, r);
  const right = inRoundRect(nx, ny, 0.53, 0.3, 0.82, 0.7, r);
  return left || right;
}

function drawPixel(size) {
  const rows = [];
  for (let y = 0; y < size; y += 1) {
    const row = Buffer.alloc(size * 4 + 1);
    row[0] = 0; // filter: none
    for (let x = 0; x < size; x += 1) {
      const nx = x / size;
      const ny = y / size;
      const color = bookPixel(nx, ny) ? FG : BG;
      const o = 1 + x * 4;
      row[o] = color[0];
      row[o + 1] = color[1];
      row[o + 2] = color[2];
      row[o + 3] = color[3];
    }
    rows.push(row);
  }
  return Buffer.concat(rows);
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(drawPixel(size), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of [192, 512]) {
  writeFileSync(resolve(OUT_DIR, `icon-${size}.png`), encodePng(size));
  console.log(`[gen-icons] icon-${size}.png 已生成`);
}
writeFileSync(
  resolve(OUT_DIR, 'icon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#7c5cbf"/><rect x="11" y="19" width="19" height="26" rx="3" fill="#fff"/><rect x="34" y="19" width="19" height="26" rx="3" fill="#fff"/></svg>`,
);
console.log('[gen-icons] icon.svg 已生成');
