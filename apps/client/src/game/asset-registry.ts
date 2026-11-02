import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import { readAssetPack } from "@marchlands/asset-pack";
import type { AssetEntry, AssetKind, AssetManifest } from "@marchlands/asset-pack";
import type { Level, Owner } from "@marchlands/sim";
import { art } from "./assets";
import { buildBuilding, buildTown, paletteFor } from "./buildings";
import { deleteStoredPack, listStoredPacks, saveStoredPack } from "./asset-pack-store";
import { buildTerrainAsset, TERRAIN_ASSETS } from "./visual-assets";
import type { TerrainAssetKind } from "./visual-assets";

export const TEAM_COLORS: Record<Owner, number> = {
  0: 0x97917f,
  1: 0x5cc07f,
  2: 0xe06a4a,
};

export interface AssetBuildContext {
  owner?: Owner;
  level?: Level;
  seed?: number;
  terrainStyle?: string;
}

export interface AssetInfo {
  id: string;
  kind: AssetKind;
  label: string;
  tags: string[];
  scale: number;
  rotation: number;
  footprint: number;
  height: number;
  source: "builtin" | "pack";
  packId?: string;
  sourceFile?: string;
}

interface BuiltinAsset extends AssetInfo {
  build(context: Required<AssetBuildContext>): THREE.Object3D | Promise<THREE.Object3D>;
}

interface PackAsset {
  entry: AssetEntry;
  prototype: THREE.Object3D;
  packId: string;
}

interface PropSpec {
  id: string;
  file: string;
  label: string;
  tags: string[];
  scale: number;
  footprint: number;
  height: number;
}

