import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { buildAssetPack } from "@marchlands/asset-pack";
import type { AssetEntry, AssetManifest } from "@marchlands/asset-pack";
import { art } from "./assets";
import { assetRegistry } from "./asset-registry";
import { TOWN_BUILDINGS, buildBuilding, buildTown, buildWall, paletteFor } from "./buildings";
import { BUILDING_KINDS, BUILDING_NAMES } from "./building-types";
import { buildUnit } from "./unit-models";
import { UNIT_KINDS, UNIT_NAMES } from "./unit-models";
import { buildTerrainAsset, TERRAIN_ASSETS } from "./visual-assets";

export interface ConvertedFile {
  name: string;
  base64: string;
  size: number;
}

declare global {
  interface Window {
    __convertReady?: boolean;
    __convertError?: string;
    __convertFiles?: ConvertedFile[];
    __convertPack?: string;
    __convertManifest?: AssetManifest;
  }
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}

function shrinkTextures(object: THREE.Object3D): void {
  const size = 96;
  object.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mesh.material = materials.map((material) => {
      const standard = material as THREE.MeshStandardMaterial;
      const image = standard.map?.image as CanvasImageSource | undefined;
      if (!standard.map || !image) return material;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext("2d");
      if (!context) return material;
      context.drawImage(image, 0, 0, size, size);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = standard.map.colorSpace;
      texture.wrapS = standard.map.wrapS;
      texture.wrapT = standard.map.wrapT;
      texture.repeat.copy(standard.map.repeat);
      texture.needsUpdate = true;
      const clone = standard.clone();
      clone.map = texture;
      clone.needsUpdate = true;
      return clone;
    });
    if (Array.isArray(mesh.material) && mesh.material.length === 1) mesh.material = mesh.material[0];
  });
}

function tagTeamMaterials(object: THREE.Object3D): void {
  const palette = paletteFor(0);
  const edge = new THREE.Color(palette.roofEdge);
  const cloth = new THREE.Color(palette.cloth);
  object.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (material.name) continue;
      const standard = material as THREE.MeshStandardMaterial;
      if (standard.map) {
        material.name = "team_roof";
      } else if (standard.color?.equals(cloth)) {
        material.name = "team_cloth";
      } else if (standard.color?.equals(edge)) {
        material.name = "team_edge";
      }
    }
  });
}

async function exportObject(
  object: THREE.Object3D,
  name: string,
  animations: THREE.AnimationClip[] = [],
): Promise<ConvertedFile> {
  object.updateMatrixWorld(true);
  const exporter = new GLTFExporter();
  const output = await exporter.parseAsync(object, {
    binary: true,
    onlyVisible: false,
    ...(animations.length > 0 ? { animations } : {}),
  });
  if (!(output instanceof ArrayBuffer)) throw new Error(`${name} 导出结果不是二进制 GLB`);
  const bytes = new Uint8Array(output);
  return { name, base64: base64(bytes), size: bytes.byteLength };
}

function quaternion(x: number, y: number, z: number): [number, number, number, number] {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z));
  return [q.x, q.y, q.z, q.w];
}

function rotationTrack(name: string, times: number[], rotations: Array<[number, number, number]>): THREE.QuaternionKeyframeTrack {
  const values = rotations.flatMap(([x, y, z]) => quaternion(x, y, z));
  return new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, times, values);
}

function unitClips(rig: ReturnType<typeof buildUnit>): THREE.AnimationClip[] {
  const times = [0, 0.25, 0.5, 0.75, 1];
  const leftRest = rig.leftArm.rotation.x;
  const rightRest = rig.rightArm.rotation.x;
  const walk = new THREE.AnimationClip("walk", 1, [
    rotationTrack("leftLeg", times, [[0.55, 0, 0], [0, 0, 0], [-0.55, 0, 0], [0, 0, 0], [0.55, 0, 0]]),
    rotationTrack("rightLeg", times, [[-0.55, 0, 0], [0, 0, 0], [0.55, 0, 0], [0, 0, 0], [-0.55, 0, 0]]),
    rotationTrack("leftArm", times, [[-0.3, 0, 0], [0, 0, 0], [0.3, 0, 0], [0, 0, 0], [-0.3, 0, 0]].map(([x, y, z]) => [leftRest + x, y, z] as [number, number, number])),
    rotationTrack("rightArm", times, [[0.3, 0, 0], [0, 0, 0], [-0.3, 0, 0], [0, 0, 0], [0.3, 0, 0]].map(([x, y, z]) => [rightRest + x, y, z] as [number, number, number])),
    new THREE.VectorKeyframeTrack("torso.position", times, [0, 0.19, 0, 0, 0.22, 0, 0, 0.19, 0, 0, 0.22, 0, 0, 0.19, 0]),
  ]);
  const idle = new THREE.AnimationClip("idle", 2, [
    rotationTrack("leftArm", [0, 1, 2], [[leftRest, 0, 0], [leftRest - 0.05, 0, 0], [leftRest, 0, 0]]),
    rotationTrack("rightArm", [0, 1, 2], [[rightRest, 0, 0], [rightRest - 0.05, 0, 0], [rightRest, 0, 0]]),
    rotationTrack("head", [0, 1, 2], [[0, 0, 0], [0, 0.08, 0], [0, 0, 0]]),
    new THREE.VectorKeyframeTrack("torso.position", [0, 1, 2], [0, 0.19, 0, 0, 0.195, 0, 0, 0.19, 0]),
  ]);
  if (rig.mount) {
    const mountTimes = [0, 0.25, 0.5, 0.75, 1];
    for (let index = 0; index < rig.mountLegs.length; index += 1) {
      const phase = index % 2 === 0 ? 1 : -1;
      walk.tracks.push(
        rotationTrack(`mountLeg${index}`, mountTimes, [
          [phase * 0.35, 0, 0],
          [0, 0, 0],
          [-phase * 0.35, 0, 0],
          [0, 0, 0],
          [phase * 0.35, 0, 0],
        ]),
      );
    }
  }
  return [idle, walk];
}

