import * as THREE from "three";
import { groundMaterial } from "./ground-material";
import { paintGroundTexture } from "./ground-paint";
import { createTerrainCliffMaterial, createTerrainGroundMaterial } from "./terrain-detail";
import { buildGridTerrainMeshes } from "./terrain-grid";
import type { CityId, MapDef } from "@marchlands/sim";
import {
  buildGridSurface,
  createHeightField,
  foundationDepth,
  foundationRect,
} from "@marchlands/map-authoring";
import type { FoundationShape, MapVisual, TerrainStyle } from "@marchlands/map-authoring";
import {
  NavGrid,
  Surface,
  decodeBitmapBase64,
  decodeInt16Base64,
  decodeUint8Base64,
} from "@marchlands/nav";

function hash2(x: number, z: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ seed;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function valueNoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = smooth(x - ix);
  const fz = smooth(z - iz);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz;
}

function segmentDistance(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const lengthSq = dx * dx + dz * dz;
  if (lengthSq === 0) return Math.hypot(px - ax, pz - az);
  let t = ((px - ax) * dx + (pz - az) * dz) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}


export interface TerrainStylePalette {
  grass: number;
  grassDark: number;
  grassLight: number;
  dirt: number;
  dirtLight: number;
  rock: number;
  rockDark: number;
  ridge: number;
  ridgeDark: number;
  mesa: number;
  mesaCap: number;
  skirt: number;
  background: number;
  fog: number;
}

export const TERRAIN_PALETTES: Record<string, TerrainStylePalette> = {
  frontier: {
    grass: 0x58743c,
    grassDark: 0x44602f,
    grassLight: 0x6b8849,
    dirt: 0x927e52,
    dirtLight: 0xa59060,
    rock: 0x77705f,
    rockDark: 0x5a5548,
    ridge: 0x8a857a,
    ridgeDark: 0x5d574d,
    mesa: 0x7c715d,
    mesaCap: 0x647845,
    skirt: 0x4a3f2e,
    background: 0x0c120e,
    fog: 0x0c120e,
  },
  meadow: {
    grass: 0x6f9148,
    grassDark: 0x547338,
    grassLight: 0x8aa95a,
    dirt: 0xa58a58,
    dirtLight: 0xb79d6b,
    rock: 0x8a8474,
    rockDark: 0x6b6658,
    ridge: 0x968e7c,
    ridgeDark: 0x6f6859,
    mesa: 0x8a7b60,
    mesaCap: 0x7a954e,
    skirt: 0x594a32,
    background: 0x0d130d,
    fog: 0x0d130d,
  },
  autumn: {
    grass: 0x7a7a3c,
    grassDark: 0x5b5b2c,
    grassLight: 0x9a8a45,
    dirt: 0x8d5f38,
    dirtLight: 0xa7744a,
    rock: 0x7d715f,
    rockDark: 0x5c5245,
    ridge: 0x8a7965,
    ridgeDark: 0x645343,
    mesa: 0x80634b,
    mesaCap: 0x8a7a3d,
    skirt: 0x4d3423,
    background: 0x140f0b,
    fog: 0x140f0b,
  },
  ash: {
    grass: 0x5c5a45,
    grassDark: 0x403f33,
    grassLight: 0x777154,
    dirt: 0x5f5548,
    dirtLight: 0x75695a,
    rock: 0x66625a,
    rockDark: 0x494640,
    ridge: 0x6e6a62,
    ridgeDark: 0x4f4b45,
    mesa: 0x655b4e,
    mesaCap: 0x5f6248,
    skirt: 0x2d2a25,
    background: 0x0c0b0a,
    fog: 0x0c0b0a,
  },
  coast: {
    grass: 0x6a8a54,
    grassDark: 0x4f6b3e,
    grassLight: 0x8aa76b,
    dirt: 0xb6a177,
    dirtLight: 0xc9b58a,
    rock: 0x8d8778,
    rockDark: 0x6b665b,
    ridge: 0x9a9486,
    ridgeDark: 0x746e61,
    mesa: 0x8f8068,
    mesaCap: 0x7f9a5c,
    skirt: 0x65583f,
    background: 0x0b1112,
    fog: 0x0b1112,
  },
  snow: {
    grass: 0xd8dfd2,
    grassDark: 0xb3c0b4,
    grassLight: 0xf0f3ea,
    dirt: 0x9fa89d,
    dirtLight: 0xb8c0b5,
    rock: 0x7e8580,
    rockDark: 0x5f6662,
    ridge: 0x8d948f,
    ridgeDark: 0x6a716d,
    mesa: 0x7b807c,
    mesaCap: 0xd9e0d5,
    skirt: 0x454c4a,
    background: 0x0c1114,
    fog: 0x0c1114,
  },
};


export interface IslandMetrics {
  centerX: number;
  centerZ: number;
  radiusX: number;
  radiusZ: number;
  depth: number;
  topY: number;
  rim: Array<{ x: number; y: number; z: number; innerX: number; innerY: number; innerZ: number }>;
}

export interface TerrainBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** 一块地基在渲染层的投影，单位米。 */
export interface FoundationPlatform {
  id: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  elevation: number;
  depth: number;
  assetId?: string;
  shape?: FoundationShape;
  terrainStyle?: TerrainStyle;
  terrainSeed?: number;
  terrainAmplitude?: number;
  scatter?: boolean;
  material?: string;
  scale: number;
  rotation: number;
}

export interface TerrainPlatform {
  platform: FoundationPlatform;
  mesh: THREE.Mesh;
  shell: THREE.Group;
  metrics: IslandMetrics;
}

