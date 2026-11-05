/**
 * 骑兵合成脚本：Quaternius 的马 + KayKit 的骑手 → 单个 cavalry.glb。
 *
 * 依赖 @gltf-transform/core 与 @gltf-transform/functions（本仓库不在 tools 下安装，
 * 需要在有这两个包的环境执行，例如仓库根的临时目录）。
 *
 *   node build-cavalry.mjs horse.glb kaykit-cavalry.glb cavalry.glb
 *
 * 处理内容：
 * 1. 马：8 个平涂材质烘成顶点色 + 手工拼接成一个 primitive，减少绘制。
 * 2. 骑手：把骑乘姿态（腿外展下垂、手臂前伸）烘焙进 ride 剪辑。
 * 3. 合并：两个骨架共存在一个场景里，动作加 horse- / rider- 前缀。
 */
import { Document, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { mergeDocuments, prune, dedup } from "@gltf-transform/functions";
import { stat } from "node:fs/promises";

/**
 * 把 Quaternius 的马和 KayKit 的骑手合成一个骑兵 GLB。
 * 用法：node build-cavalry.mjs <horse.glb> <rider.glb> <out.glb>
 */
const [, , horsePath, riderPath, outPath] = process.argv;

const HORSE_HEIGHT = 1.6;
const RIDER_HEIGHT = 1.38;
const RIDER_POS = [0, 0.98, 0.06];

const POSE = {
  "upperleg.l": [0.75, 0, -0.9],
  "upperleg.r": [0.75, 0, 0.9],
  "lowerleg.l": [1.15, 0, 0],
  "lowerleg.r": [1.15, 0, 0],
  "upperarm.l": [-0.55, 0, 0.25],
  "upperarm.r": [-0.55, 0, -0.25],
};

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

function quatFromEuler(x, y, z) {
  const cx = Math.cos(x / 2), sx = Math.sin(x / 2);
  const cy = Math.cos(y / 2), sy = Math.sin(y / 2);
  const cz = Math.cos(z / 2), sz = Math.sin(z / 2);
  return [
    sx * cy * cz + cx * sy * sz,
    cx * sy * cz - sx * cy * sz,
    cx * cy * sz + sx * sy * cz,
    cx * cy * cz - sx * sy * sz,
  ];
}

function quatMul(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

function boundsOf(doc) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const mesh of doc.getRoot().listMeshes()) {
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
  return { min, max, size: max.map((v, i) => v - min[i]) };
}

function wrap(doc, scale, position) {
  const root = doc.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  const wrapper = doc.createNode("mount");
  for (const node of scene.listChildren()) wrapper.addChild(node);
  scene.addChild(wrapper);
  wrapper.setScale([scale, scale, scale]);
  wrapper.setTranslation(position);
  return wrapper;
}

function bakePose(doc) {
  const offsets = new Map();
  for (const [name, euler] of Object.entries(POSE)) {
    offsets.set(name, quatFromEuler(euler[0], euler[1], euler[2]));
  }
  let touched = 0;
  for (const animation of doc.getRoot().listAnimations()) {
    for (const channel of animation.listChannels()) {
      const node = channel.getTargetNode();
      const offset = node ? offsets.get(node.getName()) : null;
      if (!offset || channel.getTargetPath() !== "rotation") continue;
      const output = channel.getSampler().getOutput();
      const value = [0, 0, 0, 0];
      for (let i = 0; i < output.getCount(); i += 1) {
        output.getElement(i, value);
        output.setElement(i, quatMul(Array.from(value), offset));
      }
      touched += 1;
    }
  }
  return touched;
}


/**
 * 马的 8 个平涂材质合并成 1 个：颜色烘到 COLOR_0，再手工拼一个 primitive。
 * join() 不处理蒙皮网格，所以这里直接拼属性数组。
 */
function mergeSkinnedPrimitives(doc, mesh, materialName) {
  const prims = mesh.listPrimitives();
  if (prims.length <= 1) return mesh;

  const root = doc.getRoot();
  const material = doc.createMaterial(materialName).setBaseColorFactor([1, 1, 1, 1]).setMetallicFactor(0).setRoughnessFactor(0.65);

  const chunks = { POSITION: [], NORMAL: [], JOINTS_0: [], WEIGHTS_0: [], COLOR_0: [] };
  const indices = [];
  let offset = 0;
  const indexType = prims[0].getIndices()?.getComponentType() ?? 5125;

  for (const prim of prims) {
    const material_ = prim.getMaterial();
    const color = material_?.getBaseColorFactor() ?? [1, 1, 1, 1];
    const count = prim.getAttribute("POSITION").getCount();
    for (const semantic of ["POSITION", "NORMAL", "JOINTS_0", "WEIGHTS_0"]) {
      const accessor = prim.getAttribute(semantic);
      if (accessor) chunks[semantic].push(accessor.getArray());
    }
    const colors = new Float32Array(count * 4);
    for (let i = 0; i < count; i += 1) {
      colors[i * 4] = color[0];
      colors[i * 4 + 1] = color[1];
      colors[i * 4 + 2] = color[2];
      colors[i * 4 + 3] = color[3] ?? 1;
    }
    chunks.COLOR_0.push(colors);
    const primIndices = prim.getIndices()?.getArray();
    if (primIndices) for (let i = 0; i < primIndices.length; i += 1) indices.push(primIndices[i] + offset);
    offset += count;
  }

  const concat = (list, width, type) => {
    const total = list.reduce((n, a) => n + a.length, 0);
    const out = new type(total);
    let cursor = 0;
    for (const part of list) { out.set(part, cursor); cursor += part.length; }
    return out;
  };

  const built = doc.createPrimitive().setMaterial(material);
  built.setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(concat(chunks.POSITION, 3, Float32Array)));
  built.setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setArray(concat(chunks.NORMAL, 3, Float32Array)));
  built.setAttribute("JOINTS_0", doc.createAccessor().setType("VEC4").setArray(concat(chunks.JOINTS_0, 4, Uint16Array)));
  built.setAttribute("WEIGHTS_0", doc.createAccessor().setType("VEC4").setArray(concat(chunks.WEIGHTS_0, 4, Float32Array)));
  built.setAttribute("COLOR_0", doc.createAccessor().setType("VEC4").setArray(concat(chunks.COLOR_0, 4, Float32Array)));
  const indexArray = indexType === 5123 ? new Uint16Array(indices) : new Uint32Array(indices);
  built.setIndices(doc.createAccessor().setType("SCALAR").setArray(indexArray));

  for (const prim of prims) prim.dispose();
  mesh.addPrimitive(built);
  return mesh;
}