const PROP_SPECS: PropSpec[] = [
  { id: "builtin:prop.tree.pine-tall", file: "tree_pineTallA", label: "高松", tags: ["树木"], scale: 3.2, footprint: 2.2, height: 7.5 },
  { id: "builtin:prop.tree.oak", file: "tree_oak", label: "橡树", tags: ["树木"], scale: 3.1, footprint: 2.4, height: 6.2 },
  { id: "builtin:prop.tree.detailed", file: "tree_detailed", label: "阔叶树", tags: ["树木"], scale: 3.0, footprint: 2.3, height: 6.0 },
  { id: "builtin:prop.tree.default", file: "tree_default", label: "松树", tags: ["树木"], scale: 3.0, footprint: 2.0, height: 6.4 },
  { id: "builtin:prop.tree.pine-round", file: "tree_pineRoundC", label: "圆松", tags: ["树木"], scale: 3.0, footprint: 2.1, height: 5.8 },
  { id: "builtin:prop.tree.simple", file: "tree_simple", label: "小树", tags: ["树木"], scale: 2.8, footprint: 1.6, height: 4.6 },
  { id: "builtin:prop.tree.thin", file: "tree_thin", label: "细树", tags: ["树木"], scale: 2.7, footprint: 1.4, height: 5.6 },
  { id: "builtin:prop.tree.high", file: "treeHigh", label: "高树", tags: ["树木"], scale: 2.7, footprint: 2.2, height: 7.2 },
  { id: "builtin:prop.tree.crooked", file: "treeCrooked", label: "歪树", tags: ["树木"], scale: 2.8, footprint: 2.0, height: 5.2 },
  { id: "builtin:prop.tree.town", file: "tree", label: "城镇树", tags: ["树木"], scale: 2.8, footprint: 1.8, height: 5.4 },
  { id: "builtin:prop.plant.bush", file: "plant_bush", label: "灌木", tags: ["草木"], scale: 2.2, footprint: 1.1, height: 1.4 },
  { id: "builtin:prop.plant.grass", file: "grass", label: "草丛", tags: ["草木"], scale: 2.2, footprint: 1.0, height: 0.8 },
  { id: "builtin:prop.flower.red", file: "flower_redA", label: "红花", tags: ["草木"], scale: 2.1, footprint: 0.8, height: 0.8 },
  { id: "builtin:prop.flower.yellow", file: "flower_yellowA", label: "黄花", tags: ["草木"], scale: 2.1, footprint: 0.8, height: 0.8 },
  { id: "builtin:prop.mushroom.red-group", file: "mushroom_redGroup", label: "红蘑菇", tags: ["草木"], scale: 2.1, footprint: 0.9, height: 1.0 },
  { id: "builtin:prop.rock.large", file: "rock_largeB", label: "大岩石", tags: ["岩石"], scale: 1.9, footprint: 2.4, height: 2.0 },
  { id: "builtin:prop.rock.small-a", file: "rock_smallA", label: "小岩石 A", tags: ["岩石"], scale: 1.9, footprint: 1.2, height: 1.0 },
  { id: "builtin:prop.rock.small-b", file: "rock_smallB", label: "小岩石 B", tags: ["岩石"], scale: 1.9, footprint: 1.2, height: 1.0 },
  { id: "builtin:prop.rock.small-c", file: "rock_smallC", label: "小岩石 C", tags: ["岩石"], scale: 1.9, footprint: 1.0, height: 0.8 },
  { id: "builtin:prop.town.rock-large", file: "rockLarge", label: "城镇大石", tags: ["城镇"], scale: 1.8, footprint: 2.2, height: 1.8 },
  { id: "builtin:prop.town.rock-small", file: "rockSmall", label: "城镇小石", tags: ["城镇"], scale: 1.8, footprint: 1.0, height: 0.8 },
  { id: "builtin:prop.lantern", file: "lantern", label: "路灯", tags: ["城镇"], scale: 2.6, footprint: 1.0, height: 3.2 },
  { id: "builtin:prop.stall.green", file: "stallGreen", label: "绿摊位", tags: ["城镇"], scale: 2.1, footprint: 2.2, height: 2.2 },
  { id: "builtin:prop.stall.red", file: "stallRed", label: "红摊位", tags: ["城镇"], scale: 2.1, footprint: 2.2, height: 2.2 },
  { id: "builtin:prop.cart", file: "cart", label: "手推车", tags: ["城镇"], scale: 2.0, footprint: 1.4, height: 1.2 },
  { id: "builtin:prop.fountain.round", file: "fountainRound", label: "喷泉", tags: ["城镇"], scale: 2.2, footprint: 2.6, height: 1.6 },
  { id: "builtin:prop.hedge", file: "hedge", label: "树篱", tags: ["城镇"], scale: 2.2, footprint: 2.0, height: 1.2 },
  { id: "builtin:prop.fence", file: "fence", label: "栅栏", tags: ["城镇"], scale: 2.2, footprint: 2.0, height: 1.2 },
  { id: "builtin:prop.fence.gate", file: "fenceGate", label: "栅栏门", tags: ["城镇"], scale: 2.2, footprint: 1.6, height: 1.4 },
  { id: "builtin:prop.banner.green", file: "bannerGreen", label: "绿旗", tags: ["城镇"], scale: 2.2, footprint: 1.0, height: 3.0 },
  { id: "builtin:prop.banner.red", file: "bannerRed", label: "红旗", tags: ["城镇"], scale: 2.2, footprint: 1.0, height: 3.0 },
  { id: "builtin:prop.windmill", file: "windmill", label: "风车", tags: ["城镇"], scale: 1.7, footprint: 3.4, height: 6.0 },
  { id: "builtin:prop.watermill", file: "watermill", label: "水车", tags: ["城镇"], scale: 1.9, footprint: 3.6, height: 4.2 },
  { id: "builtin:prop.road", file: "road", label: "道路块", tags: ["城镇"], scale: 2.0, footprint: 2.0, height: 0.2 },
  { id: "builtin:prop.stairs.wood", file: "stairsWood", label: "木楼梯", tags: ["建筑构件"], scale: 2.0, footprint: 1.6, height: 1.2 },
  { id: "builtin:prop.wall", file: "wall", label: "石墙", tags: ["建筑构件"], scale: 2.2, footprint: 2.4, height: 1.8 },
  { id: "builtin:prop.wall.corner", file: "wallCorner", label: "石墙角", tags: ["建筑构件"], scale: 2.2, footprint: 2.4, height: 1.8 },
  { id: "builtin:prop.wall.door", file: "wallDoor", label: "石墙门", tags: ["建筑构件"], scale: 2.2, footprint: 2.4, height: 1.8 },
  { id: "builtin:prop.wall.wood", file: "wallWood", label: "木墙", tags: ["建筑构件"], scale: 2.2, footprint: 2.4, height: 1.8 },
  { id: "builtin:prop.wall.wood-corner", file: "wallWoodCorner", label: "木墙角", tags: ["建筑构件"], scale: 2.2, footprint: 2.4, height: 1.8 },
  { id: "builtin:prop.wall.wood-door", file: "wallWoodDoor", label: "木墙门", tags: ["建筑构件"], scale: 2.2, footprint: 2.4, height: 1.8 },
  { id: "builtin:prop.roof.corner", file: "roofCorner", label: "屋顶转角", tags: ["建筑构件"], scale: 2.2, footprint: 2.2, height: 1.4 },
  { id: "builtin:prop.roof.flat", file: "roofFlat", label: "平屋顶", tags: ["建筑构件"], scale: 2.2, footprint: 2.2, height: 0.6 },
  { id: "builtin:prop.roof.gable-end", file: "roofGableEnd", label: "山墙屋顶", tags: ["建筑构件"], scale: 2.2, footprint: 2.2, height: 1.6 },
  { id: "builtin:prop.roof.high-gable", file: "roofHighGable", label: "高山墙", tags: ["建筑构件"], scale: 2.2, footprint: 2.2, height: 2.0 },
  { id: "builtin:prop.roof.point", file: "roofPoint", label: "尖屋顶", tags: ["建筑构件"], scale: 2.2, footprint: 2.2, height: 2.0 },
];