export interface Terrain {
  group: THREE.Group;
  /** 主平台顶面，兼容旧调用。 */
  mesh: THREE.Mesh;
  /** 所有平台顶面，拾取时需要全部参与。 */
  meshes: THREE.Mesh[];
  navOverlay: THREE.Group | null;
  heightAt(x: number, z: number): number;
  /** 该点是否落在任一块地基上。 */
  hasGround(x: number, z: number): boolean;
  /** 该点最高地基是否允许自动补景。 */
  hasScatterGround(x: number, z: number): boolean;
  setNavPreview(visible: boolean): void;
  bounds: TerrainBounds;
  island: IslandMetrics;
  islandGroup: THREE.Group;
  islandSignature: string;
  platforms: TerrainPlatform[];
  /** 主岛轮廓，用于边缘植被。 */
  primaryRim: IslandMetrics["rim"];
  primaryCenter: { x: number; z: number };
}

function isSteepCell(grid: NavGrid, x: number, z: number): boolean {
  const index = grid.index(x, z);
  const height = grid.heightCm(index);
  const limit = grid.rules.maxStepCm;
  const probes: ReadonlyArray<readonly [number, number]> = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  for (const probe of probes) {
    const nx = x + probe[0];
    const nz = z + probe[1];
    if (!grid.inBounds(nx, nz)) continue;
    if (Math.abs(grid.heightCm(grid.index(nx, nz)) - height) > limit) return true;
  }
  return false;
}

/** 相邻格高差达到陡壁阈值，说明这里爬不上去。 */
function isCliffEdge(grid: NavGrid, x: number, z: number): boolean {
  const here = grid.heightCm(grid.index(x, z));
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const nx = x + dx;
    const nz = z + dz;
    if (nx < 0 || nz < 0 || nx >= grid.width || nz >= grid.height) continue;
    if (Math.abs(grid.heightCm(grid.index(nx, nz)) - here) >= 120) return true;
  }
  return false;
}