const horse = await io.read(horsePath);
const horseBounds = boundsOf(horse);
const horseScale = HORSE_HEIGHT / horseBounds.size[1];
wrap(horse, horseScale, [0, -horseBounds.min[1] * horseScale, -((horseBounds.min[2] + horseBounds.max[2]) / 2) * horseScale]);
for (const animation of horse.getRoot().listAnimations()) animation.setName("horse-" + animation.getName());
for (const mesh of horse.getRoot().listMeshes()) mergeSkinnedPrimitives(horse, mesh, "horse_body");
console.log("horse prims", horse.getRoot().listMeshes().flatMap((m) => m.listPrimitives()).length);

const rider = await io.read(riderPath);
const riderBounds = boundsOf(rider);
const riderScale = RIDER_HEIGHT / riderBounds.size[1];
wrap(rider, riderScale, RIDER_POS);
const touched = bakePose(rider);
for (const animation of rider.getRoot().listAnimations()) animation.setName("rider-" + animation.getName());
console.log("rider pose channels", touched);

const target = new Document();
await mergeDocuments(target, horse);
await mergeDocuments(target, rider);
await target.transform(prune(), dedup());
// 合并后每个来源会各带一个场景，先把它们并到同一个场景里。
const root = target.getRoot();
const scenes = root.listScenes();
const primaryScene = scenes[0];
for (const scene of scenes.slice(1)) {
  for (const child of [...scene.listChildren()]) primaryScene.addChild(child);
  scene.dispose();
}

const [primary] = root.listBuffers();
for (const accessor of root.listAccessors()) {
  if (accessor.getBuffer() !== primary) accessor.setBuffer(primary);
}
for (const extra of root.listBuffers().slice(1)) extra.dispose();

const prims = target.getRoot().listMeshes().flatMap((m) => m.listPrimitives()).length;
const materials = target.getRoot().listMaterials().map((m) => m.getName());
const animations = target.getRoot().listAnimations().map((a) => a.getName());
await io.write(outPath, target);
const info = await stat(outPath);
console.log(JSON.stringify({ prims, materials, animations, bytes: info.size }, null, 1));