const CASTLE_SPECS: PropSpec[] = [
  { id: "builtin:castle.flag-long", file: "flagBannerLong", label: "长旗", tags: ["城堡"], scale: 0.3, footprint: 1.0, height: 4.0 },
  { id: "builtin:castle.flag-short", file: "flagBannerShort", label: "短旗", tags: ["城堡"], scale: 0.3, footprint: 0.8, height: 2.0 },
  { id: "builtin:castle.flag-blue", file: "flagBlue", label: "蓝旗", tags: ["城堡"], scale: 0.3, footprint: 1.0, height: 4.0 },
  { id: "builtin:castle.flag-blue-wide", file: "flagBlueWide", label: "宽蓝旗", tags: ["城堡"], scale: 0.3, footprint: 1.2, height: 4.0 },
  { id: "builtin:castle.gate", file: "gate", label: "城门", tags: ["城堡"], scale: 0.3, footprint: 4.0, height: 4.0 },
  { id: "builtin:castle.stairs", file: "stairsStone", label: "石阶", tags: ["城堡"], scale: 0.3, footprint: 3.0, height: 1.5 },
  { id: "builtin:castle.tower-base", file: "towerSquareBase", label: "方塔基座", tags: ["城堡"], scale: 0.3, footprint: 3.0, height: 4.0 },
  { id: "builtin:castle.tower-mid", file: "towerSquareMid", label: "方塔中段", tags: ["城堡"], scale: 0.3, footprint: 3.0, height: 4.0 },
  { id: "builtin:castle.tower-windows", file: "towerSquareMidWindows", label: "方塔窗段", tags: ["城堡"], scale: 0.3, footprint: 3.0, height: 4.0 },
  { id: "builtin:castle.tower-roof", file: "towerSquareRoof", label: "方塔顶", tags: ["城堡"], scale: 0.3, footprint: 3.0, height: 2.0 },
  { id: "builtin:castle.tower-high-roof", file: "towerSquareTopRoofHigh", label: "高塔顶", tags: ["城堡"], scale: 0.3, footprint: 3.0, height: 3.0 },
  { id: "builtin:castle.top-roof", file: "towerTopRoof", label: "塔顶", tags: ["城堡"], scale: 0.3, footprint: 3.0, height: 2.0 },
  { id: "builtin:castle.wall", file: "wall", label: "城墙", tags: ["城堡"], scale: 0.3, footprint: 5.0, height: 4.0 },
  { id: "builtin:castle.wall-corner", file: "wallCorner", label: "城墙角", tags: ["城堡"], scale: 0.3, footprint: 5.0, height: 4.0 },
  { id: "builtin:castle.wall-half", file: "wallHalf", label: "半墙", tags: ["城堡"], scale: 0.3, footprint: 2.5, height: 2.0 },
  { id: "builtin:castle.wall-narrow", file: "wallNarrow", label: "窄墙", tags: ["城堡"], scale: 0.3, footprint: 2.5, height: 4.0 },
  { id: "builtin:castle.wall-pillar", file: "wallPillar", label: "墙柱", tags: ["城堡"], scale: 0.3, footprint: 1.8, height: 4.0 },
];

