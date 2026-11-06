import * as THREE from "three";
import {
  GLOW,
  HAY,
  IRON,
  ModelBuilder,
  PLASTERS,
  STONE,
  STONE_DARK,
  STONE_LIGHT,
  TEAM_PALETTES,
  TIMBER,
  TIMBER_DARK,
  archShape,
  bannerShape,
  flagShape,
  material,
  roofTileTexture,
} from "./building-kit";
import type { TeamPalette } from "./building-kit";

export { TEAM_PALETTES };
export type { TeamPalette };

export const IRON_MAT = material(IRON, { rough: 0.55, metal: 0.35 });
export const DARK_MAT = material(TIMBER_DARK, { rough: 0.95 });
export const TIMBER_MAT = material(TIMBER, { rough: 0.95 });
export const STONE_MAT = material(STONE, { rough: 1 });
export const STONE_DARK_MAT = material(STONE_DARK, { rough: 1 });
export const STONE_LIGHT_MAT = material(STONE_LIGHT, { rough: 1 });
export const HAY_MAT = material(HAY, { rough: 1 });
export const GLOW_MAT = material(GLOW, { rough: 0.45, emissive: GLOW, emissiveIntensity: 0.85 });
export const WATER_MAT = material(0x4c7f8a, { rough: 0.35 });
export const BURLAP_MAT = material(0xa98a5e, { rough: 1 });
export const GOLD_MAT = material(0xc9a24e, { rough: 0.45, metal: 0.4 });
export const ORE_MAT = material(0x6a6f74, { rough: 0.8, metal: 0.15 });

const roofMaterials = new Map<string, THREE.MeshStandardMaterial>();

export function clothMat(palette: TeamPalette): THREE.MeshStandardMaterial {
  return material(palette.cloth, { rough: 0.95, side: THREE.DoubleSide });
}

export function roofMat(palette: TeamPalette, shade = 1): THREE.MeshStandardMaterial {
  const color = new THREE.Color(palette.roof).multiplyScalar(shade);
  const key = color.getHexString();
  const cached = roofMaterials.get(key);
  if (cached) return cached;
  const mat = new THREE.MeshStandardMaterial({
    color: color.getHex(),
    map: roofTileTexture(),
    roughness: 0.9,
    flatShading: true,
  });
  mat.userData.shared = true;
  roofMaterials.set(key, mat);
  return mat;
}

export function edgeMat(palette: TeamPalette): THREE.MeshStandardMaterial {
  return material(palette.roofEdge, { rough: 0.95 });
}

export function plasterFor(variant: number): THREE.MeshStandardMaterial {
  return material(PLASTERS[Math.abs(variant) % PLASTERS.length], { rough: 0.95 });
}

export function plinth(builder: ModelBuilder, width: number, depth: number, height = 0.12): void {
  builder.box([width + 0.14, height, depth + 0.14], STONE_DARK_MAT, 0, height / 2, 0);
}

export function pennant(
  builder: ModelBuilder,
  palette: TeamPalette,
  x: number,
  y: number,
  z: number,
  height = 0.36,
  width = 0.24,
): void {
  const cloth = clothMat(palette);
  builder.cylinder(0.013, 0.013, height, 5, DARK_MAT, x, y + height / 2, z);
  builder.shape(flagShape(width, width * 0.62), cloth, x + 0.012, y + height - 0.03, z);
  builder.box([0.05, 0.05, 0.05], STONE_LIGHT_MAT, x, y + height + 0.01, z);
}

export function hangingBanner(
  builder: ModelBuilder,
  palette: TeamPalette,
  x: number,
  y: number,
  z: number,
  width = 0.34,
  height = 0.4,
  rotY = 0,
): void {
  builder.shape(bannerShape(width, height), clothMat(palette), x, y, z, rotY);
  builder.box([width + 0.06, 0.03, 0.03], TIMBER_MAT, x, y + 0.01, z, 0, rotY, 0);
}

export function doorRect(
  builder: ModelBuilder,
  width: number,
  height: number,
  z: number,
  baseY: number,
  doorMat: THREE.Material = DARK_MAT,
): void {
  builder.box([width + 0.1, height + 0.08, 0.04], TIMBER_MAT, 0, baseY + height / 2, z - 0.005);
  builder.box([width, height, 0.05], doorMat, 0, baseY + height / 2, z + 0.01);
  builder.box([width + 0.06, 0.05, 0.06], TIMBER_MAT, 0, baseY + height + 0.02, z + 0.01);
}

