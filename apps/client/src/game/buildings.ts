import * as THREE from "three";
import {
  BARN,
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
  gableEnd,
  material,
  roofSlab,
  roofTileTexture,
  timberFrame,
  windowPanel,
} from "./building-kit";
import type { TeamPalette } from "./building-kit";

export type BuildingKind = "hall" | "range" | "stable" | "forge";

export const BUILDING_KINDS: BuildingKind[] = ["hall", "range", "stable", "forge"];

export const BUILDING_NAMES: Record<BuildingKind, string> = {
  hall: "大厅",
  range: "箭塔",
  stable: "马厩",
  forge: "工坊",
};

const IRON_MAT = material(IRON, { rough: 0.55, metal: 0.35 });
const DARK_MAT = material(TIMBER_DARK, { rough: 0.95 });
const TIMBER_MAT = material(TIMBER, { rough: 0.95 });
const STONE_MAT = material(STONE, { rough: 1 });
const STONE_DARK_MAT = material(STONE_DARK, { rough: 1 });
const STONE_LIGHT_MAT = material(STONE_LIGHT, { rough: 1 });
const HAY_MAT = material(HAY, { rough: 1 });
const GLOW_MAT = material(GLOW, { rough: 0.45, emissive: GLOW, emissiveIntensity: 0.85 });

function clothMat(palette: TeamPalette): THREE.MeshStandardMaterial {
  return material(palette.cloth, { rough: 0.95, side: THREE.DoubleSide });
}

const roofMaterials = new Map<number, THREE.MeshStandardMaterial>();

function roofMat(palette: TeamPalette, shade = 1): THREE.MeshStandardMaterial {
  const color = new THREE.Color(palette.roof).multiplyScalar(shade);
  const hex = color.getHex();
  const cached = roofMaterials.get(hex);
  if (cached) return cached;
  const mat = new THREE.MeshStandardMaterial({
    color: hex,
    map: roofTileTexture(),
    roughness: 0.9,
    flatShading: true,
  });
  mat.userData.shared = true;
  roofMaterials.set(hex, mat);
  return mat;
}

function edgeMat(palette: TeamPalette): THREE.MeshStandardMaterial {
  return material(palette.roofEdge, { rough: 0.95 });
}

function plinth(builder: ModelBuilder, width: number, depth: number): void {
  builder.box([width + 0.12, 0.12, depth + 0.12], STONE_DARK_MAT, 0, 0.06, 0);
}

function pennant(
  builder: ModelBuilder,
  palette: TeamPalette,
  x: number,
  y: number,
  z: number,
  height = 0.36,
): void {
  const cloth = clothMat(palette);
  builder.cylinder(0.013, 0.013, height, 5, DARK_MAT, x, y + height / 2, z);
  builder.shape(flagShape(0.24, 0.15), cloth, x + 0.012, y + height - 0.03, z);
  builder.box([0.05, 0.05, 0.05], STONE_LIGHT_MAT, x, y + height + 0.01, z);
}