const BUILDING_SPECS: Array<{ id: string; label: string; kind: "town" | "tower" | "granary"; tags: string[] }> = [
  { id: "builtin:building.town", label: "城镇大厅", kind: "town", tags: ["建筑"] },
  { id: "builtin:building.tower", label: "弓箭塔", kind: "tower", tags: ["建筑"] },
  { id: "builtin:building.granary", label: "粮仓", kind: "granary", tags: ["建筑"] },
];

function slugName(name: string): string {
  return name.replace(/_/g, ".").replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

function markShared(object: THREE.Object3D): void {
  object.traverse((entry) => {
    const mesh = entry as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      material.userData.shared = true;
    }
    if (mesh.geometry) mesh.geometry.userData.shared = true;
  });
}

function tintMaterial(material: THREE.Material, color: number): THREE.Material {
  const name = material.name.toLowerCase();
  const wants = name.startsWith("team") || material.userData.teamColor === true;
  if (!wants) return material;
  const clone = material.clone();
  const tinted = clone as THREE.MeshStandardMaterial;
  if (tinted.color instanceof THREE.Color) tinted.color.setHex(color);
  clone.userData.shared = false;
  clone.name = material.name;
  return clone;
}

function applyTeamColor(object: THREE.Object3D, owner: Owner): void {
  const color = TEAM_COLORS[owner];
  object.traverse((entry) => {
    const mesh = entry as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (Array.isArray(mesh.material)) {
      mesh.material = mesh.material.map((material) => tintMaterial(material, color));
    } else {
      mesh.material = tintMaterial(mesh.material, color);
    }
  });
}

function normalizeContext(context: AssetBuildContext): Required<AssetBuildContext> {
  return {
    owner: context.owner ?? 0,
    level: context.level ?? 3,
    seed: context.seed ?? 1,
    terrainStyle: context.terrainStyle ?? "frontier",
  };
}

export class AssetRegistry {
  private readonly builtins = new Map<string, BuiltinAsset>();
  private readonly packAssets = new Map<string, PackAsset>();
  private readonly packs = new Map<string, AssetManifest>();
  private readonly warnings: string[] = [];
  private registered = false;
  private loading: Promise<number> | null = null;

  get builtinReady(): boolean {
    return this.registered;
  }

