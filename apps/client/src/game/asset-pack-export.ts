import { buildAssetPack } from "@marchlands/asset-pack";
import type { AssetEntry, AssetManifest } from "@marchlands/asset-pack";
import { art } from "./assets";
import { assetRegistry } from "./asset-registry";

const PACK_ID = "com.marchlands.builtin";

function slugOf(id: string): string {
  return id.split(":")[1]?.replace(/[^a-z0-9.-]+/g, "-").replace(/^-+|-+$/g, "") || "asset";
}

export async function buildBuiltinAssetPack(): Promise<{ bytes: Uint8Array; count: number }> {
  const assets = assetRegistry
    .list("prop")
    .filter((asset) => asset.source === "builtin" && asset.sourceFile && art.modelSource(asset.sourceFile));
  if (assets.length === 0) throw new Error("没有可导出的内置模型");
  const entries: AssetEntry[] = [];
  const files: Array<{ name: string; data: Uint8Array }> = [];
  for (const asset of assets) {
    const source = art.modelSource(asset.sourceFile as string);
    if (!source) continue;
    const response = await fetch(source);
    if (!response.ok) throw new Error(`读取 ${asset.label} 失败`);
    const data = new Uint8Array(await response.arrayBuffer());
    const file = `models/${slugOf(asset.id)}.glb`;
    entries.push({
      id: `com.marchlands:${slugOf(asset.id)}`,
      kind: "prop",
      label: asset.label,
      file,
      scale: asset.scale,
      rotation: asset.rotation,
      footprint: asset.footprint,
      height: asset.height,
      ...(asset.tags.length > 0 ? { tags: asset.tags } : {}),
    });
    files.push({ name: file, data });
  }
  const manifest: AssetManifest = {
    format: "mlpack",
    version: 1,
    id: PACK_ID,
    name: "Marchlands 内置模型",
    author: "Marchlands",
    description: "从客户端内置 Kenney 模型导出的示例资产包",
    assets: entries,
  };
  return { bytes: buildAssetPack(manifest, files), count: files.length };
}