function doorRect(
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

function archDoor(
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

function crate(builder: ModelBuilder, x: number, z: number, scale = 1): void {
  const size = 0.2 * scale;
  builder.box([size, size, size], TIMBER_MAT, x, size / 2 + 0.02, z);
  builder.box([size + 0.01, 0.025, size + 0.01], DARK_MAT, x, size * 0.68, z);
}

function barrel(builder: ModelBuilder, x: number, z: number, scale = 1): void {
  builder.cylinder(0.09 * scale, 0.1 * scale, 0.24 * scale, 8, TIMBER_MAT, x, 0.12 * scale, z);
  builder.cylinder(0.095 * scale, 0.095 * scale, 0.025, 8, IRON_MAT, x, 0.08 * scale, z);
  builder.cylinder(0.095 * scale, 0.095 * scale, 0.025, 8, IRON_MAT, x, 0.18 * scale, z);
}

function buildHall(palette: TeamPalette, variant: number): THREE.Group {
  const builder = new ModelBuilder();
  const plaster = material(PLASTERS[variant % PLASTERS.length], { rough: 0.95 });
  const roof = roofMat(palette);
  const edge = edgeMat(palette);
  const cloth = clothMat(palette);
  const width = 1.5;
  const depth = 1.2;
  const wall = 0.96;
  const baseY = 0.12;
  const eave = baseY + wall;

  plinth(builder, width, depth);
  builder.box([width, wall, depth], plaster, 0, baseY + wall / 2, 0);
  builder.box([width + 0.035, 0.3, depth + 0.035], STONE_MAT, 0, baseY + 0.15, 0);
  builder.box([width + 0.05, 0.05, depth + 0.05], STONE_DARK_MAT, 0, baseY + 0.31, 0);
  timberFrame(builder, width, depth, wall, baseY, TIMBER_MAT);

  roofSlab(builder, roof, width, depth, 0.6, 0.12, eave, 0);
  gableEnd(builder, plaster, depth, width, 0.6, eave, 0);

  builder.box([0.92, 0.055, 0.44], edge, 0, eave - 0.02, depth / 2 + 0.2, 0.14, 0, 0);
  for (const x of [-0.42, 0.42]) {
    builder.box([0.07, 0.84, 0.07], TIMBER_MAT, x, baseY + 0.42, depth / 2 + 0.34);
    builder.box([0.05, 0.05, 0.26], TIMBER_MAT, x, eave - 0.06, depth / 2 + 0.3, 0.35, 0, 0);
  }

  doorRect(builder, 0.34, 0.56, depth / 2, baseY, DARK_MAT);
  builder.box([0.5, 0.05, 0.07], TIMBER_MAT, 0, baseY + 0.62, depth / 2 + 0.03);

  const signY = 1.06;
  const signZ = depth / 2 + 0.24;
  builder.cylinder(0.16, 0.16, 0.03, 14, cloth, 0, signY, signZ, Math.PI / 2, 0, 0);
  builder.cylinder(0.19, 0.19, 0.018, 14, IRON_MAT, 0, signY, signZ - 0.012, Math.PI / 2, 0, 0);
  for (const side of [-1, 1]) {
    builder.box([0.03, 0.42, 0.022], IRON_MAT, 0, signY, signZ + 0.028, 0, 0, side * 0.66);
  }

  windowPanel(builder, -0.55, 0.62, depth / 2 + 0.005, DARK_MAT, GLOW_MAT);
  windowPanel(builder, 0.55, 0.62, depth / 2 + 0.005, DARK_MAT, GLOW_MAT);
  windowPanel(builder, -0.55, 0.62, -depth / 2 - 0.005, DARK_MAT, DARK_MAT);
  windowPanel(builder, 0.55, 0.62, -depth / 2 - 0.005, DARK_MAT, DARK_MAT);

  builder.box([0.26, 0.72, 0.26], STONE_MAT, -0.46, 1.35, -0.34);
  builder.box([0.34, 0.08, 0.34], STONE_DARK_MAT, -0.46, 1.74, -0.34);

  pennant(builder, palette, 0.44, eave + 0.52, 0);
  return builder.finish();
}

function buildRange(palette: TeamPalette, variant: number): THREE.Group {
  const builder = new ModelBuilder();
  const plaster = material(PLASTERS[(variant + 1) % PLASTERS.length], { rough: 0.95 });
  const cloth = clothMat(palette);
  const bronze = material(0x9a7a3a, { rough: 0.45, metal: 0.5 });
  const width = 0.78;
  const depth = 0.78;
  const bodyTop = 1.5;

  plinth(builder, 0.86, 0.86);
  builder.box([0.8, 0.3, 0.8], STONE_MAT, 0, 0.27, 0);
  builder.box([width, 1.08, depth], plaster, 0, 0.42 + 0.54, 0);
  timberFrame(builder, width, depth, 1.08, 0.42, TIMBER_MAT);

  const deck = material(0x7a5a3a, { rough: 0.95 });
  builder.box([1.06, 0.09, 1.06], deck, 0, bodyTop + 0.045, 0);
  builder.box([0.34, 0.02, 0.34], DARK_MAT, 0, bodyTop + 0.1, 0.1);

  const postBase = bodyTop + 0.09;
  const postHeight = 0.62;
  const corners: Array<[number, number]> = [
    [-0.48, -0.48],
    [0.48, -0.48],
    [-0.48, 0.48],
    [0.48, 0.48],
  ];
  for (const [x, z] of corners) {
    builder.box([0.065, postHeight, 0.065], TIMBER_MAT, x, postBase + postHeight / 2, z);
  }
  for (const y of [postBase + 0.18, postBase + 0.42]) {
    for (const side of [-1, 1]) {
      builder.box([1.02, 0.035, 0.035], TIMBER_MAT, 0, y, side * 0.48);
      builder.box([0.035, 0.035, 1.02], TIMBER_MAT, side * 0.48, y, 0);
    }
  }
  for (const side of [-1, 1]) {
    builder.box([1.1, 0.06, 0.09], TIMBER_MAT, 0, postBase + postHeight, side * 0.48);
    builder.box([0.09, 0.06, 1.1], TIMBER_MAT, side * 0.48, postBase + postHeight, 0);
  }

  builder.cylinder(0.022, 0.026, 1.0, 5, TIMBER_MAT, 0.42, postBase + 0.98, -0.42);
  builder.shape(flagShape(0.36, 0.22), cloth, 0.44, postBase + 1.4, -0.42);
  builder.box([0.05, 0.05, 0.05], IRON_MAT, 0.42, postBase + 1.55, -0.42);

  builder.box([0.045, 0.045, 1.02], TIMBER_MAT, 0, postBase + 0.58, -0.48);
  builder.cylinder(0.09, 0.11, 0.16, 8, bronze, 0, postBase + 0.45, -0.38);
  builder.cylinder(0.06, 0.06, 0.02, 8, bronze, 0, postBase + 0.36, -0.38);

  for (const side of [-1, 1]) {
    for (const x of [-0.3, 0, 0.3]) {
      builder.shape(flagShape(0.12, 0.09), cloth, x, postBase + 0.55, side * 0.5);
    }
  }

  archDoor(builder, 0.28, 0.48, depth / 2 + 0.02, 0.32);
  for (const y of [0.9, 1.16]) {
    builder.box([0.06, 0.16, 0.04], DARK_MAT, 0, y, depth / 2 + 0.012);
  }

  for (const x of [-0.16, 0.16]) {
    builder.box([0.03, 1.4, 0.03], TIMBER_MAT, x, 0.82, -0.53);
  }
  for (let index = 0; index < 5; index += 1) {
    builder.box([0.34, 0.025, 0.025], TIMBER_MAT, 0, 0.32 + index * 0.26, -0.53);
  }

  const targetX = -0.52;
  const targetZ = 0.6;
  builder.cylinder(0.21, 0.21, 0.02, 16, material(0xe3d6b6), targetX, 0.34, targetZ, Math.PI / 2, 0, 0);
  builder.cylinder(0.135, 0.135, 0.022, 16, material(0xa9503a), targetX, 0.34, targetZ + 0.012, Math.PI / 2, 0, 0);
  builder.cylinder(0.055, 0.055, 0.024, 16, material(0xe3d6b6), targetX, 0.34, targetZ + 0.024, Math.PI / 2, 0, 0);
  builder.box([0.03, 0.03, 0.32], TIMBER_MAT, targetX - 0.12, 0.56, targetZ - 0.1, 0, -0.4, 0);
  builder.box([0.03, 0.34, 0.03], TIMBER_MAT, targetX, 0.17, targetZ - 0.1);
  builder.box([0.5, 0.09, 0.5], STONE_DARK_MAT, 0, 0.16, 0);

  builder.cylinder(0.05, 0.05, 0.26, 7, TIMBER_MAT, 0.5, 0.21, 0.56);
  for (const offset of [-0.03, 0, 0.03]) {
    builder.cylinder(0.008, 0.008, 0.42, 4, TIMBER_MAT, 0.5 + offset, 0.36, 0.56);
    builder.box([0.04, 0.07, 0.01], IRON_MAT, 0.5 + offset, 0.55, 0.56);
  }

  return builder.finish();
}

function gambrelRoof(
  builder: ModelBuilder,
  mat: THREE.Material,
  span: number,
  length: number,
  rise: number,
  overhang: number,
  eaveY: number,
  rotY: number,
): void {
  const half = span / 2 + overhang;
  const shoulder = (span / 2) * 0.62;
  const shoulderRise = rise * 0.55;
  const qY = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, 0));
  const segments = [
    { z0: half, y0: 0, z1: shoulder, y1: shoulderRise },
    { z0: shoulder, y0: shoulderRise, z1: 0, y1: rise },
  ];
  for (const side of [1, -1]) {
    for (const segment of segments) {
      const dz = segment.z0 - segment.z1;
      const dy = segment.y1 - segment.y0;
      const slope = Math.hypot(dz, dy);
      const angle = Math.atan2(dy, dz);
      const centerZ = (side * (segment.z0 + segment.z1)) / 2;
      const centerY = eaveY + (segment.y0 + segment.y1) / 2;
      const q = qY.clone().multiply(
        new THREE.Quaternion().setFromEuler(new THREE.Euler(side * angle, 0, 0)),
      );
      const position = new THREE.Vector3(0, centerY, centerZ).applyQuaternion(qY);
      builder.addMatrix(
        new THREE.BoxGeometry(length + overhang * 2, 0.075, slope + 0.02),
        mat,
        new THREE.Matrix4().compose(position, q, new THREE.Vector3(1, 1, 1)),
      );
    }
  }
  builder.addMatrix(
    new THREE.BoxGeometry(length + overhang * 2 + 0.04, 0.07, 0.16),
    mat,
    new THREE.Matrix4().compose(
      new THREE.Vector3(0, eaveY + rise, 0),
      qY,
      new THREE.Vector3(1, 1, 1),
    ),
  );
}