function buildNavOverlay(grid: NavGrid, map: MapDef): THREE.Group {
  const cellM = grid.cellSizeCm / 100;
  const halfX = map.size[0] / 20;
  const halfZ = map.size[1] / 20;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const color = new THREE.Color();
  for (let z = 0; z < grid.height; z += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      const index = grid.index(x, z);
      const cx = (x + 0.5) * cellM - halfX;
      const cz = (z + 0.5) * cellM - halfZ;
      const y = grid.heightCm(index) / 100 + 0.05;
      const surface = grid.surface(index);
      const steep = isSteepCell(grid, x, z);
      if (
        surface === Surface.Grass &&
        grid.baseWalkable(index) &&
        !grid.isOverridden(index) &&
        !steep
      ) {
        continue;
      }
      if (isCliffEdge(grid, x, z)) color.setHex(0xb03a2e);
      else if (grid.isOverridden(index)) color.setHex(0x53c7bd);
      else if (!grid.baseWalkable(index)) color.setHex(0xb64a33);
      else if (surface === Surface.DeepWater) color.setHex(0x2d5d86);
      else if (surface === Surface.ShallowWater) color.setHex(0x4f8fa8);
      else if (surface === Surface.Road || surface === Surface.Bridge) color.setHex(0xc6a36a);
      else if (steep) color.setHex(0xd0a04a);
      else color.setHex(0x6fbf73);
      const base = positions.length / 3;
      positions.push(cx - cellM / 2, y, cz - cellM / 2);
      positions.push(cx + cellM / 2, y, cz - cellM / 2);
      positions.push(cx + cellM / 2, y, cz + cellM / 2);
      positions.push(cx - cellM / 2, y, cz + cellM / 2);
      for (let vertex = 0; vertex < 4; vertex += 1) colors.push(color.r, color.g, color.b);
      indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 2;
  const group = new THREE.Group();
  group.add(mesh);
  return group;
}

function navGridOf(map: MapDef): NavGrid | null {
  if (map.navigation !== "grid" || !map.grid) return null;
  const grid = map.grid;
  const cells = grid.width * grid.height;
  const climbCm = map.climbCm ?? 60;
  return new NavGrid({
    cellSizeCm: grid.cellSizeCm,
    width: grid.width,
    height: grid.height,
    heightCm: decodeInt16Base64(grid.heightCm, cells),
    surface: decodeUint8Base64(grid.surface, cells),
    blocked: decodeBitmapBase64(grid.blocked, cells),
    walkableOverride: decodeBitmapBase64(grid.walkableOverride, cells),
    rules: {
      maxStepCm: climbCm,
      maxSlopePermille: Math.max(1000, Math.round((climbCm / grid.cellSizeCm) * 1000)),
    },
  });
}

function surfaceColor(surface: number, palette: TerrainStylePalette): number {
  switch (surface) {
    case Surface.Road:
    case Surface.Bridge:
      return 0x8d8778;
    case Surface.Dirt:
    case Surface.Sand:
      return palette.dirt;
    case Surface.Rock:
      return palette.rock;
    case Surface.ShallowWater:
      return 0x3f6f7a;
    case Surface.DeepWater:
      return 0x2a4e5c;
    case Surface.Snow:
      return 0xe2e8e0;
    case Surface.Stairs:
      return 0x9a8f7a;
    default:
      return palette.grass;
  }
}

function hashText(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function platformDepth(halfX: number, halfZ: number): number {
  return THREE.MathUtils.clamp(Math.hypot(halfX, halfZ) * 0.24, 14, 38);
}

/** 把文档里的地基换算成渲染用的米制平台。 */
function resolvePlatforms(map: MapDef, visual: MapVisual | null): FoundationPlatform[] {
  if (map.navigation === "grid") {
    const halfX = map.size[0] / 20;
    const halfZ = map.size[1] / 20;
    const source = visual?.foundations?.[0];
    return [
      {
        id: source?.id ?? "grid",
        minX: -halfX,
        maxX: halfX,
        minZ: -halfZ,
        maxZ: halfZ,
        elevation: 0,
        depth: source ? foundationDepth(source) : platformDepth(halfX, halfZ),
        ...(source?.material ? { material: source.material } : {}),
        ...(source?.shape ? { shape: source.shape } : {}),
        ...(source?.terrainStyle ? { terrainStyle: source.terrainStyle } : {}),
        ...(source?.terrainSeed !== undefined ? { terrainSeed: source.terrainSeed } : {}),
        ...(source?.terrainAmplitude !== undefined ? { terrainAmplitude: source.terrainAmplitude } : {}),
        ...(source?.scatter !== undefined ? { scatter: source.scatter } : {}),
        scale: 1,
        rotation: 0,
      },
    ];
  }
  const list = visual?.foundations ?? [];
  if (list.length > 0) {
    return list.map((foundation) => {
      const rect = foundationRect(foundation);
      return {
        id: foundation.id,
        minX: rect.minX / 10,
        maxX: rect.maxX / 10,
        minZ: rect.minZ / 10,
        maxZ: rect.maxZ / 10,
        elevation: foundation.elevation,
        depth: foundationDepth(foundation),
        ...(foundation.assetId ? { assetId: foundation.assetId } : {}),
        ...(foundation.shape ? { shape: foundation.shape } : {}),
        ...(foundation.terrainStyle ? { terrainStyle: foundation.terrainStyle } : {}),
        ...(foundation.terrainSeed !== undefined ? { terrainSeed: foundation.terrainSeed } : {}),
        ...(foundation.terrainAmplitude !== undefined ? { terrainAmplitude: foundation.terrainAmplitude } : {}),
        ...(foundation.scatter !== undefined ? { scatter: foundation.scatter } : {}),
        ...(foundation.material ? { material: foundation.material } : {}),
        scale: foundation.scale,
        rotation: foundation.rotation,
      };
    });
  }
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const city of map.cities) {
    minX = Math.min(minX, city.pos[0] / 10);
    maxX = Math.max(maxX, city.pos[0] / 10);
    minZ = Math.min(minZ, city.pos[1] / 10);
    maxZ = Math.max(maxZ, city.pos[1] / 10);
  }
  if (!Number.isFinite(minX)) {
    minX = -map.size[0] / 20;
    maxX = map.size[0] / 20;
    minZ = -map.size[1] / 20;
    maxZ = map.size[1] / 20;
  }
  minX -= 14;
  maxX += 14;
  minZ -= 14;
  maxZ += 14;
  return [
    {
      id: "legacy",
      minX,
      maxX,
      minZ,
      maxZ,
      elevation: 0,
      depth: platformDepth((maxX - minX) / 2, (maxZ - minZ) / 2),
      scale: 1,
      rotation: 0,
    },
  ];
}

function buildPlatformSurface(
  platform: FoundationPlatform,
  heightAt: (x: number, z: number) => number,
  palette: TerrainStylePalette,
  navGrid: NavGrid | null,
  map: MapDef,
  ground: THREE.Material | null,
  seed: number,
  noiseShift: number,
): THREE.Mesh {
  const width = Math.max(0.5, platform.maxX - platform.minX);
  const depth = Math.max(0.5, platform.maxZ - platform.minZ);
  const cell = navGrid ? 0.5 : 0.9;
  const segmentsX = Math.max(6, Math.round(width / cell));
  const segmentsZ = Math.max(6, Math.round(depth / cell));
  const geometry = new THREE.PlaneGeometry(width, depth, segmentsX, segmentsZ);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate((platform.minX + platform.maxX) / 2, 0, (platform.minZ + platform.maxZ) / 2);
  const tile = 9;
  if (ground) {
    const uv = geometry.getAttribute("uv") as THREE.BufferAttribute;
    for (let index = 0; index < uv.count; index += 1) {
      uv.setXY(index, uv.getX(index) * (width / tile), uv.getY(index) * (depth / tile));
    }
    uv.needsUpdate = true;
  }
  const offsetX = map.size[0] * 5;
  const offsetZ = map.size[1] * 5;
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  for (let index = 0; index < position.count; index += 1) {
    position.setY(index, heightAt(position.getX(index), position.getZ(index)));
  }
  geometry.computeVertexNormals();
  const normal = geometry.getAttribute("normal") as THREE.BufferAttribute;
  const colors: number[] = [];
  const color = new THREE.Color();
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const y = position.getY(index);
    const z = position.getZ(index);
    const slope = 1 - Math.abs(normal.getY(index));
    const dirt = valueNoise(x / 9 + noiseShift, z / 9, 103) > 0.76;
    if (navGrid) {
      color.setHex(surfaceColor(navGrid.surfaceAtXZ(Math.round(x * 100 + offsetX), Math.round(z * 100 + offsetZ)), palette));
    } else if (slope > 0.24 || y > 1.05 + platform.elevation) {
      color.setHex(dirt ? palette.dirtLight : palette.rock);
    } else if (y > 0.45 + platform.elevation) {
      color.setHex(dirt ? palette.dirt : palette.grassLight);
    } else if (dirt) {
      color.setHex(palette.dirt);
    } else {
      color.setHex(palette.grass);
    }
    color.offsetHSL(0, 0, (valueNoise(x / 3.5, z / 3.5, 7) - 0.5) * (navGrid ? 0.04 : 0.13) - slope * 0.2);
    colors.push(color.r, color.g, color.b);
  }
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  const material = ground ?? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
  if (ground) geometry.deleteAttribute("color");
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.name = `ground-${platform.id}`;
  // 同高度地基重叠时给一点毫米级抬升，避免顶面 z-fighting。
  mesh.position.y = ((hashText(platform.id) % 7) - 3) * 0.0006;
  return mesh;
}