export function archDoor(
  builder: ModelBuilder,
  width: number,
  height: number,
  z: number,
  baseY: number,
  doorMat: THREE.Material = DARK_MAT,
): void {
  builder.shape(archShape(width + 0.12, height + 0.1), TIMBER_MAT, 0, baseY, z - 0.006);
  builder.shape(archShape(width, height), doorMat, 0, baseY, z + 0.012);
}

export function crate(builder: ModelBuilder, x: number, z: number, scale = 1, y = 0): void {
  const size = 0.2 * scale;
  builder.box([size, size, size], TIMBER_MAT, x, y + size / 2 + 0.02, z);
  builder.box([size + 0.01, 0.025, size + 0.01], DARK_MAT, x, y + size * 0.68, z);
}

export function barrel(builder: ModelBuilder, x: number, z: number, scale = 1, y = 0): void {
  builder.cylinder(0.09 * scale, 0.1 * scale, 0.24 * scale, 8, TIMBER_MAT, x, y + 0.12 * scale, z);
  builder.cylinder(0.095 * scale, 0.095 * scale, 0.025, 8, IRON_MAT, x, y + 0.08 * scale, z);
  builder.cylinder(0.095 * scale, 0.095 * scale, 0.025, 8, IRON_MAT, x, y + 0.18 * scale, z);
}

export function sack(builder: ModelBuilder, x: number, z: number, scale = 1, y = 0): void {
  const width = 0.16 * scale;
  builder.cylinder(width * 0.7, width, 0.22 * scale, 7, BURLAP_MAT, x, y + 0.11 * scale, z);
  builder.cylinder(width * 0.35, width * 0.45, 0.07, 6, BURLAP_MAT, x, y + 0.25 * scale, z);
  builder.cylinder(0.025 * scale, 0.025 * scale, 0.03, 6, DARK_MAT, x, y + 0.28 * scale, z);
}

export function hayBale(builder: ModelBuilder, x: number, z: number, scale = 1, y = 0): void {
  const width = 0.34 * scale;
  builder.box([width, 0.18 * scale, width * 0.66], HAY_MAT, x, y + 0.09 * scale, z);
  builder.box([0.03, 0.19 * scale, width * 0.68], DARK_MAT, x - width * 0.25, y + 0.09 * scale, z);
  builder.box([0.03, 0.19 * scale, width * 0.68], DARK_MAT, x + width * 0.25, y + 0.09 * scale, z);
}

export function fenceLine(
  builder: ModelBuilder,
  x1: number,
  z1: number,
  x2: number,
  z2: number,
  height = 0.4,
): void {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const length = Math.hypot(dx, dz);
  if (length < 0.05) return;
  const angle = Math.atan2(dx, dz);
  const posts = Math.max(2, Math.round(length / 0.55));
  for (let index = 0; index <= posts; index += 1) {
    const t = index / posts;
    builder.box([0.055, height, 0.055], TIMBER_MAT, x1 + dx * t, height / 2, z1 + dz * t);
  }
  for (const y of [height * 0.42, height * 0.78]) {
    builder.box([0.04, 0.04, length], TIMBER_MAT, (x1 + x2) / 2, y, (z1 + z2) / 2, 0, angle, 0);
  }
}

export function weaponRack(builder: ModelBuilder, x: number, z: number, rotY = 0): void {
  const cos = Math.cos(rotY);
  const sin = Math.sin(rotY);
  for (const side of [-0.28, 0.28]) {
    builder.box([0.05, 0.7, 0.05], TIMBER_MAT, x + side * cos, 0.35, z - side * sin);
  }
  builder.box([0.62, 0.05, 0.05], TIMBER_MAT, x, 0.6, z, 0, rotY, 0);
  for (const offset of [-0.18, 0, 0.18]) {
    builder.box([0.028, 0.62, 0.028], IRON_MAT, x + offset * cos, 0.34, z - offset * sin, 0, rotY, 0.14);
    builder.box([0.07, 0.05, 0.04], IRON_MAT, x + offset * cos, 0.64, z - offset * sin, 0, rotY, 0.14);
  }
}