function buildStable(palette: TeamPalette, variant: number): THREE.Group {
  const builder = new ModelBuilder();
  const planks = material(variant % 2 === 0 ? BARN : 0x94714a, { rough: 1 });
  const roof = roofMat(palette, 0.94);
  const cloth = clothMat(palette);
  const width = 1.9;
  const depth = 1.15;
  const wall = 0.9;
  const baseY = 0.12;
  const eave = baseY + wall;

  plinth(builder, width, depth);
  builder.box([width, wall, depth], planks, 0, baseY + wall / 2, 0);
  for (let index = 0; index < 8; index += 1) {
    const x = -width / 2 + 0.14 + index * 0.23;
    builder.box([0.025, wall - 0.04, 0.025], DARK_MAT, x, baseY + wall / 2, depth / 2 + 0.002);
  }
  for (const x of [-width / 2 + 0.04, width / 2 - 0.04]) {
    for (const z of [-depth / 2 + 0.04, depth / 2 - 0.04]) {
      builder.box([0.08, wall, 0.08], TIMBER_MAT, x, baseY + wall / 2, z);
    }
  }
  builder.box([width + 0.02, 0.07, 0.05], TIMBER_MAT, 0, eave - 0.035, depth / 2 + 0.01);

  gambrelRoof(builder, roof, width, depth, 0.62, 0.14, eave, Math.PI / 2);
  gableEnd(builder, planks, width, depth, 0.62, eave, Math.PI / 2, "barn");

  const ridgeY = eave + 0.62;
  builder.box([0.3, 0.22, 0.3], planks, 0, ridgeY + 0.11, 0);
  for (const x of [-0.13, 0.13]) {
    for (const z of [-0.13, 0.13]) {
      builder.box([0.03, 0.22, 0.03], TIMBER_MAT, x, ridgeY + 0.11, z);
    }
  }
  builder.cone(0.25, 0.2, 4, roof, 0, ridgeY + 0.33, 0, Math.PI / 4);
  builder.cylinder(0.016, 0.016, 0.3, 5, IRON_MAT, 0, ridgeY + 0.52, 0);
  builder.box([0.2, 0.02, 0.025], IRON_MAT, 0.08, ridgeY + 0.63, 0);
  builder.box([0.08, 0.08, 0.025], IRON_MAT, 0, ridgeY + 0.55, 0);

  archDoor(builder, 0.6, 0.62, depth / 2 + 0.01, baseY, DARK_MAT);
  builder.box([0.5, 0.05, 0.05], TIMBER_MAT, 0, baseY + 0.4, depth / 2 + 0.06, 0, 0, 0.7);
  builder.box([0.5, 0.05, 0.05], TIMBER_MAT, 0, baseY + 0.4, depth / 2 + 0.06, 0, 0, -0.7);

  builder.box([0.03, 0.3, 0.06], TIMBER_MAT, -0.155, 1.12, depth / 2 + 0.005);
  builder.box([0.03, 0.3, 0.06], TIMBER_MAT, 0.155, 1.12, depth / 2 + 0.005);
  builder.box([0.34, 0.03, 0.06], TIMBER_MAT, 0, 1.27, depth / 2 + 0.005);
  builder.box([0.3, 0.17, 0.12], HAY_MAT, 0, 1.15, depth / 2 - 0.04);
  builder.box([0.03, 0.19, 0.14], DARK_MAT, 0, 1.15, depth / 2 - 0.04);

  const horseshoe = new THREE.TorusGeometry(0.1, 0.024, 5, 12, Math.PI);
  builder.add(
    horseshoe,
    cloth,
    new THREE.Vector3(0, 1.45, depth / 2 + 0.02),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI)),
  );

  return builder.finish();
}