export function buildTerrain(
  map: MapDef,
  positions: Map<CityId, THREE.Vector3>,
  options: {
    style?: string;
    seed?: number;
    amplitude?: number;
    material?: string;
    previous?: Terrain;
    visual?: MapVisual | null;
  } = {},
): Terrain {
  const style = options.style ?? "frontier";
  const palette = TERRAIN_PALETTES[style] ?? TERRAIN_PALETTES.frontier;
  // 地图自带的地形参数优先，保证画面和网格高度是同一份。
  const seed = Math.round(map.terrain?.seed ?? options.seed ?? 20261123);
  const amplitude = Math.min(12, Math.max(0.2, map.terrain?.amplitude ?? options.amplitude ?? 1));
  const noiseShift = (seed % 1000) * 0.017;
  const cities = [...positions.values()];
  const edges = map.edges
    .map((edge) => {
      const from = positions.get(edge.from);
      const to = positions.get(edge.to);
      return from && to ? { from, to } : null;
    })
    .filter((edge): edge is { from: THREE.Vector3; to: THREE.Vector3 } => edge !== null);

  const navGrid = navGridOf(map);
  const platforms = resolvePlatforms(map, options.visual ?? null);
  // 网格地图把格高整理成带竖直陡壁的显示面：缓坡共享格角顶点，陡壁另补墙。
  const gridPlatform = navGrid ? platforms[0] ?? null : null;
  const gridSurface =
    navGrid && gridPlatform
      ? buildGridSurface(
          {
            width: navGrid.width,
            height: navGrid.height,
            cellSizeCm: navGrid.cellSizeCm,
            heightCmAt: (x, z) => navGrid.heightCm(z * navGrid.width + x),
          },
          { originX: gridPlatform.minX, originZ: gridPlatform.minZ },
        )
      : null;
  const heightField = createHeightField({
    cities: [...positions.values()].map((city) => [city.x, city.z] as [number, number]),
    terrain: { seed, amplitude },
  });
  const offsetX = map.size[0] * 5;
  const offsetZ = map.size[1] * 5;
  const baseHeightAt = (x: number, z: number): number => {
    if (navGrid) {
      return navGrid.heightCmAtXZ(Math.round(x * 100 + offsetX), Math.round(z * 100 + offsetZ)) / 100;
    }
    return heightField.heightAt(x, z);
  };
  const platformFields = new Map<string, ReturnType<typeof createHeightField>>();
  const fieldFor = (platform: FoundationPlatform): ReturnType<typeof createHeightField> => {
    const platformSeed = platform.terrainSeed ?? seed;
    const platformAmplitude = platform.terrainAmplitude ?? amplitude;
    const key = String(platformSeed) + "|" + String(platformAmplitude);
    let field = platformFields.get(key);
    if (!field) {
      field = createHeightField({
        cities: [...positions.values()].map((city) => [city.x, city.z] as [number, number]),
        terrain: { seed: platformSeed, amplitude: platformAmplitude },
      });
      platformFields.set(key, field);
    }
    return field;
  };
  const inside = (platform: FoundationPlatform, x: number, z: number): boolean =>
    x >= platform.minX && x <= platform.maxX && z >= platform.minZ && z <= platform.maxZ;
  const platformHeightAt = (platform: FoundationPlatform, x: number, z: number): number =>
    platform.elevation +
    (gridSurface && platform === gridPlatform
      ? gridSurface.heightAt(x, z)
      : navGrid
        ? navGrid.heightCmAtXZ(Math.round(x * 100 + offsetX), Math.round(z * 100 + offsetZ)) / 100
        : fieldFor(platform).heightAt(x, z));

  const heightAt = (x: number, z: number): number => {
    let best: number | null = null;
    for (const platform of platforms) {
      if (!inside(platform, x, z)) continue;
      const y = platformHeightAt(platform, x, z);
      if (best === null || y > best) best = y;
    }
    return best ?? baseHeightAt(x, z);
  };
  const hasGround = (x: number, z: number): boolean => platforms.some((platform) => inside(platform, x, z));
  const hasScatterGround = (x: number, z: number): boolean => {
    let top: FoundationPlatform | null = null;
    for (const platform of platforms) {
      if (!inside(platform, x, z)) continue;
      if (!top || platform.elevation > top.elevation) top = platform;
    }
    return top !== null && top.scatter !== false;
  };

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const platform of platforms) {
    minX = Math.min(minX, platform.minX);
    maxX = Math.max(maxX, platform.maxX);
    minZ = Math.min(minZ, platform.minZ);
    maxZ = Math.max(maxZ, platform.maxZ);
  }
  const bounds = { minX, maxX, minZ, maxZ };

  const signature =
    platforms
      .map((platform) =>
        [
          platform.id,
          Math.round(platform.minX * 100),
          Math.round(platform.maxX * 100),
          Math.round(platform.minZ * 100),
          Math.round(platform.maxZ * 100),
          Math.round(platform.elevation * 100),
          Math.round(platform.depth * 100),
          platform.shape ?? "",
          platform.terrainStyle ?? "",
          platform.terrainSeed ?? 0,
          platform.terrainAmplitude ?? 1,
          platform.material ?? "",
          platform.scatter === false ? "bare" : "decorated",
        ].join(":"),
      )
      .join("|") + "|" + boundarySignature(bounds, heightAt);
  const reused = options.previous && options.previous.islandSignature === signature ? options.previous : null;

  const defaultGround = groundMaterial(options.material);
  const group = new THREE.Group();
  const islandGroup = reused ? reused.islandGroup : new THREE.Group();
  islandGroup.name = "islands";
  if (reused) {
    reused.group.remove(reused.islandGroup);
    group.add(reused.islandGroup);
  } else {
    group.add(islandGroup);
  }
  const meshes: THREE.Mesh[] = [];
  const builtPlatforms: TerrainPlatform[] = [];
  // 网格地图整张地表画成一张贴图，路面直接画在上面。
  // 这张图只有二三十像素一米，近景交给细节层：法线 + 三平面投影。
  const paintedTexture = navGrid
    ? paintGroundTexture({
        navGrid,
        size: map.size,
        palette,
        yards: map.cities.map((city) => ({
          x: city.pos[0] / 10,
          z: city.pos[1] / 10,
          radius: city.kind === "granary" || city.kind === "outpost" ? 2 : 2.9,
        })),
      })
    : null;
  const paintedGround = paintedTexture ? createTerrainGroundMaterial(paintedTexture, style) : null;
  if (paintedGround && paintedTexture) {
    paintedGround.userData.ownedTextures = [paintedTexture];
  }
  const gridMeshes =
    gridSurface && gridPlatform && paintedGround
      ? buildGridTerrainMeshes(gridSurface, {
          topMaterial: paintedGround,
          cliffMaterial: createTerrainCliffMaterial(
            gridPlatform.terrainStyle ?? style,
            (TERRAIN_PALETTES[gridPlatform.terrainStyle ?? style] ?? palette).ridge,
          ),
          uvOriginX: gridPlatform.minX,
          uvOriginZ: gridPlatform.minZ,
          uvSizeX: gridPlatform.maxX - gridPlatform.minX,
          uvSizeZ: gridPlatform.maxZ - gridPlatform.minZ,
        })
      : null;

  for (let index = 0; index < platforms.length; index += 1) {
    const platform = platforms[index];
    const ground = paintedGround ?? (platform.material ? groundMaterial(platform.material) : defaultGround);
    const platformPalette = TERRAIN_PALETTES[platform.terrainStyle ?? style] ?? palette;
    const platformHeight = (x: number, z: number): number => platformHeightAt(platform, x, z);
    const platformSeed = platform.terrainSeed ?? seed;
    const useGrid = gridMeshes !== null && platform === gridPlatform;
    const mesh = useGrid
      ? gridMeshes.top
      : buildPlatformSurface(platform, platformHeight, platformPalette, navGrid, map, ground, platformSeed, noiseShift);
    group.add(mesh);
    meshes.push(mesh);
    if (reused) {
      const entry = reused.platforms[index];
      builtPlatforms.push({ platform, mesh, shell: entry.shell, metrics: entry.metrics });
      continue;
    }
    const built = buildIsland(
      platform.minX,
      platform.maxX,
      platform.minZ,
      platform.maxZ,
      platformHeight,
      platformPalette,
      platformSeed + (hashText(platform.id) % 997),
      ground,
      platform.depth,
      platform.shape ?? "plateau",
      false,
    );
    built.group.name = `island-${platform.id}`;
    islandGroup.add(built.group);
    builtPlatforms.push({ platform, mesh, shell: built.group, metrics: built.metrics });
  }
  // 陡壁墙面单独一张网格：顶面在崖口直接断开，墙把两截接起来。
  if (gridMeshes?.cliffs) {
    group.add(gridMeshes.cliffs);
    meshes.push(gridMeshes.cliffs);
  }
  if (!reused) {
    islandGroup.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.receiveShadow = true;
      mesh.castShadow = false;
    });
  }

  const primaryIndex = platforms.reduce(
    (best, platform, index) =>
      (platform.maxX - platform.minX) * (platform.maxZ - platform.minZ) >
      (platforms[best].maxX - platforms[best].minX) * (platforms[best].maxZ - platforms[best].minZ)
        ? index
        : best,
    0,
  );
  const primaryMetrics = builtPlatforms[primaryIndex].metrics;
  const centerX = (minX + maxX) / 2;
  const centerZ = (minZ + maxZ) / 2;
  // 与旧版一致：用所有浮岛外沿点到并集中心的距离，保证单平台时镜头完全不变。
  let radiusX = 0;
  let radiusZ = 0;
  for (const entry of builtPlatforms) {
    for (const point of entry.metrics.rim) {
      radiusX = Math.max(radiusX, Math.abs(point.x - centerX));
      radiusZ = Math.max(radiusZ, Math.abs(point.z - centerZ));
    }
  }
  const island: IslandMetrics = {
    centerX,
    centerZ,
    radiusX: Math.max(1, radiusX),
    radiusZ: Math.max(1, radiusZ),
    depth: Math.max(...platforms.map((platform) => platform.depth)),
    topY: Math.max(...builtPlatforms.map((entry) => entry.metrics.topY)),
    rim: primaryMetrics.rim,
  };

  const navOverlay = navGrid ? buildNavOverlay(navGrid, map) : null;
  // 通行预览是编辑器的调试层，对局里默认关掉，不然会把整条路网当色块盖在地面上。
  if (navOverlay) {
    navOverlay.visible = false;
    group.add(navOverlay);
  }
  const setNavPreview = (visible: boolean): void => {
    if (navOverlay) navOverlay.visible = visible;
  };

  const result: Terrain = {
    group,
    mesh: meshes[0],
    meshes,
    navOverlay,
    heightAt,
    hasGround,
    hasScatterGround,
    setNavPreview,
    bounds,
    island,
    islandGroup,
    islandSignature: signature,
    platforms: builtPlatforms,
    primaryRim: primaryMetrics.rim,
    primaryCenter: { x: primaryMetrics.centerX, z: primaryMetrics.centerZ },
  };

  if (navGrid) return result;

  const random = seeded(20261123);
  const townPositions = map.cities
    .map((city) => positions.get(city.id))
    .filter((city): city is THREE.Vector3 => city !== undefined);
  let cityMinX = Number.POSITIVE_INFINITY;
  let cityMaxX = Number.NEGATIVE_INFINITY;
  let cityMinZ = Number.POSITIVE_INFINITY;
  let cityMaxZ = Number.NEGATIVE_INFINITY;
  for (const city of townPositions) {
    cityMinX = Math.min(cityMinX, city.x);
    cityMaxX = Math.max(cityMaxX, city.x);
    cityMinZ = Math.min(cityMinZ, city.z);
    cityMaxZ = Math.max(cityMaxZ, city.z);
  }
  const candidates: Array<{ x: number; z: number }> = [];
  for (let x = cityMinX + 6; x <= cityMaxX - 2; x += 12) {
    for (let z = cityMinZ + 6.5; z <= cityMaxZ - 2; z += 13) {
      if (!hasGround(x, z)) continue;
      if (isClear(x, z, cities, edges, 5.2)) candidates.push({ x, z });
    }
  }
  for (let index = candidates.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [candidates[index], candidates[swap]] = [candidates[swap], candidates[index]];
  }
  // 地形里的程序化岩脊/台地无法单独选中，改为不生成；岩石由补景写入显式 props。

  return result;
}