export function roundShield(
  builder: ModelBuilder,
  palette: TeamPalette,
  x: number,
  y: number,
  z: number,
  radius = 0.18,
  rotY = 0,
): void {
  const cloth = clothMat(palette);
  builder.cylinder(radius, radius, 0.045, 12, IRON_MAT, x, y, z, Math.PI / 2, rotY, 0);
  builder.cylinder(radius * 0.86, radius * 0.86, 0.05, 12, cloth, x, y, z + 0.004, Math.PI / 2, rotY, 0);
  builder.cylinder(radius * 0.26, radius * 0.26, 0.06, 8, GOLD_MAT, x, y, z + 0.01, Math.PI / 2, rotY, 0);
}

export function target(builder: ModelBuilder, x: number, z: number, y = 0.3, scale = 1): void {
  builder.cylinder(0.2 * scale, 0.2 * scale, 0.02, 14, material(0xe3d6b6), x, y, z, Math.PI / 2, 0, 0);
  builder.cylinder(0.13 * scale, 0.13 * scale, 0.022, 14, material(0xa9503a), x, y, z + 0.012, Math.PI / 2, 0, 0);
  builder.cylinder(0.05 * scale, 0.05 * scale, 0.024, 14, material(0xe3d6b6), x, y, z + 0.024, Math.PI / 2, 0, 0);
  builder.box([0.03, 0.26, 0.03], TIMBER_MAT, x - 0.12, y - 0.14, z - 0.08, 0, -0.3, 0);
  builder.box([0.03, 0.3, 0.03], TIMBER_MAT, x, y - 0.15, z - 0.1);
}

export function trainingDummy(builder: ModelBuilder, palette: TeamPalette, x: number, z: number): void {
  builder.cylinder(0.035, 0.045, 0.46, 6, TIMBER_MAT, x, 0.23, z);
  builder.box([0.46, 0.04, 0.04], TIMBER_MAT, x, 0.42, z);
  builder.cylinder(0.02, 0.02, 0.3, 6, TIMBER_MAT, x, 0.57, z);
  builder.box([0.16, 0.16, 0.08], clothMat(palette), x, 0.56, z);
  builder.box([0.1, 0.1, 0.1], HAY_MAT, x, 0.7, z);
  builder.box([0.36, 0.03, 0.03], TIMBER_MAT, x, 0.66, z);
}

export function horse(builder: ModelBuilder, palette: TeamPalette, x: number, z: number, rotY = 0, scale = 1): void {
  const chestnut = material(0x6b4a33, { rough: 0.9 });
  const dark = material(0x3f2d20, { rough: 0.95 });
  const cos = Math.cos(rotY);
  const sin = Math.sin(rotY);
  const at = (lx: number, lz: number): [number, number] => [x + lx * cos + lz * sin, z - lx * sin + lz * cos];
  const add = (w: number, h: number, d: number, mat: THREE.Material, lx: number, ly: number, lz: number): void => {
    const [px, pz] = at(lx, lz);
    builder.box([w * scale, h * scale, d * scale], mat, px, ly * scale, pz, 0, rotY, 0);
  };
  add(0.2, 0.26, 0.52, chestnut, 0, 0.58, 0);
  add(0.15, 0.34, 0.15, chestnut, 0, 0.74, 0.24);
  add(0.13, 0.14, 0.3, chestnut, 0, 0.88, 0.4);
  add(0.18, 0.02, 0.34, clothMat(palette), 0, 0.72, 0);
  add(0.02, 0.2, 0.3, clothMat(palette), -0.11, 0.62, 0);
  add(0.02, 0.2, 0.3, clothMat(palette), 0.11, 0.62, 0);
  for (const lx of [-0.07, 0.07]) {
    for (const lz of [-0.18, 0.18]) {
      add(0.045, 0.34, 0.045, dark, lx, 0.2, lz);
    }
  }
  add(0.04, 0.24, 0.04, dark, 0, 0.5, -0.28);
  add(0.03, 0.05, 0.12, dark, 0.05, 0.95, 0.42);
  add(0.03, 0.05, 0.12, dark, -0.05, 0.95, 0.42);
}