function buildForge(palette: TeamPalette, variant: number): THREE.Group {
  const builder = new ModelBuilder();
  const roof = roofMat(palette, 0.9);
  const stone = material(variant % 2 === 0 ? STONE : 0x847b69, { rough: 1 });
  const radius = 0.58;
  const wall = 0.95;
  const baseY = 0.12;
  const eave = baseY + wall;

  builder.cylinder(0.8, 0.84, 0.12, 12, STONE_DARK_MAT, 0, 0.06, 0);
  builder.cylinder(radius, radius + 0.04, wall, 12, stone, 0, baseY + wall / 2, 0);
  for (const y of [0.28, 0.52, 0.76, 0.98]) {
    builder.cylinder(radius + 0.05, radius + 0.05, 0.018, 12, STONE_DARK_MAT, 0, y, 0);
  }

  builder.box([0.72, 0.78, 0.2], STONE_DARK_MAT, 0, 0.52, 0.48);
  builder.box([0.82, 0.07, 0.24], STONE_LIGHT_MAT, 0, 0.92, 0.48);
  builder.shape(archShape(0.58, 0.64), STONE_LIGHT_MAT, 0, 0.24, 0.585);
  builder.shape(archShape(0.5, 0.58), material(0x2a1c12), 0, 0.24, 0.598);
  const glow = material(0xff8b3a, { rough: 0.4, emissive: 0xff6a1e, emissiveIntensity: 1.8 });
  builder.shape(archShape(0.42, 0.5), glow, 0, 0.24, 0.606);
  for (const x of [-0.08, 0.08]) {
    builder.box([0.03, 0.4, 0.03], IRON_MAT, x, 0.46, 0.618);
  }
  builder.box([0.14, 0.22, 0.18], STONE_DARK_MAT, 0, 0.11, 0.68);

  builder.cone(0.8, 0.52, 12, roof, 0, eave + 0.26, 0);
  builder.cylinder(0.055, 0.055, 0.08, 8, edgeMat(palette), 0, eave + 0.55, 0);

  const coal = material(0x2b2622, { rough: 1 });
  builder.cone(0.26, 0.22, 8, coal, -0.22, 0.11, 0.62);
  for (const x of [-0.3, -0.2, -0.12]) {
    builder.box([0.045, 0.03, 0.045], material(0xff7a2a, { emissive: 0xff5a10, emissiveIntensity: 1.2 }), x, 0.14, 0.65);
  }

  builder.box([0.4, 1.85, 0.4], STONE_MAT, 0.32, 1.05, -0.3);
  for (let index = 0; index < 5; index += 1) {
    builder.box([0.42, 0.018, 0.42], STONE_LIGHT_MAT, 0.32, 0.5 + index * 0.3, -0.3);
  }
  builder.box([0.52, 0.09, 0.52], STONE_DARK_MAT, 0.32, 1.99, -0.3);
  builder.box([0.46, 0.07, 0.46], STONE_LIGHT_MAT, 0.32, 2.06, -0.3);
  builder.box([0.22, 0.06, 0.22], material(0x241c14), 0.32, 2.11, -0.3);

  builder.box([0.16, 0.22, 0.16], STONE_DARK_MAT, 0.76, 0.11, 0.7);
  builder.box([0.32, 0.09, 0.13], IRON_MAT, 0.76, 0.26, 0.7);
  builder.cone(0.06, 0.18, 5, IRON_MAT, 0.94, 0.26, 0.7, 0);
  builder.box([0.34, 0.06, 0.06], DARK_MAT, 0.76, 0.06, 0.7);

  builder.cylinder(0.07, 0.08, 0.26, 7, TIMBER_MAT, -0.66, 0.15, 0.48);
  crate(builder, -0.74, 0.16, 0.8);
  barrel(builder, -0.5, 0.78, 0.8);

  builder.cylinder(0.02, 0.02, 0.5, 5, IRON_MAT, 0.32, 2.36, -0.3);
  builder.shape(flagShape(0.3, 0.2), clothMat(palette), 0.34, 2.58, -0.3);

  return builder.finish();
}

