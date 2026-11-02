import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readAssetPack } from "../src";

const PACK = path.resolve(__dirname, "..", "..", "..", "release", "Marchlands-models-converted.mlpack");

describe("converted model pack", () => {
  it.skipIf(!fs.existsSync(PACK))("contains every converted model family", async () => {
    const pack = await readAssetPack(new Uint8Array(fs.readFileSync(PACK)));
    expect(pack.manifest.assets).toHaveLength(105);
    const count = (kind: string): number => pack.manifest.assets.filter((asset) => asset.kind === kind).length;
    expect(count("prop")).toBe(45 + 17 + 3);
    expect(count("building")).toBe(24 + 3);
    expect(count("unit")).toBe(5);
    expect(count("terrain")).toBe(8);
    expect(pack.manifest.assets.filter((asset) => asset.id.startsWith("converted:castle."))).toHaveLength(17);
  });
});
