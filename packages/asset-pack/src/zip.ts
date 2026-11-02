import { AssetPackError } from "./types";

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const EOCD = 0x06054b50;
const UTF8_FLAG = 0x0800;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function decodeName(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function readU16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function readU32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const Ctor = (globalThis as unknown as { DecompressionStream?: new (format: string) => unknown })
    .DecompressionStream;
  if (!Ctor) throw new AssetPackError(["当前环境不支持解压资产包，请使用未压缩的资产包"]);
  const stream = new Ctor("deflate-raw") as {
    writable: WritableStream<Uint8Array>;
    readable: ReadableStream<Uint8Array>;
  };
  const writer = stream.writable.getWriter();
  void writer.write(bytes);
  void writer.close();
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const result = await reader.read();
    if (result.done) break;
    if (result.value) {
      chunks.push(result.value);
      total += result.value.byteLength;
      if (total > 64 * 1024 * 1024) throw new AssetPackError(["资产包解压后超过 64 MB"]);
    }
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

export async function readZip(
  bytes: Uint8Array,
  limits = { maxBytes: 64 * 1024 * 1024, maxFiles: 512 },
): Promise<Map<string, Uint8Array>> {
  if (bytes.byteLength > limits.maxBytes) throw new AssetPackError(["资产包超过 64 MB"]);
  if (bytes.byteLength < 22) throw new AssetPackError(["不是有效的 ZIP 资产包"]);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  const floor = Math.max(0, bytes.byteLength - 65557);
  for (let offset = bytes.byteLength - 22; offset >= floor; offset -= 1) {
    if (readU32(view, offset) === EOCD) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new AssetPackError(["找不到 ZIP 目录"]);
  const disk = readU16(view, eocd + 4);
  const cdDisk = readU16(view, eocd + 6);
  const countDisk = readU16(view, eocd + 8);
  const count = readU16(view, eocd + 10);
  const cdSize = readU32(view, eocd + 12);
  const cdOffset = readU32(view, eocd + 16);
  if (disk !== 0 || cdDisk !== 0 || countDisk !== count) {
    throw new AssetPackError(["不支持分卷 ZIP 资产包"]);
  }
  if (count > limits.maxFiles) throw new AssetPackError([`资产包文件数超过 ${limits.maxFiles}`]);
  if (cdOffset + cdSize > bytes.byteLength) throw new AssetPackError(["ZIP 目录越界"]);

  const files = new Map<string, Uint8Array>();
  let offset = cdOffset;
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > bytes.byteLength || readU32(view, offset) !== CENTRAL) {
      throw new AssetPackError(["ZIP 目录损坏"]);
    }
    const flags = readU16(view, offset + 8);
    const method = readU16(view, offset + 10);
    const crc = readU32(view, offset + 16);
    const compressedSize = readU32(view, offset + 20);
    const size = readU32(view, offset + 24);
    const nameLength = readU16(view, offset + 28);
    const extraLength = readU16(view, offset + 30);
    const commentLength = readU16(view, offset + 32);
    const localOffset = readU32(view, offset + 42);
    if (offset + 46 + nameLength > bytes.byteLength) throw new AssetPackError(["ZIP 文件名越界"]);
    const name = decodeName(bytes.subarray(offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extraLength + commentLength;

    if (flags & 0x1) throw new AssetPackError([`${name} 是加密文件`]);
    if (method !== 0 && method !== 8) throw new AssetPackError([`${name} 使用了不支持的压缩方式`]);
    if (localOffset + 30 > bytes.byteLength || readU32(view, localOffset) !== LOCAL) {
      throw new AssetPackError([`${name} 的本地文件头损坏`]);
    }
    const localNameLength = readU16(view, localOffset + 26);
    const localExtraLength = readU16(view, localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    if (dataOffset + compressedSize > bytes.byteLength) throw new AssetPackError([`${name} 数据越界`]);
    const localName = decodeName(bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength));
    if (localName !== name) throw new AssetPackError([`${name} 的本地文件名与目录不一致`]);
    const compressed = bytes.subarray(dataOffset, dataOffset + compressedSize);
    const data = method === 0 ? compressed.slice() : await inflateRaw(compressed);
    if (data.byteLength !== size) throw new AssetPackError([`${name} 解压后长度不正确`]);
    if (crc32(data) !== crc) throw new AssetPackError([`${name} 校验失败`]);
    if (!name.endsWith("/")) files.set(name, data);
  }
  return files;
}

export interface ZipFile {
  name: string;
  data: Uint8Array;
}

export function writeZip(files: ZipFile[]): Uint8Array {
  const encoder = new TextEncoder();
  const entries = files.map((file) => {
    const name = encoder.encode(file.name);
    return {
      name,
      data: file.data,
      crc: crc32(file.data),
    };
  });
  const localSize = entries.reduce((sum, entry) => sum + 30 + entry.name.length + entry.data.length, 0);
  const centralSize = entries.reduce((sum, entry) => sum + 46 + entry.name.length, 0);
  const output = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(output.buffer);
  let offset = 0;
  const localOffsets: number[] = [];
  for (const entry of entries) {
    localOffsets.push(offset);
    view.setUint32(offset, LOCAL, true);
    view.setUint16(offset + 4, 20, true);
    view.setUint16(offset + 6, UTF8_FLAG, true);
    view.setUint16(offset + 8, 0, true);
    view.setUint16(offset + 10, 0, true);
    view.setUint16(offset + 12, 0x0021, true);
    view.setUint32(offset + 14, entry.crc, true);
    view.setUint32(offset + 18, entry.data.length, true);
    view.setUint32(offset + 22, entry.data.length, true);
    view.setUint16(offset + 26, entry.name.length, true);
    view.setUint16(offset + 28, 0, true);
    output.set(entry.name, offset + 30);
    output.set(entry.data, offset + 30 + entry.name.length);
    offset += 30 + entry.name.length + entry.data.length;
  }
  const centralOffset = offset;
  entries.forEach((entry, index) => {
    view.setUint32(offset, CENTRAL, true);
    view.setUint16(offset + 4, 20, true);
    view.setUint16(offset + 6, 20, true);
    view.setUint16(offset + 8, UTF8_FLAG, true);
    view.setUint16(offset + 10, 0, true);
    view.setUint16(offset + 12, 0, true);
    view.setUint16(offset + 14, 0x0021, true);
    view.setUint32(offset + 16, entry.crc, true);
    view.setUint32(offset + 20, entry.data.length, true);
    view.setUint32(offset + 24, entry.data.length, true);
    view.setUint16(offset + 28, entry.name.length, true);
    view.setUint16(offset + 30, 0, true);
    view.setUint16(offset + 32, 0, true);
    view.setUint16(offset + 34, 0, true);
    view.setUint16(offset + 36, 0, true);
    view.setUint32(offset + 38, 0, true);
    view.setUint32(offset + 42, localOffsets[index], true);
    output.set(entry.name, offset + 46);
    offset += 46 + entry.name.length;
  });
  view.setUint32(offset, EOCD, true);
  view.setUint16(offset + 4, 0, true);
  view.setUint16(offset + 6, 0, true);
  view.setUint16(offset + 8, entries.length, true);
  view.setUint16(offset + 10, entries.length, true);
  view.setUint32(offset + 12, centralSize, true);
  view.setUint32(offset + 16, centralOffset, true);
  view.setUint16(offset + 20, 0, true);
  return output;
}