const BUILDERS: Record<BuildingKind, (palette: TeamPalette, variant: number) => THREE.Group> = {
  hall: buildHall,
  range: buildRange,
  stable: buildStable,
  forge: buildForge,
};

export function buildBuilding(kind: BuildingKind, palette: TeamPalette, variant = 0): THREE.Group {
  const group = BUILDERS[kind](palette, variant);
  group.name = "building-" + kind;
  return group;
}

export function buildKeep(palette: TeamPalette, level: number): THREE.Group {
  const builder = new ModelBuilder();
  const roof = roofMat(palette);
  const edge = edgeMat(palette);
  const cloth = clothMat(palette);
  const width = 1.35;
  const depth = 1.25;
  const tower = 1.35 + (Math.min(3, Math.max(1, level)) - 1) * 0.3;
  const baseY = 0.14;
  const top = baseY + tower;

  builder.box([1.65, 0.14, 1.55], STONE_DARK_MAT, 0, 0.07, 0);
  builder.box([width, tower, depth], STONE_MAT, 0, baseY + tower / 2, 0);

  for (const x of [-width / 2 + 0.02, width / 2 - 0.02]) {
    for (const z of [-depth / 2 + 0.02, depth / 2 - 0.02]) {
      for (let index = 0; index < 4; index += 1) {
        const y = baseY + 0.18 + index * 0.28;
        if (y > top - 0.2) continue;
        builder.box([0.26, 0.13, 0.26], STONE_LIGHT_MAT, x, y, z);
      }
    }
  }

  builder.box([width + 0.13, 0.09, depth + 0.13], STONE_LIGHT_MAT, 0, top - 0.02, 0);
  const merlonY = top + 0.11;
  for (const z of [-depth / 2 + 0.02, depth / 2 - 0.02]) {
    for (const x of [-0.42, 0, 0.42]) {
      builder.box([0.24, 0.18, 0.15], STONE_LIGHT_MAT, x, merlonY, z);
    }
  }
  for (const x of [-width / 2 + 0.02, width / 2 - 0.02]) {
    for (const z of [-0.36, 0.04, 0.44]) {
      builder.box([0.15, 0.18, 0.24], STONE_LIGHT_MAT, x, merlonY, z);
    }
  }

  builder.cone(0.75, 0.55, 4, roof, 0, top + 0.315, 0, Math.PI / 4);
  builder.box([1.28, 0.05, 1.18], edge, 0, top + 0.02, 0);
  builder.cylinder(0.018, 0.018, 0.62, 5, IRON_MAT, 0.26, top + 0.78, 0);
  builder.shape(flagShape(0.3, 0.19), cloth, 0.28, top + 1.06, 0);

  archDoor(builder, 0.4, 0.6, depth / 2 + 0.01, baseY, DARK_MAT);
  builder.box([0.5, 0.07, 0.08], STONE_LIGHT_MAT, 0, baseY + 0.63, depth / 2 + 0.02);
  builder.box([0.72, 0.07, 0.26], STONE_LIGHT_MAT, 0, 0.09, depth / 2 + 0.13);
  builder.box([0.86, 0.07, 0.18], STONE_DARK_MAT, 0, 0.05, depth / 2 + 0.22);

  for (const x of [-0.48, 0.48]) {
    builder.box([0.09, 0.26, 0.04], DARK_MAT, x, 0.72, depth / 2 + 0.01);
    builder.box([0.09, 0.26, 0.04], DARK_MAT, x, top - 0.28, depth / 2 + 0.01);
  }
  builder.box([0.78, 0.04, 0.04], TIMBER_MAT, 0, 0.98, depth / 2 + 0.02);

  return builder.finish();
}

