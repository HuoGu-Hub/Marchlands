/**
 * 法师塔与火球：替换小尺寸贴图、归一尺寸、居中贴地。
 * 依赖 @gltf-transform/core/functions（不在 tools 下安装，需在有依赖的环境执行）。
 *   node build-scene-assets.mjs <tower.glb> <fireball.glb> <towerTexDir> <fireballTexDir> <outDir>
 * 贴图目录里放 tiny_*.png / small_*.png，按文件名排序依次替换模型里的贴图。
 */
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { prune, dedup, cloneDocument, quantize } from "@gltf-transform/functions";
import { readFile, readdir, mkdir } from "node:fs/promises";
import path from "node:path";

/**
 * 法师塔与火球：换小贴图、归一尺寸、地面居中。
 * 用法：node build-scene-assets.mjs <tower.glb> <fireball.glb> <towerDir> <fireballDir> <outDir>
 */
const [, , towerPath, fireballPath, towerTexDir, fireballTexDir, outDir] = process.argv;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

async function loadTextures(dir) {
  const files = (await readdir(dir)).filter((f) => /^(small|tiny)_/.test(f)).sort();
  const out = [];
  for (const file of files) out.push(await readFile(path.join(dir, file)));
  return out;
}

async function replaceTextures(doc, images) {
  const textures = doc.getRoot().listTextures();
  for (let i = 0; i < textures.length && i < images.length; i += 1) {
    textures[i].setImage(images[i]);
    textures[i].setMimeType("image/png");
  }
  return textures.length;
}

function bounds(doc) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const position = prim.getAttribute("POSITION");
      if (!position) continue;
      const lo = position.getMin([]);
      const hi = position.getMax([]);
      for (let i = 0; i < 3; i += 1) { min[i] = Math.min(min[i], lo[i]); max[i] = Math.max(max[i], hi[i]); }
    }
  }
  return { min, max, size: max.map((v, i) => v - min[i]) };
}

/** 缩放到目标尺寸、x/z 居中、底面贴地。 */
function normalize(doc, targetSize) {
  const root = doc.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  const box = bounds(doc);
  const scale = targetSize / Math.max(box.size[0], box.size[1], box.size[2]);
  const wrapper = doc.createNode("root");
  for (const node of scene.listChildren()) wrapper.addChild(node);
  scene.addChild(wrapper);
  wrapper.setScale([scale, scale, scale]);
  wrapper.setTranslation([
    -((box.min[0] + box.max[0]) / 2) * scale,
    -box.min[1] * scale,
    -((box.min[2] + box.max[2]) / 2) * scale,
  ]);
}

// --- 法师塔 ---
const towerDoc = await io.read(towerPath);
await replaceTextures(towerDoc, await loadTextures(towerTexDir));
for (const material of towerDoc.getRoot().listMaterials()) {
  if (material.getName() === "Crystal") material.setName("team_roof");
}
await mkdir(outDir, { recursive: true });
const tower = cloneDocument(towerDoc);
normalize(tower, 2.3);
await tower.transform(prune(), dedup(), quantize());
await io.write(path.join(outDir, "mage.glb"), tower);
console.log("mage ok");

// --- 火球 ---
const fireDoc = await io.read(fireballPath);
await replaceTextures(fireDoc, await loadTextures(fireballTexDir));
normalize(fireDoc, 1.2);
await fireDoc.transform(prune(), dedup());
await io.write(path.join(outDir, "fireball.glb"), fireDoc);
console.log("fireball ok");
