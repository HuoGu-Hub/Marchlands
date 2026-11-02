import * as THREE from "three";
import type { CityId, MapDef } from "@marchlands/sim";
import { createHeightField } from "@marchlands/map-authoring";
import {
  NavGrid,
  Surface,
  decodeBitmapBase64,
  decodeInt16Base64,
  decodeUint8Base64,
} from "@marchlands/nav";

const CITY_PAD = 4.2;
const CITY_FADE = 7.4;
const ROAD_PAD = 1.9;
const ROAD_FADE = 3.2;

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

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
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

export function terrainAtmosphere(style: string | undefined): { background: number; fog: number } {
  const palette = TERRAIN_PALETTES[style ?? "frontier"] ?? TERRAIN_PALETTES.frontier;
  return { background: palette.background, fog: palette.fog };
}

export interface IslandMetrics {
  centerX: number;
  centerZ: number;
  radiusX: number;
  radiusZ: number;
  depth: number;
  topY: number;
}

export interface TerrainBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface Terrain {
  group: THREE.Group;
  mesh: THREE.Mesh;
  navOverlay: THREE.Group | null;
  heightAt(x: number, z: number): number;
  setNavPreview(visible: boolean): void;
  bounds: TerrainBounds;
  island: IslandMetrics;
  islandGroup: THREE.Group;
  islandSignature: string;
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
      if (grid.isOverridden(index)) color.setHex(0x53c7bd);
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
  return new NavGrid({
    cellSizeCm: grid.cellSizeCm,
    width: grid.width,
    height: grid.height,
    heightCm: decodeInt16Base64(grid.heightCm, cells),
    surface: decodeUint8Base64(grid.surface, cells),
    blocked: decodeBitmapBase64(grid.blocked, cells),
    walkableOverride: decodeBitmapBase64(grid.walkableOverride, cells),
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

export function buildTerrain(
  map: MapDef,
  positions: Map<CityId, THREE.Vector3>,
  options: { style?: string; seed?: number; amplitude?: number; previous?: Terrain } = {},
): Terrain {
  const style = options.style ?? "frontier";
  const palette = TERRAIN_PALETTES[style] ?? TERRAIN_PALETTES.frontier;
  const seed = Math.round(options.seed ?? 20261123);
  const amplitude = Math.min(1.5, Math.max(0.2, options.amplitude ?? 1));
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
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  if (navGrid) {
    minX = -map.size[0] / 20;
    maxX = map.size[0] / 20;
    minZ = -map.size[1] / 20;
    maxZ = map.size[1] / 20;
  } else {
    for (const city of cities) {
      minX = Math.min(minX, city.x);
      maxX = Math.max(maxX, city.x);
      minZ = Math.min(minZ, city.z);
      maxZ = Math.max(maxZ, city.z);
    }
    minX -= 14;
    maxX += 14;
    minZ -= 14;
    maxZ += 14;
  }

  const width = maxX - minX;
  const depth = maxZ - minZ;
  const cell = navGrid ? 1.0 : 1.5;
  const segmentsX = Math.max(24, Math.round(width / cell));
  const segmentsZ = Math.max(18, Math.round(depth / cell));

  const heightField = createHeightField({
    cities: [...positions.values()].map((city) => [city.x, city.z] as [number, number]),
    terrain: { seed, amplitude },
  });
  const heightAt = (x: number, z: number): number => {
    if (navGrid) return navGrid.heightCmAtXZ(Math.round(x * 100), Math.round(z * 100)) / 100;
    return heightField.heightAt(x, z);
  };

  const geometry = new THREE.PlaneGeometry(width, depth, segmentsX, segmentsZ);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  for (let index = 0; index < position.count; index += 1) {
    position.setY(index, heightAt(position.getX(index), position.getZ(index)));
  }
  geometry.computeVertexNormals();
  const faceted = geometry.toNonIndexed();
  const flat = faceted.getAttribute("position") as THREE.BufferAttribute;
  const colors: number[] = [];
  const color = new THREE.Color();
  for (let index = 0; index < flat.count; index += 3) {
    const ax = flat.getX(index);
    const ay = flat.getY(index);
    const az = flat.getZ(index);
    const bx = flat.getX(index + 1);
    const by = flat.getY(index + 1);
    const bz = flat.getZ(index + 1);
    const cx = flat.getX(index + 2);
    const cy = flat.getY(index + 2);
    const cz = flat.getZ(index + 2);
    const ux = bx - ax;
    const uy = by - ay;
    const uz = bz - az;
    const vx = cx - ax;
    const vy = cy - ay;
    const vz = cz - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const normalLength = Math.hypot(nx, ny, nz) || 1;
    const slope = 1 - Math.abs(ny / normalLength);
    const x = (ax + bx + cx) / 3;
    const y = (ay + by + cy) / 3;
    const z = (az + bz + cz) / 3;
    const dirt = valueNoise(x / 9 + noiseShift, z / 9, 103) > 0.76;
    if (navGrid) {
      color.setHex(surfaceColor(navGrid.surfaceAtXZ(Math.round(x * 100), Math.round(z * 100)), palette));
    } else if (slope > 0.24 || y > 1.05) {
      color.setHex(dirt ? palette.dirtLight : palette.rock);
    } else if (y > 0.45) {
      color.setHex(dirt ? palette.dirt : palette.grassLight);
    } else if (dirt) {
      color.setHex(palette.dirt);
    } else {
      color.setHex(palette.grass);
    }
    color.offsetHSL(0, 0, (valueNoise(x / 3.5, z / 3.5, 7) - 0.5) * (navGrid ? 0.04 : 0.13) - slope * 0.2);
    for (let vertex = 0; vertex < 3; vertex += 1) colors.push(color.r, color.g, color.b);
  }
  faceted.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  faceted.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1,
    flatShading: true,
  });
  const terrainMesh = new THREE.Mesh(faceted, material);
  terrainMesh.receiveShadow = true;
  terrainMesh.castShadow = false;

  const group = new THREE.Group();
  group.add(terrainMesh);
  const bounds = { minX, maxX, minZ, maxZ };
  const islandSignature = boundarySignature(bounds, heightAt);
  let islandGroup: THREE.Group;
  let island: IslandMetrics;
  if (navGrid && options.previous && options.previous.islandSignature === islandSignature) {
    islandGroup = options.previous.islandGroup;
    island = options.previous.island;
    options.previous.group.remove(islandGroup);
  } else {
    const built = buildIsland(minX, maxX, minZ, maxZ, heightAt, palette, seed);
    islandGroup = built.group;
    island = built.metrics;
  }
  group.add(islandGroup);
  const navOverlay = navGrid ? buildNavOverlay(navGrid, map) : null;
  if (navOverlay) group.add(navOverlay);
  const setNavPreview = (visible: boolean): void => {
    if (navOverlay) navOverlay.visible = visible;
  };

  if (navGrid) {
    return { group, mesh: terrainMesh, navOverlay, heightAt, setNavPreview, bounds, island, islandGroup, islandSignature };
  }

  const random = seeded(20261123);
  const townPositions = map.cities
    .filter((city) => city.kind === "town")
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
      if (isClear(x, z, cities, edges, 5.2)) candidates.push({ x, z });
    }
  }
  for (let index = candidates.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [candidates[index], candidates[swap]] = [candidates[swap], candidates[index]];
  }
  for (const site of candidates.slice(0, 3)) {
    group.add(buildRockRidge(site.x, site.z, 0.95 + random() * 0.25, heightAt, random, palette));
  }
  for (const site of candidates.slice(3, 5)) {
    group.add(buildMesa(site.x, site.z, 1.1 + random() * 0.2, heightAt, random, palette));
  }

  return { group, mesh: terrainMesh, navOverlay, heightAt, setNavPreview, bounds, island, islandGroup, islandSignature };
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
): IslandRimPoint[] {
  const steps = 168;
  const shift = (seed % 977) * 0.013;
  const points: IslandRimPoint[] = [];
  for (let index = 0; index < steps; index += 1) {
    const theta = (index / steps) * Math.PI * 2;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const support = rectangleSupport(theta, halfX, halfZ);
    const broad = valueNoise(cos * 2.7 + shift, sin * 2.7 - shift, seed + 41);
    const fine = valueNoise(cos * 6.5 - shift, sin * 6.5 + shift, seed + 97);
    const margin = 1.5 + broad * 4.6 + fine * 1.3;
    const radius = support + margin;
    const innerX = centerX + cos * support * 0.995;
    const innerZ = centerZ + sin * support * 0.995;
    const baseY = heightAt(innerX, innerZ);
    const berm = 0.16 + valueNoise(cos * 4.1 + shift, sin * 4.1, seed + 211) * 0.58;
    const localDepth = depth * (0.82 + valueNoise(cos * 1.6 + shift, sin * 1.6, seed + 307) * 0.34);
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
): THREE.Mesh {
  const positions: number[] = [];
  const colors: number[] = [];
  const color = new THREE.Color();
  const grass = new THREE.Color(palette.grassLight);
  const dirt = new THREE.Color(palette.dirt);
  const rock = new THREE.Color(palette.rock);
  const tSteps = [0, 0.42, 0.78, 1];
  for (let index = 0; index < rim.length; index += 1) {
    const current = rim[index];
    const next = rim[(index + 1) % rim.length];
    for (let step = 0; step < tSteps.length - 1; step += 1) {
      const t0 = tSteps[step];
      const t1 = tSteps[step + 1];
      const point = (source: IslandRimPoint, t: number): [number, number, number] => {
        const lift = Math.sin(t * Math.PI) * 0.3;
        return [
          source.innerX + (source.x - source.innerX) * t,
          source.innerY + (source.y - source.innerY) * t + lift,
          source.innerZ + (source.z - source.innerZ) * t,
        ];
      };
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
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }),
  );
}