export interface BuildingPlacement {
  kind: BuildingKind;
  x: number;
  z: number;
  rotation: number;
}

const SLOTS: Array<{ x: number; z: number }> = [
  { x: -2.05, z: -0.85 },
  { x: 2.05, z: -0.85 },
  { x: -1.65, z: 1.65 },
  { x: 1.65, z: 1.65 },
];

export function townPlacements(level: number, seed: number): BuildingPlacement[] {
  const back: BuildingKind[] = (seed & 1) === 0 ? ["hall", "range"] : ["range", "hall"];
  const front: BuildingKind[] = (seed & 2) === 0 ? ["stable", "forge"] : ["forge", "stable"];
  const kinds: BuildingKind[] = [back[0], back[1], front[0], front[1]];
  const count = Math.min(4, Math.max(2, level + 1));
  return SLOTS.slice(0, count).map((slot, index) => ({
    kind: kinds[index],
    x: slot.x,
    z: slot.z,
    rotation: Math.atan2(-slot.x, -slot.z) + ((seed >> (index + 2)) & 1 ? 0.1 : -0.1),
  }));
}

export function buildTown(level: number, palette: TeamPalette, seed: number): THREE.Group {
  const group = new THREE.Group();
  const keep = buildKeep(palette, level);
  keep.position.set(0, 0, -2.3);
  group.add(keep);

  for (const placement of townPlacements(level, seed)) {
    const variant = Math.abs(seed + Math.round(placement.x * 3));
    const building = buildBuilding(placement.kind, palette, variant);
    building.position.set(placement.x, 0, placement.z);
    building.rotation.y = placement.rotation;
    group.add(building);
  }

  const props = new ModelBuilder();
  const cloth = clothMat(palette);
  if (level >= 2) {
    const water = material(0x4c7f8a, { rough: 0.35 });
    props.cylinder(0.86, 0.94, 0.26, 14, STONE_DARK_MAT, 0, 0.13, 0.35);
    props.cylinder(0.72, 0.72, 0.22, 14, water, 0, 0.15, 0.35);
    props.cylinder(0.18, 0.24, 0.68, 8, STONE_LIGHT_MAT, 0, 0.49, 0.35);
    props.cylinder(0.4, 0.4, 0.08, 12, STONE_LIGHT_MAT, 0, 0.85, 0.35);
    props.cylinder(0.07, 0.07, 0.24, 8, water, 0, 0.98, 0.35);
    for (const angle of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
      const x = Math.cos(angle) * 1.3;
      const z = 0.35 + Math.sin(angle) * 1.3;
      props.cylinder(0.09, 0.12, 0.12, 8, STONE_DARK_MAT, x, 0.06, z);
      props.cylinder(0.022, 0.022, 1.05, 6, DARK_MAT, x, 0.58, z);
      props.box([0.14, 0.18, 0.14], material(0xffcf8a, { emissive: 0xffb35e, emissiveIntensity: 0.8 }), x, 1.12, z);
      props.box([0.19, 0.04, 0.19], DARK_MAT, x, 1.23, z);
    }
  } else {
    props.cylinder(0.31, 0.33, 0.26, 10, STONE_DARK_MAT, 0, 0.13, 0.35);
    props.cylinder(0.23, 0.23, 0.27, 10, material(0x171310), 0, 0.14, 0.35);
    for (const x of [-0.3, 0.3]) {
      props.box([0.05, 0.56, 0.05], TIMBER_MAT, x, 0.45, 0.35);
    }
    props.box([0.78, 0.045, 0.05], TIMBER_MAT, 0, 0.71, 0.35);
    props.box([0.86, 0.06, 0.74], roofMat(palette, 0.9), 0, 0.78, 0.35, 0.56, 0, 0);
    props.cylinder(0.015, 0.015, 0.14, 5, IRON_MAT, 0.22, 0.66, 0.35);
  }

  const cartX = 0.15;
  const cartZ = 2.95;
  props.box([0.4, 0.08, 0.58], TIMBER_MAT, cartX, 0.26, cartZ, 0, 0.24, 0);
  props.box([0.03, 0.12, 0.62], TIMBER_MAT, cartX - 0.21, 0.31, cartZ - 0.02, 0, 0.24, 0);
  props.box([0.03, 0.12, 0.62], TIMBER_MAT, cartX + 0.21, 0.31, cartZ - 0.02, 0, 0.24, 0);
  for (const side of [-1, 1]) {
    props.cylinder(0.14, 0.14, 0.04, 10, TIMBER_MAT, cartX + side * 0.24, 0.15, cartZ - 0.08, 0, 0, Math.PI / 2);
    props.cylinder(0.04, 0.04, 0.05, 8, IRON_MAT, cartX + side * 0.25, 0.15, cartZ - 0.08, 0, 0, Math.PI / 2);
  }
  props.box([0.035, 0.035, 0.44], TIMBER_MAT, cartX - 0.13, 0.28, cartZ + 0.46, 0.2, 0.24, 0);
  props.box([0.035, 0.035, 0.44], TIMBER_MAT, cartX + 0.13, 0.28, cartZ + 0.46, 0.2, 0.24, 0);
  props.box([0.18, 0.16, 0.18], TIMBER_MAT, cartX - 0.05, 0.38, cartZ - 0.02, 0, 0.3, 0);

  for (const side of [-1, 1]) {
    const x = side * 1.0;
    const z = 3.15;
    props.cylinder(0.07, 0.09, 0.1, 8, STONE_MAT, x, 0.05, z);
    props.cylinder(0.022, 0.022, 1.2, 5, TIMBER_MAT, x, 0.62, z);
    props.shape(flagShape(0.3, 0.2), cloth, x + 0.02, 1.2, z);
  }

  group.add(props.finish());
  return group;
}