  registerBuiltins(): boolean {
    if (this.registered) return true;
    if (!art.ready) return false;
    this.registered = true;

    for (const asset of TERRAIN_ASSETS) {
      this.addBuiltin({
        id: `builtin:terrain.${asset.kind}`,
        kind: "terrain",
        label: asset.label,
        tags: ["地形"],
        scale: 1,
        rotation: 0,
        footprint: asset.footprint,
        height: asset.height,
        source: "builtin",
        build: (context) => buildTerrainAsset(asset.kind as TerrainAssetKind, context.seed, context.terrainStyle),
      });
    }

    for (const spec of BUILDING_SPECS) {
      this.addBuiltin({
        id: spec.id,
        kind: "building",
        label: spec.label,
        tags: spec.tags,
        scale: 1,
        rotation: 0,
        footprint: spec.kind === "town" ? 8 : 4,
        height: spec.kind === "town" ? 6 : 5,
        source: "builtin",
        build: (context) => {
          const palette = paletteFor(context.owner);
          if (spec.kind === "town") return buildTown(context.level, palette, context.seed);
          return buildBuilding(spec.kind, palette, context.level, context.seed);
        },
      });
    }

    const usedFiles = new Set<string>();
    for (const spec of PROP_SPECS) {
      if (!art.hasModel(spec.file)) continue;
      usedFiles.add(spec.file);
      this.addBuiltin({
        ...spec,
        kind: "prop",
        rotation: 0,
        source: "builtin",
        sourceFile: spec.file,
        build: () => {
          const model = art.model(spec.file);
          if (!model) throw new Error(`资产模型缺失：${spec.file}`);
          model.scale.multiplyScalar(spec.scale);
          return model;
        },
      });
    }
    for (const spec of CASTLE_SPECS) {
      if (!art.hasCastle(spec.file)) continue;
      usedFiles.add(spec.file);
      this.addBuiltin({
        ...spec,
        kind: "prop",
        rotation: 0,
        source: "builtin",
        build: () => {
          const model = art.castle(spec.file);
          if (!model) throw new Error(`资产模型缺失：${spec.file}`);
          model.scale.multiplyScalar(spec.scale);
          return model;
        },
      });
    }
    for (const name of art.modelNames) {
      if (usedFiles.has(name)) continue;
      const id = `builtin:prop.${slugName(name)}`;
      if (this.builtins.has(id)) continue;
      this.addBuiltin({
        id,
        kind: "prop",
        label: name,
        tags: ["其他"],
        scale: 2.0,
        rotation: 0,
        footprint: 1.5,
        height: 2.0,
        source: "builtin",
        build: () => {
          const model = art.model(name);
          if (!model) throw new Error(`资产模型缺失：${name}`);
          model.scale.multiplyScalar(2);
          return model;
        },
      });
    }
    return true;
  }

  private addBuiltin(asset: BuiltinAsset): void {
    this.builtins.set(asset.id, asset);
  }

  has(id: string): boolean {
    return this.builtins.has(id) || this.packAssets.has(id);
  }

  info(id: string): AssetInfo | null {
    return this.builtins.get(id) ?? this.packInfo(this.packAssets.get(id));
  }

  private packInfo(asset: PackAsset | undefined): AssetInfo | null {
    if (!asset) return null;
    return {
      id: asset.entry.id,
      kind: asset.entry.kind,
      label: asset.entry.label,
      tags: asset.entry.tags ?? [],
      scale: asset.entry.scale ?? 1,
      rotation: asset.entry.rotation ?? 0,
      footprint: asset.entry.footprint ?? 1.5,
      height: asset.entry.height ?? 2,
      source: "pack",
      packId: asset.packId,
    };
  }

  list(kind?: AssetKind): AssetInfo[] {
    const rows: AssetInfo[] = [
      ...this.builtins.values(),
      ...[...this.packAssets.values()].map((asset) => this.packInfo(asset)).filter((asset): asset is AssetInfo => asset !== null),
    ];
    return rows
      .filter((asset) => !kind || asset.kind === kind)
      .sort((a, b) => {
        if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
        if (a.source !== b.source) return a.source === "builtin" ? -1 : 1;
        return a.label.localeCompare(b.label, "zh-CN");
      });
  }