function isClear(
  x: number,
  z: number,
  cities: THREE.Vector3[],
  edges: Array<{ from: THREE.Vector3; to: THREE.Vector3 }>,
  radius: number,
): boolean {
  const nearCity = cities.some((city) => Math.hypot(x - city.x, z - city.z) < radius + 2.4);
  if (nearCity) return false;
  return edges.every((edge) => segmentDistance(x, z, edge.from.x, edge.from.z, edge.to.x, edge.to.z) > radius * 0.72);
}

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

interface IslandRimPoint {
  theta: number;
  radius: number;
  x: number;
  z: number;
  y: number;
  innerX: number;
  innerZ: number;
  innerY: number;
  depth: number;
}

function rectangleSupport(theta: number, halfX: number, halfZ: number): number {
  const cos = Math.abs(Math.cos(theta));
  const sin = Math.abs(Math.sin(theta));
  return 1 / Math.max(cos / halfX, sin / halfZ);
}

function islandRim(
  centerX: number,
  centerZ: number,
  halfX: number,
  halfZ: number,
  depth: number,
  seed: number,
  heightAt: (x: number, z: number) => number,
  shape: FoundationShape = "plateau",
): IslandRimPoint[] {
  const steps = 288;
  const shift = (seed % 977) * 0.013;
  const diagonal = Math.hypot(halfX, halfZ);
  const points: IslandRimPoint[] = [];

  for (let index = 0; index < steps; index += 1) {
    const theta = (index / steps) * Math.PI * 2;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const support = rectangleSupport(theta, halfX, halfZ);
    const broad = valueNoise(cos * 2.7 + shift, sin * 2.7 - shift, seed + 41);
    const fine = valueNoise(cos * 6.5 - shift, sin * 6.5 + shift, seed + 97);
    let base = diagonal + 12;
    let radiusScale = 0.94 + broad * 0.1 + fine * 0.05;
    let bermBase = 0.16;
    let bermNoise = 0.58;
    let depthScale = 0.82 + valueNoise(cos * 1.6 + shift, sin * 1.6, seed + 307) * 0.34;
    if (shape === "plateau") {
      // 台地地基铺满整张图：侧壁顶端必须和地形边缘完全重合，
      // 否则两者之间会露出一道缝，从固定的预览机位看就是一条白边。
      base = support;
      radiusScale = 1;
      bermBase = 0.02;
      bermNoise = 0.04;
      depthScale = 1;
    } else if (shape === "mesa") {
      base = support + 4 + broad * 2.2;
      radiusScale = 0.99 + fine * 0.02;
      bermBase = 0.02;
      bermNoise = 0.1;
      depthScale = 1.06 + broad * 0.22;
    } else if (shape === "spire") {
      base = support + 7 + broad * 2;
      radiusScale = 0.97 + fine * 0.04;
      bermBase = 0.08;
      bermNoise = 0.2;
      depthScale = 1.2 + broad * 0.45;
    } else if (shape === "terrace") {
      base = support + 8 + broad * 3;
      radiusScale = 0.98 + fine * 0.035;
      bermBase = 0.1;
      bermNoise = 0.22;
      depthScale = 0.95 + broad * 0.25;
    } else if (shape === "root") {
      const lobes = Math.sin(theta * 3 + shift * 3) * 0.08 + Math.sin(theta * 5 - shift * 2) * 0.05;
      base = diagonal + 7;
      radiusScale = 0.95 + broad * 0.12 + fine * 0.05 + lobes;
      bermBase = 0.12;
      bermNoise = 0.4;
      depthScale = 0.95 + broad * 0.5;
    } else if (shape === "round") {
      base = diagonal * 0.98 + 6;
      radiusScale = 0.98 + broad * 0.035 + fine * 0.02;
      bermBase = 0.1;
      bermNoise = 0.28;
      depthScale = 0.92 + broad * 0.24;
    }
    const radius = base * radiusScale;
    const innerX = centerX + cos * support * 0.995;
    const innerZ = centerZ + sin * support * 0.995;
    const baseY = heightAt(innerX, innerZ);
    const berm = bermBase + valueNoise(cos * 4.1 + shift, sin * 4.1, seed + 211) * bermNoise;
    const localDepth = depth * depthScale;
    points.push({
      theta,
      radius,
      x: centerX + cos * radius,
      z: centerZ + sin * radius,
      y: baseY + berm,
      innerX,
      innerZ,
      innerY: baseY,
      depth: localDepth,
    });
  }
  return points;
}