export function cart(builder: ModelBuilder, x: number, z: number, rotY = 0): void {
  const cos = Math.cos(rotY);
  const sin = Math.sin(rotY);
  const at = (lx: number, lz: number): [number, number] => [x + lx * cos + lz * sin, z - lx * sin + lz * cos];
  const [bx, bz] = at(0, 0);
  builder.box([0.4, 0.08, 0.58], TIMBER_MAT, bx, 0.26, bz, 0, rotY, 0);
  for (const side of [-1, 1]) {
    const [wx, wz] = at(side * 0.21, -0.02);
    builder.box([0.03, 0.12, 0.62], TIMBER_MAT, wx, 0.31, wz, 0, rotY, 0);
    const [hx, hz] = at(side * 0.24, -0.08);
    builder.cylinder(0.14, 0.14, 0.04, 10, TIMBER_MAT, hx, 0.15, hz, 0, rotY, Math.PI / 2);
  }
  for (const side of [-1, 1]) {
    const [hx, hz] = at(side * 0.13, 0.46);
    builder.box([0.035, 0.035, 0.44], TIMBER_MAT, hx, 0.28, hz, 0.2, rotY, 0);
  }
  const [cx, cz] = at(-0.05, -0.02);
  builder.box([0.18, 0.16, 0.18], TIMBER_MAT, cx, 0.38, cz, 0, rotY, 0);
}

export function oreCart(builder: ModelBuilder, x: number, z: number, rotY = 0): void {
  const cos = Math.cos(rotY);
  const sin = Math.sin(rotY);
  const at = (lx: number, lz: number): [number, number] => [x + lx * cos + lz * sin, z - lx * sin + lz * cos];
  const [bx, bz] = at(0, 0);
  builder.box([0.34, 0.1, 0.48], TIMBER_MAT, bx, 0.24, bz, 0, rotY, 0);
  builder.box([0.34, 0.16, 0.04], TIMBER_MAT, bx - 0.15 * cos, 0.34, bz + 0.15 * sin, 0, rotY, 0);
  builder.box([0.34, 0.16, 0.04], TIMBER_MAT, bx + 0.15 * cos, 0.34, bz - 0.15 * sin, 0, rotY, 0);
  for (const side of [-1, 1]) {
    const [wx, wz] = at(side * 0.2, -0.12);
    builder.cylinder(0.11, 0.11, 0.035, 8, IRON_MAT, wx, 0.12, wz, 0, rotY, Math.PI / 2);
  }
  const [ox, oz] = at(0, 0);
  builder.add(new THREE.DodecahedronGeometry(0.11, 0), ORE_MAT, new THREE.Vector3(ox, 0.38, oz));
  builder.add(new THREE.DodecahedronGeometry(0.08, 0), ORE_MAT, new THREE.Vector3(ox + 0.09, 0.34, oz + 0.05));
}

export function anvil(builder: ModelBuilder, x: number, z: number): void {
  builder.box([0.14, 0.2, 0.14], STONE_DARK_MAT, x, 0.1, z);
  builder.box([0.3, 0.08, 0.12], IRON_MAT, x, 0.24, z);
  builder.cone(0.055, 0.16, 5, IRON_MAT, x + 0.17, 0.24, z, 0);
}

export function coalPile(builder: ModelBuilder, x: number, z: number): void {
  const coal = material(0x2b2622, { rough: 1 });
  builder.cone(0.24, 0.2, 8, coal, x, 0.1, z);
  for (const offset of [-0.08, 0.02, 0.08]) {
    builder.box([0.045, 0.03, 0.045], material(0xff7a2a, { emissive: 0xff5a10, emissiveIntensity: 1.1 }), x + offset, 0.13, z + 0.05);
  }
}

export function lamp(builder: ModelBuilder, x: number, z: number, height = 1.05): void {
  builder.cylinder(0.09, 0.12, 0.12, 8, STONE_DARK_MAT, x, 0.06, z);
  builder.cylinder(0.022, 0.022, height, 6, DARK_MAT, x, height / 2 + 0.1, z);
  builder.box([0.14, 0.18, 0.14], material(0xffcf8a, { emissive: 0xffb35e, emissiveIntensity: 0.8 }), x, height + 0.18, z);
  builder.box([0.19, 0.04, 0.19], DARK_MAT, x, height + 0.29, z);
}

export function bench(builder: ModelBuilder, x: number, z: number, rotY = 0): void {
  builder.box([0.5, 0.05, 0.16], TIMBER_MAT, x, 0.28, z, 0, rotY, 0);
  for (const side of [-0.18, 0.18]) {
    builder.box([0.05, 0.28, 0.12], TIMBER_MAT, x + side * Math.cos(rotY), 0.14, z - side * Math.sin(rotY), 0, rotY, 0);
  }
}