function buildIslandBase(
  rim: IslandRimPoint[],
  centerX: number,
  centerZ: number,
  palette: TerrainStylePalette,
  seed: number,
): THREE.Group {
  const group = new THREE.Group();
  const layers = 22;
  const rings: Array<Array<{ x: number; y: number; z: number; theta: number }>> = [];
  for (let layer = 0; layer <= layers; layer += 1) {
    const t = layer / layers;
    const ledge = (valueNoise(t * 9.3, 0.5, seed + 3) - 0.5) * 2.1;
    const taperT = Math.pow(t, 0.9);
    const shrink = 0.8 * taperT;
    const ring: Array<{ x: number; y: number; z: number; theta: number }> = [];
    for (const point of rim) {
      const theta = point.theta;
      const ridge =
        1 +
        Math.sin(theta * 5.3 + 0.7) * Math.sin(Math.PI * t) * 0.08 +
        Math.sin(theta * 11.7 + 2.1) * Math.sin(Math.PI * Math.min(1, t * 1.15)) * 0.045 +
        (valueNoise(Math.cos(theta) * 3.1 + 5, Math.sin(theta) * 3.1 - 2, seed + 17) - 0.5) * 0.1 +
        (valueNoise(Math.cos(theta) * 10.5 - 3, Math.sin(theta) * 10.5 + 7, seed + 51) - 0.5) * 0.035;
      const radius = Math.max(2, point.radius * (1 - shrink * ridge) + ledge);
      const fall = Math.pow(t, 0.92) * (0.97 + Math.sin(theta * 3.1) * 0.05);
      ring.push({
        x: centerX + Math.cos(theta) * radius,
        y: point.y - point.depth * fall,
        z: centerZ + Math.sin(theta) * radius,
        theta,
      });
    }
    rings.push(ring);
  }

  const positions: number[] = [];
  const colors: number[] = [];
  const color = new THREE.Color();
  const rock = new THREE.Color(palette.rock);
  const mesa = new THREE.Color(palette.mesa);
  const dark = new THREE.Color(palette.rockDark);
  const soil = new THREE.Color(palette.skirt);
  for (let layer = 0; layer < layers; layer += 1) {
    const upper = rings[layer];
    const lower = rings[layer + 1];
    const tMid = (layer + 0.5) / layers;
    for (let index = 0; index < rim.length; index += 1) {
      const next = (index + 1) % rim.length;
      const a = upper[index];
      const b = upper[next];
      const c = lower[next];
      const d = lower[index];
      const strata = valueNoise(2.3, (a.y - d.y) * 0.34 + tMid * 2.4, seed + 8);
      const crevice = valueNoise(Math.cos(a.theta) * 9.5 + 9, Math.sin(a.theta) * 9.5 + tMid * 3.1, seed + 61);
      const rib = valueNoise(Math.cos(a.theta) * 17 + 2, Math.sin(a.theta) * 17 - 5, seed + 83);
      color.copy(rock).lerp(mesa, strata * 0.95);
      if (strata > 0.58) color.offsetHSL(0, -0.03, 0.1);
      if (crevice < 0.38) color.lerp(dark, 0.72);
      if (rib < 0.3) color.multiplyScalar(0.82);
      if (layer === 0) color.lerp(soil, 0.6);
      color.multiplyScalar(0.66 + (1 - tMid) * 0.5);
      pushQuad(
        positions,
        colors,
        color,
        [a.x, a.y, a.z],
        [b.x, b.y, b.z],
        [c.x, c.y, c.z],
        [d.x, d.y, d.z],
      );
    }
  }

  const tipY = Math.min(...rings[layers].map((point) => point.y)) - 6;
  const tip: [number, number, number] = [centerX + 1.6, tipY, centerZ - 1.2];
  const bottom = rings[layers];
  for (let index = 0; index < bottom.length; index += 1) {
    const a = bottom[index];
    const b = bottom[(index + 1) % bottom.length];
    color.copy(dark).multiplyScalar(0.62);
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, ...tip);
    for (let vertex = 0; vertex < 3; vertex += 1) colors.push(color.r, color.g, color.b);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true, side: THREE.DoubleSide }),
  );
  mesh.name = "island-base";
  group.add(mesh);

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
): { group: THREE.Group; metrics: IslandMetrics } {
  const centerX = (minX + maxX) / 2;
  const centerZ = (minZ + maxZ) / 2;
  const halfX = Math.max(1, (maxX - minX) / 2);
  const halfZ = Math.max(1, (maxZ - minZ) / 2);
  const span = Math.max(halfX, halfZ) * 2;
  const depth = THREE.MathUtils.clamp(span * 0.5, 24, 80);
  const rim = islandRim(centerX, centerZ, halfX, halfZ, depth, seed, heightAt);
  const group = new THREE.Group();
  group.name = "island";
  group.add(buildIslandApron(rim, palette, seed));
  group.add(buildIslandBase(rim, centerX, centerZ, palette, seed));
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
    metrics: { centerX, centerZ, radiusX, radiusZ, depth, topY },
  };
}