  counts(): { terrain: number; prop: number; building: number; unit: number; packs: number } {
    const result = { terrain: 0, prop: 0, building: 0, unit: 0, packs: this.packs.size };
    for (const asset of this.builtins.values()) result[asset.kind] += 1;
    for (const asset of this.packAssets.values()) result[asset.entry.kind] += 1;
    return result;
  }

  get packList(): AssetManifest[] {
    return [...this.packs.values()];
  }

  get packWarnings(): string[] {
    return [...this.warnings];
  }

  async build(id: string, context: AssetBuildContext = {}): Promise<THREE.Object3D> {
    const frame = normalizeContext(context);
    const builtin = this.builtins.get(id);
    if (builtin) return builtin.build(frame);
    const asset = this.packAssets.get(id);
    if (!asset) throw new Error(`未知资产：${id}`);
    const model = cloneSkeleton(asset.prototype);
    const wrapper = new THREE.Group();
    wrapper.add(model);
    if (asset.entry.scale && asset.entry.scale !== 1) model.scale.multiplyScalar(asset.entry.scale);
    if (asset.entry.rotation) model.rotation.y += (asset.entry.rotation * Math.PI) / 180;
    if (asset.entry.teamColor) applyTeamColor(model, frame.owner);
    return wrapper;
  }

  async loadPack(
    bytes: Uint8Array,
    options: { persist?: boolean; fileName?: string } = {},
  ): Promise<{ manifest: AssetManifest; count: number }> {
    const pack = await readAssetPack(bytes);
    if (this.packs.has(pack.manifest.id)) this.unloadPack(pack.manifest.id);

    const loader = new GLTFLoader();
    const next = new Map<string, PackAsset>();
    for (const entry of pack.manifest.assets) {
      if (this.builtins.has(entry.id) || this.packAssets.has(entry.id)) {
        throw new Error(`资产 ID 与现有资产冲突：${entry.id}`);
      }
      if (!entry.file) throw new Error(`${entry.id} 缺少模型文件`);
      const data = pack.files.get(entry.file);
      if (!data) throw new Error(`${entry.file} 不存在`);
      const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
      let prototype: THREE.Object3D;
      try {
        const gltf = await loader.parseAsync(buffer, "");
        prototype = gltf.scene;
      } catch (error) {
        throw new Error(`${entry.file} 无法解析：${error instanceof Error ? error.message : "未知错误"}`);
      }
      markShared(prototype);
      next.set(entry.id, { entry, prototype, packId: pack.manifest.id });
    }

    for (const [id, asset] of next) this.packAssets.set(id, asset);
    this.packs.set(pack.manifest.id, pack.manifest);
    if (options.persist) {
      const saved = await saveStoredPack(pack.manifest, bytes);
      if (!saved) this.warnings.push(`${pack.manifest.name} 无法写入本地资产库，重开后会丢失`);
    }
    return { manifest: pack.manifest, count: next.size };
  }

  unloadPack(packId: string): void {
    for (const [id, asset] of [...this.packAssets]) {
      if (asset.packId === packId) this.packAssets.delete(id);
    }
    this.packs.delete(packId);
  }

  async removePack(packId: string): Promise<void> {
    this.unloadPack(packId);
    await deleteStoredPack(packId);
  }

  async loadStoredPacks(): Promise<number> {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      this.registerBuiltins();
      const stored = await listStoredPacks();
      let loaded = 0;
      for (const record of stored) {
        if (this.packs.has(record.id)) continue;
        try {
          await this.loadPack(new Uint8Array(record.bytes), { persist: false, fileName: record.name });
          loaded += 1;
        } catch (error) {
          this.warnings.push(`${record.name} 未能载入：${error instanceof Error ? error.message : "未知错误"}`);
        }
      }
      return loaded;
    })();
    return this.loading;
  }
}

export const assetRegistry = new AssetRegistry();