function buildRiggedDemo(): { object: THREE.Group; animations: THREE.AnimationClip[] } {
  const group = new THREE.Group();
  group.name = "unit.rigged-demo";
  const hips = new THREE.Bone();
  hips.name = "bone_hips";
  hips.position.y = 0.5;
  const chest = new THREE.Bone();
  chest.name = "bone_chest";
  chest.position.y = 0.5;
  hips.add(chest);

  const geometry = new THREE.BoxGeometry(0.35, 1, 0.35, 1, 4, 1);
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  const indices: number[] = [];
  const weights: number[] = [];
  for (let index = 0; index < position.count; index += 1) {
    const t = Math.max(0, Math.min(1, (position.getY(index) + 0.5) / 1));
    indices.push(0, 1, 0, 0);
    weights.push(1 - t, t, 0, 0);
  }
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(indices, 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(weights, 4));

  const body = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial({ color: 0x5cc07f, roughness: 0.9, flatShading: true }));
  body.name = "body";
  body.add(hips);
  body.bind(new THREE.Skeleton([hips, chest]));
  group.add(body);

  const idle = new THREE.AnimationClip("idle", 2, [
    rotationTrack("bone_chest", [0, 1, 2], [[0, 0, 0], [0.08, 0, 0], [0, 0, 0]]),
  ]);
  const walk = new THREE.AnimationClip("walk", 1, [
    rotationTrack("bone_hips", [0, 0.5, 1], [[0, 0, 0], [0, 0.25, 0], [0, 0, 0]]),
    rotationTrack("bone_chest", [0, 0.5, 1], [[0.1, 0, 0], [-0.1, 0, 0], [0.1, 0, 0]]),
  ]);
  return { object: group, animations: [idle, walk] };
}

function nameUnitRig(root: THREE.Object3D): void {
  let index = 0;
  root.traverse((node) => {
    if (!node.name) node.name = `node_${index}`;
    index += 1;
  });
}

