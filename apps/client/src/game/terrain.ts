import * as THREE from "three";
import type { CityId, MapDef } from "@marchlands/sim";

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

export interface Terrain {
  group: THREE.Group;
  heightAt(x: number, z: number): number;
}

export function buildTerrain(
  map: MapDef,
  positions: Map<CityId, THREE.Vector3>,
  options: { style?: string; seed?: number; amplitude?: number } = {},
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

  const roadPaths = edges.map((edge) => {
    const direction = new THREE.Vector3().subVectors(edge.to, edge.from);
    const length = direction.length();
    direction.normalize();
    const perpendicular = new THREE.Vector3(-direction.z, 0, direction.x);
    const bend = Math.sin(edge.from.x * 0.73 + edge.from.z * 0.41 + edge.to.x * 0.29 + edge.to.z * 0.17) * Math.min(2.8, length * 0.2);
    const curve = new THREE.CatmullRomCurve3([
      edge.from.clone(),
      edge.from.clone().addScaledVector(direction, length / 3).addScaledVector(perpendicular, bend),
      edge.from.clone().addScaledVector(direction, (length * 2) / 3).addScaledVector(perpendicular, bend),
      edge.to.clone(),
    ], false, "catmullrom", 0.18);
    return curve.getSpacedPoints(10);
  });

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const city of cities) {
    minX = Math.min(minX, city.x);
    maxX = Math.max(maxX, city.x);
    minZ = Math.min(minZ, city.z);
    maxZ = Math.max(maxZ, city.z);
  }
  minX -= 17;
  maxX += 17;
  minZ -= 17;
  maxZ += 17;

  const width = maxX - minX;
  const depth = maxZ - minZ;
  const cell = 3.0;
  const segmentsX = Math.max(24, Math.round(width / cell));
  const segmentsZ = Math.max(18, Math.round(depth / cell));

  function clearHeight(x: number, z: number): number {
    let cityFade = 1;
    for (const city of cities) {
      const distance = Math.hypot(x - city.x, z - city.z);
      cityFade = Math.min(cityFade, smoothstep(CITY_PAD, CITY_FADE, distance));
    }
    let roadFade = 1;
    for (const path of roadPaths) {
      let distance = Number.POSITIVE_INFINITY;
      for (let index = 0; index < path.length - 1; index += 1) {
        distance = Math.min(distance, segmentDistance(x, z, path[index].x, path[index].z, path[index + 1].x, path[index + 1].z));
      }
      roadFade = Math.min(roadFade, smoothstep(ROAD_PAD, ROAD_FADE, distance));
      if (roadFade === 0) break;
    }
    const broad =
      valueNoise(x / 13 + noiseShift, z / 13 - noiseShift, 17) * 1.25 +
      valueNoise(x / 5.5 - noiseShift, z / 5.5 + noiseShift, 31) * 0.34;
    const ridge = Math.max(0, valueNoise(x / 9 + noiseShift, z / 9, 71) - 0.5) * 1.7;
    return Math.max(0, (broad - 0.32 + ridge) * cityFade * roadFade * amplitude);
  }

  function heightAt(x: number, z: number): number {
    return clearHeight(x, z);
  }

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
    if (slope > 0.24 || y > 1.05) {
      color.setHex(dirt ? palette.dirtLight : palette.rock);
    } else if (y > 0.45) {
      color.setHex(dirt ? palette.dirt : palette.grassLight);
    } else if (dirt) {
      color.setHex(palette.dirt);
    } else {
      color.setHex(palette.grass);
    }
    color.offsetHSL(0, 0, (valueNoise(x / 3.5, z / 3.5, 7) - 0.5) * 0.13 - slope * 0.2);
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
  group.add(buildSkirt(minX, maxX, minZ, maxZ, heightAt, palette));

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

  return { group, heightAt };
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

function buildSkirt(
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  heightAt: (x: number, z: number) => number,
  palette: TerrainStylePalette,
): THREE.Mesh {
  const steps = 32;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const color = new THREE.Color(palette.skirt);
  const perimeter: Array<[number, number]> = [];
  for (let i = 0; i <= steps; i += 1) perimeter.push([minX + ((maxX - minX) * i) / steps, minZ]);
  for (let i = 0; i <= steps; i += 1) perimeter.push([maxX, minZ + ((maxZ - minZ) * i) / steps]);
  for (let i = 0; i <= steps; i += 1) perimeter.push([maxX - ((maxX - minX) * i) / steps, maxZ]);
  for (let i = 0; i <= steps; i += 1) perimeter.push([minX, maxZ - ((maxZ - minZ) * i) / steps]);
  let base = 0;
  for (const [x, z] of perimeter) {
    const y = heightAt(x, z);
    positions.push(x, y, z, x, -1.8, z);
    colors.push(color.r, color.g, color.b, 0.18, 0.15, 0.11);
    if (base > 0) {
      const index = (base - 1) * 2;
      indices.push(index, index + 1, index + 2, index + 1, index + 3, index + 2);
    }
    base += 1;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide }));
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