function buildRockRidge(
  x: number,
  z: number,
  size: number,
  heightAt: (x: number, z: number) => number,
  random: () => number,
  palette: TerrainStylePalette,
): THREE.Group {
  const group = new THREE.Group();
  group.position.set(x, heightAt(x, z), z);
  const rock = new THREE.MeshStandardMaterial({ color: palette.ridge, roughness: 0.95, flatShading: true });
  const dark = new THREE.MeshStandardMaterial({ color: palette.ridgeDark, roughness: 1, flatShading: true });
  for (let index = 0; index < 5; index += 1) {
    const radius = (0.8 + random() * 0.9) * size;
    const height = (1.4 + random() * 2.6) * size;
    const geometry = new THREE.CylinderGeometry(radius * 0.55, radius, height, 6, 2);
    const position = geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let vertex = 0; vertex < position.count; vertex += 1) {
      const factor = 0.78 + random() * 0.44;
      position.setX(vertex, position.getX(vertex) * factor);
      position.setZ(vertex, position.getZ(vertex) * factor);
    }
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, index % 2 === 0 ? rock : dark);
    mesh.position.set((index - 2) * 1.25 * size, height / 2, (random() - 0.5) * 1.8 * size);
    mesh.rotation.y = random() * Math.PI;
    group.add(mesh);
  }
  return group;
}

function buildMesa(
  x: number,
  z: number,
  size: number,
  heightAt: (x: number, z: number) => number,
  random: () => number,
  palette: TerrainStylePalette,
): THREE.Group {
  const group = new THREE.Group();
  group.position.set(x, heightAt(x, z), z);
  const height = 2.4 * size;
  const top = new THREE.Mesh(
    new THREE.CylinderGeometry(1.9 * size, 2.4 * size, height, 7, 1),
    new THREE.MeshStandardMaterial({ color: palette.mesa, roughness: 1, flatShading: true }),
  );
  top.position.y = height / 2;
  top.rotation.y = random() * Math.PI;
  group.add(top);
  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(2.0 * size, 1.9 * size, 0.28 * size, 7, 1),
    new THREE.MeshStandardMaterial({ color: palette.mesaCap, roughness: 1, flatShading: true }),
  );
  cap.position.y = height + 0.03;
  cap.rotation.y = top.rotation.y;
  group.add(cap);
  return group;
}