export async function runModelConvert(host: HTMLElement): Promise<void> {
  host.innerHTML = `
    <div style="padding:40px;color:#ece3d2;font-family:monospace;background:#0b110d;min-height:100vh">
      <h1 style="font-size:18px">模型格式转换</h1>
      <pre id="convert-log">准备中…</pre>
    </div>`;
  const log = host.querySelector("#convert-log") as HTMLElement;
  const write = (text: string): void => {
    log.textContent += `\n${text}`;
    console.log("[convert]", text);
  };
  try {
    write("加载内置模型…");
    await art.load();
    assetRegistry.registerBuiltins();
    const files: ConvertedFile[] = [];
    const assets: AssetEntry[] = [];

    write("导出城堡 OBJ…");
    for (const name of art.castleNames) {
      const object = art.castle(name, 0x97917f);
      if (!object) continue;
      const file = `models/castle/${name}.glb`;
      files.push(await exportObject(object, file));
      assets.push({
        id: `converted:castle.${name.toLowerCase()}`,
        kind: "prop",
        label: `城堡 · ${name}`,
        file,
        scale: 0.3,
        footprint: 3,
        height: 4,
        tags: ["城堡"],
      });
      write(`  城堡 ${name}`);
    }

    write("导出程序化建筑…");
    for (const kind of BUILDING_KINDS) {
      for (const level of [1, 2, 3] as const) {
        const object = buildBuilding(kind, paletteFor(0), level, 0);
        tagTeamMaterials(object);
        shrinkTextures(object);
        const file = `models/building/${kind}-L${level}.glb`;
        files.push(await exportObject(object, file));
        assets.push({
          id: `converted:building.${kind}.l${level}`,
          kind: "building",
          label: `${BUILDING_NAMES[kind]} L${level}`,
          file,
          scale: 1,
          footprint: 3,
          height: 4,
          tags: ["建筑"],
        });
        write(`  建筑 ${kind} L${level}`);
      }
    }

    write("导出城墙与城镇组合…");
    for (const level of [1, 2, 3] as const) {
      const wall = buildWall(level, paletteFor(0), 3.3);
      tagTeamMaterials(wall);
      const wallFile = `models/building/wall-L${level}.glb`;
      files.push(await exportObject(wall, wallFile));
      assets.push({
        id: `converted:wall.l${level}`,
        kind: "prop",
        label: `城墙 L${level}`,
        file: wallFile,
        scale: 1,
        footprint: 7,
        height: 1,
        tags: ["建筑构件"],
      });
      for (const kind of TOWN_BUILDINGS) {
        const town = buildTown(level, paletteFor(0), 0, kind);
        town.add(buildWall(level, paletteFor(0), 3.3));
        tagTeamMaterials(town);
        shrinkTextures(town);
        const townFile = `models/town/town-${kind}-L${level}.glb`;
        files.push(await exportObject(town, townFile));
        assets.push({
          id: `converted:town.${kind}.l${level}`,
          kind: "building",
          label: `城镇 ${kind} L${level}`,
          file: townFile,
          scale: 1,
          footprint: 8,
          height: 6,
          tags: ["建筑"],
        });
      }
      write(`  城镇 / 城墙 L${level}`);
    }

    write("导出单位模型…");
    for (const kind of UNIT_KINDS) {
      const rig = buildUnit(kind, paletteFor(0), 0);
      shrinkTextures(rig.root);
      rig.root.name = `unit.${kind}`;
      rig.torso.name = "torso";
      rig.head.name = "head";
      rig.leftArm.name = "leftArm";
      rig.rightArm.name = "rightArm";
      rig.leftLeg.name = "leftLeg";
      rig.rightLeg.name = "rightLeg";
      if (rig.mount) rig.mount.name = "mount";
      rig.mountLegs.forEach((leg, index) => { leg.name = `mountLeg${index}`; });
      nameUnitRig(rig.root);
      const file = `models/unit/${kind}.glb`;
      files.push(await exportObject(rig.root, file, unitClips(rig)));
      assets.push({
        id: `converted:unit.${kind}`,
        kind: "unit",
        label: `${UNIT_NAMES[kind]}（部件动画）`,
        file,
        scale: 1,
        footprint: 1.2,
        height: 1.8,
        tags: ["单位"],
      });
      write(`  单位 ${kind}`);
    }

    write("导出骨骼演示单位…");
    {
      const demo = buildRiggedDemo();
      const file = "models/unit/rigged-demo.glb";
      files.push(await exportObject(demo.object, file, demo.animations));
      assets.push({
        id: "converted:unit.rigged-demo",
        kind: "unit",
        label: "骨骼演示单位",
        file,
        scale: 1,
        footprint: 0.6,
        height: 1.2,
        tags: ["单位"],
      });
    }

    write("导出地形块…");
    for (const asset of TERRAIN_ASSETS) {
      const object = buildTerrainAsset(asset.kind, 1, "frontier");
      const file = `models/terrain/${asset.kind}.glb`;
      files.push(await exportObject(object, file));
      assets.push({
        id: `converted:terrain.${asset.kind}`,
        kind: "terrain",
        label: asset.label,
        file,
        scale: 1,
        footprint: asset.footprint,
        height: asset.height,
        tags: ["地形"],
      });
      write(`  地形 ${asset.label}`);
    }

    write("复制 Kenney GLB…");
    for (const info of assetRegistry.list("prop")) {
      if (info.source !== "builtin" || !info.sourceFile) continue;
      const url = art.modelSource(info.sourceFile);
      if (!url) continue;
      const response = await fetch(url);
      if (!response.ok) continue;
      const bytes = new Uint8Array(await response.arrayBuffer());
      const slug = info.id.split(":")[1].replace(/[^a-z0-9.-]+/g, "-");
      const file = `models/kenney/${slug}.glb`;
      files.push({ name: file, base64: base64(bytes), size: bytes.byteLength });
      assets.push({
        id: `converted:prop.${slug}`,
        kind: "prop",
        label: info.label,
        file,
        scale: info.scale,
        rotation: info.rotation,
        footprint: info.footprint,
        height: info.height,
        ...(info.tags.length > 0 ? { tags: info.tags } : {}),
      });
      write(`  Kenney ${info.label}`);
    }

    const manifest: AssetManifest = {
      format: "mlpack",
      version: 1,
      id: "com.marchlands.converted",
      name: "Marchlands 全模型转换包",
      author: "Marchlands",
      description: "OBJ、程序化建筑、城墙、城镇、单位、地形与 Kenney GLB 的统一格式快照",
      assets,
    };
    write("打包 .mlpack…");
    const pack = buildAssetPack(manifest, files.map((file) => ({
      name: file.name,
      data: Uint8Array.from(atob(file.base64), (char) => char.charCodeAt(0)),
    })));
    window.__convertFiles = files;
    window.__convertPack = base64(pack);
    window.__convertManifest = manifest;
    window.__convertReady = true;
    write(`完成：${files.length} 个 GLB，资产包 ${(pack.byteLength / 1024).toFixed(1)} KB`);
  } catch (error) {
    window.__convertError = error instanceof Error ? error.stack ?? error.message : String(error);
    write(`失败：${window.__convertError}`);
  }
}