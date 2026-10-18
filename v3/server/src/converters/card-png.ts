/**
 * 角色卡 PNG 导入导出（Task 24）：零依赖手写 PNG chunk 级读写。
 *
 * PNG 结构：8 字节签名 + chunk 流（4B 大端长度 + 4B 类型 + data + 4B CRC）。
 * 酒馆把卡 JSON base64 后塞进 tEXt chunk（data = keyword\0text）：
 *   keyword=chara → V2 卡；keyword=ccv3 → V3 卡（读取时 ccv3 优先）。
 * 写入：删除旧 chara/ccv3 → IEND 前插入 chara(V2) + ccv3(V3) 双 chunk（CRC 重算）。
 * 逻辑对照 SillyTavern character-card-parser.js。
 */
import { randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';

import { TavernCardV2Schema } from '@shared/tavern';
import type { CharacterAsset } from '@shared/card';

// ---------- CRC32（PNG 规范多项式 0xEDB88320，查表法） ----------

const CRC_TABLE = /* @__PURE__ */ (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---------- PNG chunk 解析 / 编码 ----------

export interface PngChunk {
  type: string;
  data: Buffer;
  /** data 在原 buffer 中的起始偏移（不含 8B length+type 头） */
  offset: number;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** 校验签名后遍历 chunk 流（遇 IEND 收尾）；结构越界即抛错，不静默截断 */
export function parsePngChunks(buf: Buffer): PngChunk[] {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('不是合法的 PNG 文件（签名不符）');
  }
  const chunks: PngChunk[] = [];
  let pos = 8;
  while (pos + 8 <= buf.length) {
    const length = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const start = pos + 8;
    if (start + length + 4 > buf.length) throw new Error('PNG chunk 越界，文件已损坏');
    chunks.push({ type, data: buf.subarray(start, start + length), offset: start });
    pos = start + length + 4; // 跳过 4B CRC
    if (type === 'IEND') break;
  }
  return chunks;
}

/** chunk 数组 → PNG buffer（CRC 覆盖 type+data，现算） */
export function encodePng(chunks: PngChunk[]): Buffer {
  const parts: Buffer[] = [PNG_SIGNATURE];
  for (const chunk of chunks) {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(chunk.data.length, 0);
    head.write(chunk.type, 4, 'latin1');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), chunk.data])), 0);
    parts.push(head, chunk.data, crc);
  }
  return Buffer.concat(parts);
}

// ---------- tEXt chunk（keyword\0text；酒馆文本均为 base64 纯 ASCII，latin1 足够） ----------

function encodeTextChunk(keyword: string, text: string): PngChunk {
  return {
    type: 'tEXt',
    data: Buffer.concat([
      Buffer.from(keyword, 'latin1'),
      Buffer.from([0]),
      Buffer.from(text, 'latin1'),
    ]),
    offset: 0,
  };
}

function decodeTextChunk(chunk: PngChunk): { keyword: string; text: string } {
  const zero = chunk.data.indexOf(0);
  if (zero < 0) throw new Error('tEXt chunk 格式非法（缺少 \\0 分隔）');
  return {
    keyword: chunk.data.toString('latin1', 0, zero),
    text: chunk.data.toString('latin1', zero + 1),
  };
}

// ---------- 卡数据提取 / 写入 ----------

/** 提取卡 JSON：ccv3(V3) 优先，退回 chara(V2)；无元数据 / 数据损坏均抛人话错误 */
export function extractCardData(buf: Buffer): unknown {
  const texts = parsePngChunks(buf)
    .filter((c) => c.type === 'tEXt')
    .map(decodeTextChunk)
    .filter((t) => ['chara', 'ccv3'].includes(t.keyword.toLowerCase()));
  const chosen = texts.find((t) => t.keyword.toLowerCase() === 'ccv3') ?? texts[0];
  if (!chosen) throw new Error('该 PNG 不含角色卡元数据');
  try {
    return JSON.parse(Buffer.from(chosen.text, 'base64').toString('utf8')) as unknown;
  } catch {
    throw new Error('角色卡元数据损坏：base64/JSON 解析失败');
  }
}

/**
 * 以 srcBuf 为底图产出新 PNG：保留全部原 chunk，仅剔除旧 chara/ccv3，
 * 在 IEND 前插入 chara=base64(V2) 与 ccv3=base64(V3) 双 chunk（V3=V2 内容改 spec/spec_version）。
 */
export function writeCardData(srcBuf: Buffer, cardJson: Record<string, unknown>): Buffer {
  const v2 = Buffer.from(JSON.stringify(cardJson), 'utf8').toString('base64');
  const v3 = Buffer.from(
    JSON.stringify({ ...cardJson, spec: 'chara_card_v3', spec_version: '3.0' }),
    'utf8',
  ).toString('base64');
  const chunks = parsePngChunks(srcBuf).filter((c) => {
    if (c.type !== 'tEXt') return true;
    const k = decodeTextChunk(c).keyword.toLowerCase();
    return k !== 'chara' && k !== 'ccv3';
  });
  chunks.splice(-1, 0, encodeTextChunk('chara', v2), encodeTextChunk('ccv3', v3));
  return encodePng(chunks);
}

// ---------- 占位 PNG（程序生成 1x1 透明 RGBA，导出无底图时兜底） ----------

export function createPlaceholderPng(): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0); // width
  ihdr.writeUInt32BE(1, 4); // height
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(6, 9); // color type: RGBA
  // [10..12] compression/filter/interlace 全 0；像素 = filter 0 + RGBA 全 0
  return encodePng([
    { type: 'IHDR', data: ihdr, offset: 0 },
    { type: 'IDAT', data: deflateSync(Buffer.from([0, 0, 0, 0, 0])), offset: 0 },
    { type: 'IEND', data: Buffer.alloc(0), offset: 0 },
  ]);
}

// ---------- 酒馆卡 → 内部资产归一化（V1/V2/V3 → CharacterAsset） ----------

/**
 * V2/V3（有 spec+data）：原样收编为 card（passthrough 保字段，roundtrip 零丢失）；
 * V1（无 data 字段）：顶层字段整体提升包成 V2 壳（未知字段一并保留在 data 内）。
 * id/avatar 由调用方决定（本函数不落盘不产生文件路径）。
 */
export function toInternalCard(tavernJson: unknown, id: string = randomUUID()): CharacterAsset {
  const raw = { ...(tavernJson ?? {}) } as Record<string, unknown>;
  const isVersioned = typeof raw.spec === 'string' && typeof raw.data === 'object' && raw.data !== null;
  let card: CharacterAsset['card'];
  if (isVersioned) {
    card = TavernCardV2Schema.parse(raw);
  } else {
    // V1：剔除壳外键后整体提升；V2 必需字段给空串默认值（酒馆惯例）
    delete raw.spec;
    delete raw.spec_version;
    card = TavernCardV2Schema.parse({
      spec: 'chara_card_v2',
      spec_version: '2.0',
      data: {
        name: '',
        description: '',
        personality: '',
        scenario: '',
        first_mes: '',
        mes_example: '',
        ...raw,
      },
    });
  }
  return { id, name: String(card.data.name ?? '未命名角色'), card };
}