function pushQuad(
  positions: number[],
  colors: number[],
  color: THREE.Color,
  a: [number, number, number],
  b: [number, number, number],
  c: [number, number, number],
  d: [number, number, number],
): void {
  positions.push(...a, ...b, ...c, ...a, ...c, ...d);
  for (let index = 0; index < 6; index += 1) colors.push(color.r, color.g, color.b);
}

function buildIslandApron(
  rim: IslandRimPoint[],
  palette: TerrainStylePalette,
  seed: number,
  ground: THREE.Material | null,
  shape: FoundationShape = "plateau",
): THREE.Mesh {
  const positions: number[] = [];
  const colors: number[] = [];
  const color = new THREE.Color();
  const grass = new THREE.Color(palette.grassLight);
  const dirt = new THREE.Color(palette.dirt);
  const rock = new THREE.Color(palette.rock);
  const tSteps = [0, 0.1, 0.22, 0.34, 0.46, 0.58, 0.7, 0.82, 0.92, 1];
  const crestAt = (theta: number, t: number): number => {
    const ridgeBase = shape === "mesa" ? 1.2 : shape === "terrace" ? 2.2 : shape === "spire" ? 3.2 : 4.5;
    const ridgeNoise = shape === "mesa" ? 1.6 : shape === "terrace" ? 3.4 : shape === "spire" ? 4.5 : 7.5;
    const ridge = ridgeBase + valueNoise(Math.cos(theta) * 2.6 + 4, Math.sin(theta) * 2.6 - 1, seed + 5) * ridgeNoise;
    const wobble = valueNoise(theta * 3.1 + 7, t * 4.6, seed + 9) * 0.6 + 0.4;
    return Math.sin(Math.min(1, t) * Math.PI) * ridge * wobble;
  };
  for (let index = 0; index < rim.length; index += 1) {
    const current = rim[index];
    const next = rim[(index + 1) % rim.length];
    for (let step = 0; step < tSteps.length - 1; step += 1) {
      const t0 = tSteps[step];
      const t1 = tSteps[step + 1];
      const point = (source: IslandRimPoint, t: number): [number, number, number] => [
        source.innerX + (source.x - source.innerX) * t,
        source.innerY + (source.y - source.innerY) * t + crestAt(source.theta, t),
        source.innerZ + (source.z - source.innerZ) * t,
      ];
      const a = point(current, t0);
      const b = point(next, t0);
      const c = point(next, t1);
      const d = point(current, t1);
      const shade = valueNoise(current.theta * 3.4 + seed * 0.001, t1 * 4.2, seed + 31) * 0.16 - 0.08;
      if (t1 < 0.62) color.copy(grass).lerp(dirt, t1 * 0.8).offsetHSL(0, 0, shade);
      else color.copy(dirt).lerp(rock, (t1 - 0.62) * 2.2).offsetHSL(0, 0, shade - 0.06);
      pushQuad(positions, colors, color, a, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  if (ground) {
    const uvs: number[] = [];
    for (let index = 0; index < positions.length; index += 3) {
      uvs.push(positions[index] / 9, positions[index + 2] / 9);
    }
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  } else {
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  }
  geometry.computeVertexNormals();
  return new THREE.Mesh(
    geometry,
    // 平滑着色：平面着色会让岛体的放射状分段显成一道道竖条。
    ground ?? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }),
  );
}

function buildIslandBase(
  rim: IslandRimPoint[],
  centerX: number,
  centerZ: number,
  palette: TerrainStylePalette,
  seed: number,
  ground: THREE.Material | null,
  shape: FoundationShape = "plateau",
  decorated = true,
): THREE.Group {
  const group = new THREE.Group();
  const layers = shape === "mesa" ? 32 : shape === "terrace" ? 44 : shape === "spire" ? 64 : 56;
  const rings: Array<Array<{ x: number; y: number; z: number; theta: number }>> = [];
  for (let layer = 0; layer <= layers; layer += 1) {
    const t = layer / layers;
    const ledgeAmount = shape === "mesa" ? 0.45 : shape === "terrace" ? 3.2 : shape === "root" ? 2.8 : 2.1;
    const ledge = (valueNoise(t * 9.3, 0.5, seed + 3) - 0.5) * ledgeAmount;
    let shrink: number;
    if (shape === "mesa") shrink = 0.18 * Math.pow(t, 0.55);
    else if (shape === "spire") shrink = 0.8 * Math.pow(t, 0.85);
    else if (shape === "terrace") {
      const step = Math.floor(t * 4) / 4 + Math.min(1, (t * 4) % 1) * 0.18;
      shrink = 0.58 * Math.pow(step, 0.8);
    } else if (shape === "root") shrink = 0.66 * Math.pow(t, 1.05);
    else if (shape === "round") shrink = 0.48 * Math.pow(t, 1.2);
    else shrink = 0.52 * Math.pow(t, 1.35);
    const ring: Array<{ x: number; y: number; z: number; theta: number }> = [];
    for (const point of rim) {
      const theta = point.theta;
      const ridge =
        1 +
        Math.sin(theta * 5.3 + 0.7) * Math.sin(Math.PI * t) * 0.08 +
        Math.sin(theta * 11.7 + 2.1) * Math.sin(Math.PI * Math.min(1, t * 1.15)) * 0.045 +
        (valueNoise(Math.cos(theta) * 3.1 + 5, Math.sin(theta) * 3.1 - 2, seed + 17) - 0.5) * 0.1 +
        (valueNoise(Math.cos(theta) * 10.5 - 3, Math.sin(theta) * 10.5 + 7, seed + 51) - 0.5) * 0.035;
      const lobe = shape === "root" ? Math.sin(theta * 3 + seed * 0.001) * t * 0.14 : 0;
      const radius = Math.max(2, point.radius * (1 - shrink * ridge + lobe) + ledge);
      const fallPower = shape === "mesa" ? 0.55 : shape === "terrace" ? 1 : shape === "spire" ? 0.8 : 0.85;
      const fall = Math.pow(Math.sin(Math.min(1, t) * Math.PI * 0.5), fallPower) * (0.98 + Math.sin(theta * 3.1) * 0.04);
      ring.push({
        x: centerX + Math.cos(theta) * radius,
        y: point.y - point.depth * fall,
        z: centerZ + Math.sin(theta) * radius,
        theta,
      });
    }
    rings.push(ring);
  }

  const cols = rim.length;
  const positions: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const color = new THREE.Color();
  const rock = new THREE.Color(palette.rock);
  const mesa = new THREE.Color(palette.mesa);
  const dark = new THREE.Color(palette.rockDark);
  const soil = new THREE.Color(palette.skirt);
  const bottomRing = rings[layers];
  for (let layer = 0; layer <= layers; layer += 1) {
    const ring = rings[layer];
    const t = layer / layers;
    const nextLayer = rings[Math.min(layers, layer + 1)];
    for (let index = 0; index < cols; index += 1) {
      const point = ring[index];
      positions.push(point.x, point.y, point.z);
      uvs.push((point.theta / (Math.PI * 2)) * 12, point.y / 12);
      const drop = point.y - nextLayer[index].y;
      const strata = valueNoise(2.3, drop * 0.34 + t * 2.4, seed + 8);
      const crevice = valueNoise(
        Math.cos(point.theta) * 9.5 + 9,
        Math.sin(point.theta) * 9.5 + t * 3.1,
        seed + 61,
      );
      const rib = valueNoise(Math.cos(point.theta) * 17 + 2, Math.sin(point.theta) * 17 - 5, seed + 83);
      const band = 0.5 + 0.5 * Math.sin(point.y * 0.62 + strata * 2.4 + seed * 0.001);
      color.copy(rock).lerp(mesa, strata * 0.68 + band * 0.22);
      if (band > 0.78) color.offsetHSL(0, -0.03, 0.09);
      if (crevice < 0.44) color.lerp(dark, 0.55 + (0.44 - crevice) * 1.4);
      if (rib < 0.34) color.multiplyScalar(0.8);
      if (layer === 0) color.lerp(soil, 0.6);
      color.multiplyScalar(0.6 + (1 - t) * 0.58);
      colors.push(color.r, color.g, color.b);
    }
  }
  for (let layer = 0; layer < layers; layer += 1) {
    for (let index = 0; index < cols; index += 1) {
      const next = (index + 1) % cols;
      const a = layer * cols + index;
      const b = layer * cols + next;
      const c = (layer + 1) * cols + next;
      const d = (layer + 1) * cols + index;
      indices.push(a, b, c, a, c, d);
    }
  }

  const tipExtra = shape === "spire" ? 0.34 : shape === "root" ? 0.22 : shape === "mesa" ? 0.05 : 0.16;
  const tipY = Math.min(...bottomRing.map((point) => point.y)) + Math.max(...rim.map((point) => point.depth)) * tipExtra;
  const tipIndex = positions.length / 3;
  positions.push(centerX, tipY, centerZ);
  color.copy(dark).multiplyScalar(0.44);
  colors.push(color.r, color.g, color.b);
  const bottomStart = layers * cols;
  for (let index = 0; index < cols; index += 1) {
    indices.push(bottomStart + index, bottomStart + ((index + 1) % cols), tipIndex);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  if (ground) {
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  } else {
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  }
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(
    geometry,
    ground ?? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide }),
  );
  mesh.name = "island-base";
  group.add(mesh);

  if (!decorated) return group;
  const random = seeded(seed + 733);
  const rockMaterial = new THREE.MeshStandardMaterial({
    color: palette.ridge,
    roughness: 1,
    flatShading: true,
  });
  const rockMaterialDark = new THREE.MeshStandardMaterial({
    color: palette.ridgeDark,
    roughness: 1,
    flatShading: true,
  });
  for (let index = 0; index < 16; index += 1) {
    const point = rim[Math.floor(random() * rim.length)];
    const size = 1.2 + random() * 2.6;
    const height = size * (0.8 + random() * 1.2);
    const geometryRock = new THREE.CylinderGeometry(size * 0.32, size * 0.62, height, 6, 1);
    const position = geometryRock.getAttribute("position") as THREE.BufferAttribute;
    for (let vertex = 0; vertex < position.count; vertex += 1) {
      const factor = 0.74 + random() * 0.5;
      position.setX(vertex, position.getX(vertex) * factor);
      position.setZ(vertex, position.getZ(vertex) * factor);
    }
    geometryRock.computeVertexNormals();
    const rock = new THREE.Mesh(geometryRock, random() > 0.5 ? rockMaterial : rockMaterialDark);
    const inset = 0.8 + random() * 0.14;
    rock.position.set(
      centerX + (point.x - centerX) * inset,
      point.y - height * (0.2 + random() * 0.2),
      centerZ + (point.z - centerZ) * inset,
    );
    rock.rotation.y = random() * Math.PI;
    group.add(rock);
  }
  return group;
}

