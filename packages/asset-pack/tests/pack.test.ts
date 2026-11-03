import { describe, expect, it } from "vitest";
import {
  AssetPackError,
  buildAssetPack,
  parseAssetManifest,
  readAssetPack,
} from "../src";

function glbStub(bytes = 12): Uint8Array {
  const data = new Uint8Array(bytes);
  const view = new DataView(data.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes, true);
  return data;
}

function manifest(assets: unknown[] = [
  {
    id: "com.example:tent",
    kind: "prop",
    label: "帐篷",
    file: "models/tent.glb",
    scale: 1.2,
  },
]) {
  return {
    format: "mlpack",
    version: 1,
    id: "com.example.camp",
    name: "营地资产",
    assets,
  };
}

describe("asset pack manifest", () => {
  it("accepts a valid manifest and keeps optional metadata", () => {
    const parsed = parseAssetManifest(manifest());
    expect(parsed.assets[0]).toMatchObject({
      id: "com.example:tent",
      kind: "prop",
      scale: 1.2,
    });
  });

  it("accepts foundation assets", () => {
    const parsed = parseAssetManifest(manifest([
      {
        id: "com.example:island-base",
        kind: "foundation",
        label: "地基",
        file: "models/base.glb",
        footprint: 70,
      },
    ]));
    expect(parsed.assets[0].kind).toBe("foundation");
  });

  it("rejects malformed ids, duplicate assets and unsafe paths", () => {
    expect(() => parseAssetManifest(manifest([
      { id: "tent", kind: "prop", label: "帐篷", file: "models/tent.glb" },
    ]))).toThrow(AssetPackError);
    expect(() => parseAssetManifest(manifest([
      { id: "com.example:tent", kind: "prop", label: "帐篷", file: "../tent.glb" },
    ]))).toThrow(AssetPackError);
    expect(() => parseAssetManifest(manifest([
      { id: "com.example:tent", kind: "prop", label: "帐篷", file: "models/tent.glb" },
      { id: "com.example:tent", kind: "prop", label: "帐篷 2", file: "models/tent2.glb" },
    ]))).toThrow(AssetPackError);
  });
});

describe("asset pack zip", () => {
  it("round-trips a pack through zip without compression", async () => {
    const bytes = buildAssetPack(manifest() as never, [
      { name: "models/tent.glb", data: glbStub() },
    ]);
    const pack = await readAssetPack(bytes);
    expect(pack.manifest.name).toBe("营地资产");
    expect(pack.files.get("models/tent.glb")?.byteLength).toBe(12);
  });

  it("rejects a pack whose glb is missing or corrupt", async () => {
    expect(() => buildAssetPack(manifest() as never, [])).toThrow(AssetPackError);
    const bytes = buildAssetPack(manifest() as never, [
      { name: "models/tent.glb", data: glbStub() },
    ]);
    const copy = bytes.slice();
    let glbOffset = -1;
    for (let index = 0; index < copy.length - 4; index += 1) {
      if (copy[index] === 0x67 && copy[index + 1] === 0x6c && copy[index + 2] === 0x54 && copy[index + 3] === 0x46) {
        glbOffset = index;
        break;
      }
    }
    expect(glbOffset).toBeGreaterThan(0);
    copy[glbOffset] = 0;
    await expect(readAssetPack(copy)).rejects.toBeInstanceOf(AssetPackError);
  });
});
