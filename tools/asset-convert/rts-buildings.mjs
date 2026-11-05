import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { prune, dedup } from "@gltf-transform/functions";
import { mkdir } from "node:fs/promises";
import path from "node:path";

/**
 * 把 Quaternius Ultimate Fantasy RTS 的建筑做成据点预制体：
 * 屋顶材质改名 team_roof 参与阵营染色，原点居中、底面贴地，整体缩放到占地尺寸。
 * 用法：node rts-buildings.mjs <glTF 目录> <输出目录>
 */
const MAP = {
  barbarian: "Barracks_FirstAge",
  warrior: "Barracks_SecondAge",
  archer: "Archery_FirstAge",
  ranger: "Archery_SecondAge",
  mage: "Temple_SecondAge",
};
const TARGET_SIZE = { 1: 2.0, 2: 2.3, 3: 2.6 };

const [, , sourceDir, outDir] = process.argv;
if (!sourceDir || !outDir) {
  console.error("usage: node rts-buildings.mjs <gltfDir> <outDir>");
  process.exit(1);
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
await mkdir(outDir, { recursive: true });

for (const [kind, family] of Object.entries(MAP)) {
  for (const level of [1, 2, 3]) {
    const doc = await io.read(path.join(sourceDir, family + "_Level" + level + ".gltf"));
    const root = doc.getRoot();
    for (const material of root.listMaterials()) {
      if (material.getName() === "Main") material.setName("team_roof");
    }

    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const mesh of root.listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        const position = prim.getAttribute("POSITION");
        if (!position) continue;
        const lo = position.getMin([]);
        const hi = position.getMax([]);
        for (let i = 0; i < 3; i += 1) {
          min[i] = Math.min(min[i], lo[i]);
          max[i] = Math.max(max[i], hi[i]);
        }
      }
    }

    const size = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
    const scale = TARGET_SIZE[level] / Math.max(0.001, size);
    const centerX = (min[0] + max[0]) / 2;
    const centerZ = (min[2] + max[2]) / 2;
    const baseY = min[1];

    const scene = root.getDefaultScene() ?? root.listScenes()[0];
    const wrapper = doc.createNode("root");
    for (const node of scene.listChildren()) wrapper.addChild(node);
    scene.addChild(wrapper);
    wrapper.setScale([scale, scale, scale]);
    wrapper.setTranslation([-centerX * scale, -baseY * scale, -centerZ * scale]);

    await doc.transform(prune(), dedup());
    await io.write(path.join(outDir, kind + "-L" + level + ".glb"), doc);
    console.log(kind + "-L" + level, "from", family + "_Level" + level, "scale", scale.toFixed(2));
  }
}