function boundarySignature(bounds: TerrainBounds, heightAt: (x: number, z: number) => number): string {
  const parts: number[] = [];
  const steps = 16;
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;
    const x = bounds.minX + (bounds.maxX - bounds.minX) * t;
    const z = bounds.minZ + (bounds.maxZ - bounds.minZ) * t;
    parts.push(
      Math.round(heightAt(x, bounds.minZ) * 100),
      Math.round(heightAt(x, bounds.maxZ) * 100),
      Math.round(heightAt(bounds.minX, z) * 100),
      Math.round(heightAt(bounds.maxX, z) * 100),
    );
  }
  return parts.join(",");
}

function buildIsland(
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  heightAt: (x: number, z: number) => number,
  palette: TerrainStylePalette,
  seed: number,
  ground: THREE.Material | null,
  depthOverride?: number,
  shape: FoundationShape = "plateau",
  decorated = true,
): { group: THREE.Group; metrics: IslandMetrics } {
  const centerX = (minX + maxX) / 2;
  const centerZ = (minZ + maxZ) / 2;
  const halfX = Math.max(1, (maxX - minX) / 2);
  const halfZ = Math.max(1, (maxZ - minZ) / 2);
  const depth = depthOverride ?? THREE.MathUtils.clamp(Math.hypot(halfX, halfZ) * 0.24, 14, 38);
  const rim = islandRim(centerX, centerZ, halfX, halfZ, depth, seed, heightAt, shape);
  const group = new THREE.Group();
  group.name = "island";
  // 台地地基铺满整图，顶面收边会在地图边上留下一条亮带和竖条纹，直接不生成。
  if (shape !== "plateau") group.add(buildIslandApron(rim, palette, seed, ground, shape));
  group.add(buildIslandBase(rim, centerX, centerZ, palette, seed, ground, shape, decorated));
  let radiusX = 0;
  let radiusZ = 0;
  let topY = 0;
  for (const point of rim) {
    radiusX = Math.max(radiusX, Math.abs(point.x - centerX));
    radiusZ = Math.max(radiusZ, Math.abs(point.z - centerZ));
    topY = Math.max(topY, point.y);
  }
  return {
    group,
    metrics: {
      centerX,
      centerZ,
      radiusX,
      radiusZ,
      depth,
      topY,
      rim: rim.map((point) => ({
        x: point.x,
        y: point.y,
        z: point.z,
        innerX: point.innerX,
        innerY: point.innerY,
        innerZ: point.innerZ,
      })),
    },
  };
}
