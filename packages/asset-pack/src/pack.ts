import { assertGlb, parseAssetManifest } from "./manifest";
import {
  AssetPackError,
  DEFAULT_PACK_LIMITS,
  type AssetManifest,
  type AssetPack,
  type AssetPackLimits,
} from "./types";
import { readZip, writeZip, type ZipFile } from "./zip";

const MANIFEST = "pack.json";

export async function readAssetPack(
  bytes: Uint8Array,
  limits: AssetPackLimits = DEFAULT_PACK_LIMITS,
): Promise<AssetPack> {
  if (bytes.byteLength > limits.maxBytes) throw new AssetPackError(["资产包超过 64 MB"]);
  const files = await readZip(bytes, limits);
  const manifestBytes = files.get(MANIFEST);
  if (!manifestBytes) throw new AssetPackError(["资产包缺少 pack.json"]);
  if (manifestBytes.byteLength > limits.maxManifestBytes) throw new AssetPackError(["pack.json 超过 16 MB"]);
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder("utf-8").decode(manifestBytes));
  } catch {
    throw new AssetPackError(["pack.json 不是有效的 JSON"]);
  }
  const manifest = parseAssetManifest(raw);
  const seen = new Set<string>();
  for (const asset of manifest.assets) {
    if (!asset.file) throw new AssetPackError([`${asset.id} 缺少 file`]);
    if (seen.has(asset.file)) throw new AssetPackError([`${asset.file} 被多个资产引用`]);
    seen.add(asset.file);
    const data = files.get(asset.file);
    if (!data) throw new AssetPackError([`${asset.id} 引用的 ${asset.file} 不存在`]);
    if (data.byteLength > limits.maxAssetBytes) throw new AssetPackError([`${asset.file} 超过 32 MB`]);
    assertGlb(data, asset.file);
  }
  return { manifest, files };
}

export function buildAssetPack(manifestInput: AssetManifest, files: ZipFile[]): Uint8Array {
  const manifest = parseAssetManifest(manifestInput);
  const byName = new Map(files.map((file) => [file.name, file.data]));
  for (const asset of manifest.assets) {
    if (!asset.file) throw new AssetPackError([`${asset.id} 缺少 file`]);
    const data = byName.get(asset.file);
    if (!data) throw new AssetPackError([`${asset.id} 引用的 ${asset.file} 不存在`]);
    assertGlb(data, asset.file);
  }
  const encoded = new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`);
  return writeZip([{ name: MANIFEST, data: encoded }, ...files]);
}