export function buildWall(level: number, palette: TeamPalette): THREE.Group {
  const builder = new ModelBuilder();
  const stone = level === 1 ? material(0x5c422c, { rough: 1 }) : material(0x6f736c, { rough: 1 });
  const crenel = level === 1 ? material(0x7a5a3a, { rough: 1 }) : material(0x9a9d92, { rough: 1 });
  const trim = level === 1 ? DARK_MAT : STONE_DARK_MAT;
  const cloth = clothMat(palette);
  const radius = 3.72;
  const segments = 30;
  const height = level === 1 ? 0.5 : 0.66;
  const thickness = level === 1 ? 0.15 : 0.26;
  const length = (Math.PI * 2 * radius) / segments + 0.03;
  const gateIndex = Math.round(segments * 0.25);

  for (let index = 0; index < segments; index += 1) {
    if (index === gateIndex || index === gateIndex - 1) continue;
    const angle = (index / segments) * Math.PI * 2;
    builder.box(
      [thickness, height, length],
      stone,
      Math.cos(angle) * radius,
      height / 2,
      Math.sin(angle) * radius,
      0,
      -angle,
      0,
    );
    if (index % 3 === 0) {
      builder.box(
        [0.42, 0.18, 0.3],
        crenel,
        Math.cos(angle) * radius,
        height + 0.1,
        Math.sin(angle) * radius,
        0,
        -angle,
        0,
      );
    }
  }

  for (let index = 0; index < segments; index += 8) {
    if (Math.abs(index - gateIndex) < 2) continue;
    const angle = (index / segments) * Math.PI * 2;
    builder.box(
      [0.32, height + 0.16, 0.32],
      crenel,
      Math.cos(angle) * radius,
      (height + 0.22) / 2,
      Math.sin(angle) * radius,
    );
  }

  for (const angle of [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4]) {
    const x = Math.cos(angle) * (radius + 0.14);
    const z = Math.sin(angle) * (radius + 0.14);
    builder.box([0.34, 0.4, 0.05], trim, x, 0.42, z, 0, Math.PI / 2 - angle, 0);
    builder.box([0.27, 0.32, 0.04], cloth, x + Math.cos(angle) * 0.03, 0.42, z + Math.sin(angle) * 0.03, 0, Math.PI / 2 - angle, 0);
  }

  const gateZ = radius;
  for (const x of [-0.82, 0.82]) {
    builder.box([0.3, 1.12, 0.3], trim, x, 0.56, gateZ);
  }
  builder.box([1.94, 0.16, 0.36], trim, 0, 1.1, gateZ);
  builder.shape(archShape(1.14, 0.98), material(0x2a1c12), 0, 0.02, gateZ + 0.02);
  for (const x of [-0.36, 0, 0.36]) {
    builder.box([0.06, 0.78, 0.02], IRON_MAT, x, 0.42, gateZ + 0.04);
  }
  builder.shape(bannerShape(0.3, 0.46), cloth, -0.98, 1.02, gateZ + 0.2);
  builder.shape(bannerShape(0.3, 0.46), cloth, 0.98, 1.02, gateZ + 0.2);

  return builder.finish();
}

export function paletteFor(owner: number): TeamPalette {
  return TEAM_PALETTES[owner] ?? TEAM_PALETTES[0];
}
