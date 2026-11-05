import * as THREE from "three";
import {
  BARN,
  PLASTERS,
  ModelBuilder,
  STONE,
  STONE_DARK,
  STONE_LIGHT,
  TIMBER,
  archShape,
  gableEnd,
  material,
  roofSlab,
  timberFrame,
  windowPanel,
} from "./building-kit";
import type { TeamPalette } from "./building-kit";
import {
  BURLAP_MAT,
  DARK_MAT,
  GLOW_MAT,
  GOLD_MAT,
  HAY_MAT,
  IRON_MAT,
  ORE_MAT,
  STONE_DARK_MAT,
  STONE_LIGHT_MAT,
  STONE_MAT,
  TIMBER_MAT,
  WATER_MAT,
  anvil,
  archDoor,
  barrel,
  bench,
  cart,
  clothMat,
  coalPile,
  crate,
  doorRect,
  edgeMat,
  fenceLine,
  hangingBanner,
  hayBale,
  horse,
  lamp,
  oreCart,
  pennant,
  plasterFor,
  plinth,
  roofMat,
  roundShield,
  sack,
  target,
  trainingDummy,
  weaponRack,
} from "./building-props";

export type BuildingKind =
  | "barbarian"
  | "warrior"
  | "ranger"
  | "archer"
  | "mage"
  | "tower"
  | "granary"
  | "mine";

export type BuildingLevel = 1 | 2 | 3;

export const BUILDING_KINDS: BuildingKind[] = [
  "barbarian",
  "warrior",
  "ranger",
  "archer",
  "mage",
  "tower",
  "granary",
  "mine",
];

export const BUILDING_NAMES: Record<BuildingKind, string> = {
  barbarian: "野蛮人营地",
  warrior: "精锐战士营",
  ranger: "游侠营地",
  archer: "弓箭手营",
  mage: "法师塔",
  tower: "弓箭塔",
  granary: "粮仓",
  mine: "矿区",
};

export const BUILDING_DESCRIPTIONS: Record<BuildingKind, string> = {
  barbarian: "战斧近战",
  warrior: "重甲剑盾",
  ranger: "双刃游走",
  archer: "远程弩手",
  mage: "奥术远程",
  tower: "远程塔楼",
  granary: "粮草储备",
  mine: "金属开采",
};

export interface BuildingSpec {
  footprint: number;
  height: number;
}

export const BUILDING_SPECS: Record<BuildingKind, BuildingSpec> = {
  barbarian: { footprint: 1.3, height: 2.6 },
  warrior: { footprint: 1.35, height: 2.5 },
  ranger: { footprint: 1.55, height: 2.5 },
  archer: { footprint: 1.35, height: 2.5 },
  mage: { footprint: 1.35, height: 3.2 },
  tower: { footprint: 1.05, height: 3.6 },
  granary: { footprint: 1.5, height: 3.1 },
  mine: { footprint: 1.6, height: 2.8 },
};

export function buildingFootprint(kind: BuildingKind, level: BuildingLevel): number {
  return BUILDING_SPECS[kind].footprint * (0.82 + level * 0.06);
}

function levelOf(value: number): BuildingLevel {
  if (value <= 1) return 1;
  if (value >= 3) return 3;
  return 2;
}

function swordSign(
  builder: ModelBuilder,
  palette: TeamPalette,
  x: number,
  y: number,
  z: number,
  scale = 1,
): void {
  builder.cylinder(0.13 * scale, 0.13 * scale, 0.03, 14, clothMat(palette), x, y, z, Math.PI / 2, 0, 0);
  builder.cylinder(0.155 * scale, 0.155 * scale, 0.02, 14, IRON_MAT, x, y, z - 0.012, Math.PI / 2, 0, 0);
  for (const side of [-1, 1]) {
    builder.box([0.03 * scale, 0.34 * scale, 0.02], IRON_MAT, x, y, z + 0.03, 0, 0, side * 0.64);
  }
}

function shieldSign(
  builder: ModelBuilder,
  palette: TeamPalette,
  x: number,
  y: number,
  z: number,
  radius = 0.24,
): void {
  roundShield(builder, palette, x, y, z, radius);
  builder.box([0.03, radius * 1.5, 0.02], GOLD_MAT, x, y, z + 0.03);
  builder.box([radius * 1.1, 0.03, 0.02], GOLD_MAT, x, y, z + 0.03);
}

function arrowSign(
  builder: ModelBuilder,
  palette: TeamPalette,
  x: number,
  y: number,
  z: number,
): void {
  builder.box([0.5, 0.34, 0.04], TIMBER_MAT, x, y, z);
  for (const offset of [-0.12, 0.12]) {
    builder.box([0.025, 0.3, 0.025], DARK_MAT, x + offset * 0.3, y, z + 0.03, 0, 0, offset > 0 ? -0.3 : 0.3);
    builder.box([0.08, 0.04, 0.02], clothMat(palette), x + offset * 0.3, y + 0.16, z + 0.04);
  }
}

function horseshoe(builder: ModelBuilder, palette: TeamPalette, x: number, y: number, z: number): void {
  const torus = new THREE.TorusGeometry(0.1, 0.024, 5, 12, Math.PI);
  builder.add(
    torus,
    clothMat(palette),
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI)),
  );
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
      const q = qY.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(side * angle, 0, 0)));
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
    new THREE.Matrix4().compose(new THREE.Vector3(0, eaveY + rise, 0), qY, new THREE.Vector3(1, 1, 1)),
  );
}

function rock(builder: ModelBuilder, x: number, y: number, z: number, sx: number, sy: number, sz: number): void {
  builder.addMatrix(
    new THREE.DodecahedronGeometry(1, 0),
    material(0x6d6a5e, { rough: 1 }),
    new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, 0.8, 0.1)),
      new THREE.Vector3(sx, sy, sz),
    ),
  );
}

function stoneYard(builder: ModelBuilder, width: number, depth: number, height = 0.34): void {
  builder.box([width, height, depth], STONE_MAT, 0, height / 2, 0);
  builder.box([width + 0.08, 0.06, depth + 0.08], STONE_LIGHT_MAT, 0, height + 0.03, 0);
}

function buildInfantry(palette: TeamPalette, level: BuildingLevel, variant: number): THREE.Group {
  const builder = new ModelBuilder();
  const tier = levelOf(level);
  const plaster = plasterFor(variant);
  const roof = roofMat(palette);
  const edge = edgeMat(palette);
  const width = 1.6 + (tier - 1) * 0.06;
  const depth = 1.25;
  const wall = 0.92 + (tier - 1) * 0.18;
  const baseY = 0.12;
  const eave = baseY + wall;

  plinth(builder, width, depth);
  builder.box([width, wall, depth], plaster, 0, baseY + wall / 2, 0);
  timberFrame(builder, width, depth, wall, baseY, TIMBER_MAT);
  roofSlab(builder, roof, width, depth, 0.55, 0.12, eave, 0);
  gableEnd(builder, plaster, depth, width, 0.55, eave, 0);
  builder.box([0.06, 0.09, depth + 0.28], edge, -width / 2 - 0.1, eave + 0.02, 0, -0.54, 0, 0);
  builder.box([0.06, 0.09, depth + 0.28], edge, width / 2 + 0.1, eave + 0.02, 0, -0.54, 0, 0);

  builder.box([0.95, 0.05, 0.44], edge, 0, eave - 0.02, depth / 2 + 0.2, 0.14, 0, 0);
  for (const x of [-0.42, 0.42]) {
    builder.box([0.07, 0.84, 0.07], TIMBER_MAT, x, baseY + 0.42, depth / 2 + 0.34);
    builder.box([0.05, 0.05, 0.26], TIMBER_MAT, x, eave - 0.06, depth / 2 + 0.3, 0.35, 0, 0);
  }

  doorRect(builder, 0.34, 0.56, depth / 2, baseY, DARK_MAT);
  builder.box([0.5, 0.05, 0.07], TIMBER_MAT, 0, baseY + 0.62, depth / 2 + 0.03);
  swordSign(builder, palette, 0, 1.06, depth / 2 + 0.24, 1);
  windowPanel(builder, -0.55, 0.6, depth / 2 + 0.005, DARK_MAT, GLOW_MAT);
  windowPanel(builder, 0.55, 0.6, depth / 2 + 0.005, DARK_MAT, GLOW_MAT);

  if (tier >= 2) {
    builder.box([width + 0.035, 0.3, depth + 0.035], STONE_MAT, 0, baseY + 0.15, 0);
    builder.box([0.58, 0.6, 0.72], plaster, -1.12, 0.3, 0.16);
    builder.box([0.72, 0.06, 0.88], roof, -1.12, 0.67, 0.16, 0, 0, -0.18);
    builder.box([0.06, 0.54, 0.06], TIMBER_MAT, -0.86, 0.27, 0.48);
    builder.box([0.06, 0.54, 0.06], TIMBER_MAT, -1.38, 0.27, 0.48);
    builder.box([0.2, 0.24, 0.04], DARK_MAT, -1.12, 0.4, 0.53);
    weaponRack(builder, 0.98, 1.0, 0.2);
    trainingDummy(builder, palette, -1.2, 1.0);
    crate(builder, 0.6, 1.08, 0.9);
    barrel(builder, 0.3, 1.08, 0.9);
  }
  if (tier >= 3) {
    builder.box([0.58, 1.35, 0.58], STONE_MAT, 0.86, 0.7, -0.62);
    builder.box([0.68, 0.08, 0.68], STONE_LIGHT_MAT, 0.86, 1.4, -0.62);
    builder.cone(0.46, 0.42, 4, roof, 0.86, 1.66, -0.62, Math.PI / 4);
    builder.box([0.5, 0.5, 0.2], STONE_MAT, 0.58, 0.27, -0.62);
    builder.box([0.6, 0.06, 0.26], STONE_LIGHT_MAT, 0.58, 0.55, -0.62);
    pennant(builder, palette, 0.86, 1.86, -0.62, 0.28, 0.22);
    hangingBanner(builder, palette, -0.62, eave + 0.08, depth / 2 + 0.02, 0.28, 0.36);
    weaponRack(builder, -0.86, 0.95, -0.2);
    fenceLine(builder, -1.15, 1.12, -0.2, 1.12, 0.34);
  }

  pennant(builder, palette, 0.42, eave + 0.5, -0.1);
  return builder.finish();
}

function buildShield(palette: TeamPalette, level: BuildingLevel, variant: number): THREE.Group {
  const builder = new ModelBuilder();
  const tier = levelOf(level);
  const roof = roofMat(palette, 0.96);
  const stone = material(variant % 2 === 0 ? STONE : 0x87806e, { rough: 1 });
  const width = 1.45;
  const depth = 1.35;
  const wall = 0.82 + (tier - 1) * 0.18;
  const baseY = 0.12;
  const eave = baseY + wall;

  plinth(builder, width + 0.1, depth + 0.1, 0.16);
  builder.box([width + 0.12, 0.24, depth + 0.12], STONE_DARK_MAT, 0, 0.25, 0);
  builder.box([width, wall, depth], stone, 0, baseY + wall / 2, 0);
  for (let row = 0; row < 4; row += 1) {
    builder.box([width + 0.02, 0.02, depth + 0.02], STONE_DARK_MAT, 0, 0.42 + row * 0.16, 0);
  }
  for (const x of [-width / 2 + 0.03, width / 2 - 0.03]) {
    for (const z of [-depth / 2 + 0.03, depth / 2 - 0.03]) {
      for (let row = 0; row < 3; row += 1) {
        builder.box([0.22, 0.12, 0.22], STONE_LIGHT_MAT, x, 0.4 + row * 0.26, z);
      }
    }
  }

  roofSlab(builder, roof, width, depth, 0.44, 0.12, eave, 0);
  gableEnd(builder, stone, depth, width, 0.44, eave, 0);
  builder.box([width + 0.28, 0.08, 0.2], edgeMat(palette), 0, eave + 0.03, depth / 2 + 0.06);
  builder.box([width + 0.28, 0.08, 0.2], edgeMat(palette), 0, eave + 0.03, -depth / 2 - 0.06);

  archDoor(builder, 0.42, 0.56, depth / 2 + 0.02, baseY, DARK_MAT);
  shieldSign(builder, palette, 0, 1.02, depth / 2 + 0.06, 0.24);
  builder.box([0.62, 0.04, 0.04], GOLD_MAT, 0, 1.35, depth / 2 + 0.04);

  if (tier >= 2) {
    const turretX = -0.82;
    const turretZ = -0.62;
    builder.cylinder(0.31, 0.35, 1.45, 10, stone, turretX, 0.85, turretZ);
    builder.cylinder(0.37, 0.37, 0.08, 10, STONE_LIGHT_MAT, turretX, 1.59, turretZ);
    builder.cone(0.46, 0.4, 8, roof, turretX, 1.82, turretZ);
    builder.cone(0.04, 0.14, 5, IRON_MAT, turretX, 2.06, turretZ);
    for (const x of [0.38, 0.66]) {
      roundShield(builder, palette, x, 0.55, depth / 2 + 0.06, 0.14);
    }
    builder.box([0.5, 0.3, 0.06], TIMBER_MAT, 0.52, 0.3, depth / 2 + 0.04);
  }
  if (tier >= 3) {
    const turretX = 0.82;
    const turretZ = -0.62;
    builder.cylinder(0.31, 0.35, 1.7, 10, stone, turretX, 0.95, turretZ);
    builder.cylinder(0.37, 0.37, 0.08, 10, STONE_LIGHT_MAT, turretX, 1.84, turretZ);
    builder.cone(0.46, 0.42, 8, roof, turretX, 2.06, turretZ);
    builder.cone(0.04, 0.16, 5, GOLD_MAT, turretX, 2.32, turretZ);
    builder.box([1.5, 0.42, 0.18], STONE_DARK_MAT, 0, 0.21, 0.92);
    builder.box([1.62, 0.56, 0.2], STONE_MAT, 0, 0.34, -0.62);
    builder.box([1.7, 0.06, 0.26], STONE_LIGHT_MAT, 0, 0.66, -0.62);
    for (const x of [-0.6, -0.2, 0.2, 0.6]) {
      builder.box([0.24, 0.18, 0.24], STONE_LIGHT_MAT, x, 0.78, -0.62);
    }
    for (const x of [-0.5, 0, 0.5]) {
      roundShield(builder, palette, x, 0.42, 1.02, 0.11);
    }
    hangingBanner(builder, palette, -0.58, 1.22, depth / 2 + 0.06, 0.3, 0.42);
    hangingBanner(builder, palette, 0.58, 1.22, depth / 2 + 0.06, 0.3, 0.42);
    crate(builder, -0.9, 1.0, 0.8);
  }

  return builder.finish();
}

function buildCavalry(palette: TeamPalette, level: BuildingLevel, variant: number): THREE.Group {
  const builder = new ModelBuilder();
  const tier = levelOf(level);
  const planks = material(variant % 2 === 0 ? BARN : 0x94714a, { rough: 1 });
  const roof = roofMat(palette, 0.95);
  const width = 1.85;
  const depth = 1.2;
  const wall = 0.82 + (tier - 1) * 0.12;
  const baseY = 0.12;
  const eave = baseY + wall;
  const ridge = eave + 0.6;

  plinth(builder, width, depth);
  builder.box([width, wall, depth], planks, 0, baseY + wall / 2, 0);
  for (let index = 0; index < 8; index += 1) {
    builder.box([0.025, wall - 0.04, 0.025], DARK_MAT, -width / 2 + 0.14 + index * 0.23, baseY + wall / 2, depth / 2 + 0.002);
  }
  timberFrame(builder, width, depth, wall, baseY, TIMBER_MAT);
  gambrelRoof(builder, roof, width, depth, 0.6, 0.14, eave, Math.PI / 2);
  gableEnd(builder, planks, width, depth, 0.6, eave, Math.PI / 2, "barn");

  archDoor(builder, 0.58, 0.6, depth / 2 + 0.01, baseY, DARK_MAT);
  builder.box([0.5, 0.05, 0.05], TIMBER_MAT, 0, baseY + 0.4, depth / 2 + 0.06, 0, 0, 0.7);
  builder.box([0.5, 0.05, 0.05], TIMBER_MAT, 0, baseY + 0.4, depth / 2 + 0.06, 0, 0, -0.7);
  horseshoe(builder, palette, 0, 1.3, depth / 2 + 0.04);
  builder.box([0.3, 0.03, 0.06], TIMBER_MAT, 0, 1.18, depth / 2 + 0.02);
  builder.box([0.3, 0.17, 0.12], HAY_MAT, 0, 1.02, depth / 2 - 0.04);

  const cupola = ridge + 0.02;
  builder.box([0.3, 0.2, 0.3], planks, 0, cupola + 0.1, 0);
  builder.cone(0.25, 0.18, 4, roof, 0, cupola + 0.29, 0, Math.PI / 4);
  builder.cylinder(0.015, 0.015, 0.28, 5, IRON_MAT, 0, cupola + 0.48, 0);
  builder.box([0.18, 0.02, 0.025], IRON_MAT, 0.07, cupola + 0.58, 0);

  if (tier >= 2) {
    fenceLine(builder, 0.95, 0.72, 0.95, -0.62, 0.42);
    fenceLine(builder, 0.95, -0.62, 1.55, -0.62, 0.42);
    fenceLine(builder, 1.55, -0.62, 1.55, 0.72, 0.42);
    horse(builder, palette, 1.22, 0.22, Math.PI / 2, 0.82);
    horse(builder, palette, 1.22, -0.28, -Math.PI / 2, 0.78);
    builder.box([0.3, 0.16, 0.22], TIMBER_MAT, 1.3, 0.08, 0.62);
    builder.box([0.24, 0.05, 0.16], WATER_MAT, 1.3, 0.17, 0.62);
    crate(builder, -0.95, 0.95, 0.9);
  } else {
    horse(builder, palette, 1.15, 0.35, Math.PI / 2, 0.8);
  }
  if (tier >= 3) {
    builder.box([0.52, 1.55, 0.52], STONE_MAT, -1.22, 0.78, -0.3);
    builder.box([0.62, 0.07, 0.62], STONE_LIGHT_MAT, -1.22, 1.58, -0.3);
    builder.cone(0.46, 0.42, 4, roof, -1.22, 1.85, -0.3, Math.PI / 4);
    builder.box([0.34, 0.5, 0.18], STONE_MAT, -1.0, 0.25, -0.3);
    builder.box([0.4, 0.06, 0.24], STONE_LIGHT_MAT, -1.0, 0.53, -0.3);
    pennant(builder, palette, -1.22, 2.05, -0.3, 0.26, 0.2);
    horse(builder, palette, 1.35, 0.72, -0.4, 0.74);
    hayBale(builder, -1.02, 0.95, 1);
    cart(builder, 1.3, 0.95, -0.5);
    fenceLine(builder, -1.1, 1.08, 0.55, 1.08, 0.36);
  }

  return builder.finish();
}

function buildArcher(palette: TeamPalette, level: BuildingLevel, variant: number): THREE.Group {
  const builder = new ModelBuilder();
  const tier = levelOf(level);
  const roof = roofMat(palette);
  const plaster = plasterFor(variant + 1);
  const width = 1.55;
  const depth = 1.15;
  const wall = 0.62 + (tier - 1) * 0.06;
  const baseY = 0.12;
  const eave = baseY + wall + 0.35;

  plinth(builder, width, depth);
  builder.box([width + 0.14, 0.2, depth + 0.14], STONE_DARK_MAT, 0, 0.16, 0);
  for (const x of [-0.68, 0, 0.68]) {
    for (const z of [-0.48, 0.48]) {
      builder.box([0.08, 1.25 + (tier - 1) * 0.16, 0.08], TIMBER_MAT, x, 0.2 + (1.25 + (tier - 1) * 0.16) / 2, z);
    }
  }
  for (const z of [-0.48, 0.48]) {
    builder.box([width, 0.06, 0.06], TIMBER_MAT, 0, eave - 0.03, z);
  }
  builder.box([width + 0.1, 0.22, depth + 0.1], plaster, 0, 0.38, 0);
  builder.box([width + 0.18, 0.1, 0.12], TIMBER_MAT, 0, 0.26, depth / 2 + 0.02);
  roofSlab(builder, roof, width + 0.1, depth + 0.1, 0.52, 0.13, eave, 0);
  gableEnd(builder, plaster, depth + 0.1, width + 0.1, 0.52, eave, 0);

  doorRect(builder, 0.34, 0.48, depth / 2, baseY, DARK_MAT);
  arrowSign(builder, palette, 0.42, 1.12, depth / 2 + 0.05);
  windowPanel(builder, -0.5, 0.72, depth / 2 + 0.005, DARK_MAT, GLOW_MAT);

  target(builder, -0.92, 0.72, 0.34, 0.9);
  target(builder, -1.16, 0.45, 0.34, 0.9);
  builder.box([0.22, 0.32, 0.16], TIMBER_MAT, 0.62, 0.3, 0.72);
  for (const y of [0.38, 0.48]) {
    builder.cylinder(0.012, 0.012, 0.36, 4, TIMBER_MAT, 0.62, y, 0.72, 0, 0, 0.3);
  }

  if (tier >= 2) {
    fenceLine(builder, 0.82, 0.95, 1.5, 0.95, 0.4);
    fenceLine(builder, 1.5, 0.95, 1.5, -0.35, 0.4);
    target(builder, 1.12, 0.55, 0.38, 1);
    target(builder, 1.3, 0.2, 0.38, 1);
    target(builder, 1.05, -0.1, 0.38, 1);
    builder.box([0.5, 0.04, 0.3], TIMBER_MAT, 1.2, 0.07, 0.72);
    for (const x of [1.0, 1.2, 1.4]) {
      builder.box([0.02, 0.34, 0.02], TIMBER_MAT, x, 0.26, 0.72, 0.2, 0, 0);
      builder.box([0.05, 0.08, 0.01], clothMat(palette), x, 0.42, 0.72);
    }
  }
  if (tier >= 3) {
    builder.box([0.44, 1.55, 0.44], TIMBER_MAT, -1.02, 0.77, -0.42);
    builder.box([0.56, 0.07, 0.56], TIMBER_MAT, -1.02, 1.58, -0.42);
    for (const x of [-0.84, -0.4]) {
      for (const z of [-0.64, -0.2]) {
        builder.box([0.05, 0.38, 0.05], TIMBER_MAT, x, 1.77, z);
      }
    }
    builder.box([0.62, 0.05, 0.06], TIMBER_MAT, -1.02, 1.95, 0.2);
    builder.cone(0.42, 0.34, 4, roof, -1.02, 2.05, -0.42, Math.PI / 4);
    pennant(builder, palette, -1.02, 2.25, -0.42, 0.3, 0.22);
    target(builder, -1.12, 0.9, 0.35, 0.9);
    hangingBanner(builder, palette, 0.0, eave + 0.08, depth / 2 + 0.2, 0.3, 0.38);
    crate(builder, -0.98, 0.68, 0.8);
  }

  pennant(builder, palette, 0.5, eave + 0.42, 0.1, 0.28, 0.2);
  return builder.finish();
}

function buildElite(palette: TeamPalette, level: BuildingLevel, variant: number): THREE.Group {
  const builder = new ModelBuilder();
  const tier = levelOf(level);
  const plaster = material(0xe0d3b6, { rough: 0.92 });
  const roof = roofMat(palette);
  const edge = edgeMat(palette);
  const width = 1.6;
  const depth = 1.3;
  const wall = 1.05 + (tier - 1) * 0.2;
  const baseY = 0.16;
  const eave = baseY + wall;

  plinth(builder, width, depth, 0.16);
  builder.box([width + 0.08, 0.4, depth + 0.08], STONE_MAT, 0, 0.2 + 0.2, 0);
  builder.box([width, wall, depth], plaster, 0, baseY + 0.2 + wall / 2, 0);
  timberFrame(builder, width, depth, wall, baseY + 0.2, TIMBER_MAT);
  for (const x of [-width / 2 - 0.02, width / 2 + 0.02]) {
    builder.box([0.06, 0.06, depth + 0.02], GOLD_MAT, x, eave - 0.05, 0);
  }
  roofSlab(builder, roof, width, depth, 0.72, 0.14, eave, 0);
  gableEnd(builder, plaster, depth, width, 0.72, eave, 0);
  builder.box([width + 0.3, 0.07, 0.16], edge, 0, eave + 0.03, depth / 2 + 0.08);
  builder.box([width + 0.3, 0.07, 0.16], edge, 0, eave + 0.03, -depth / 2 - 0.08);
  builder.box([width + 0.34, 0.05, 0.1], GOLD_MAT, 0, eave + 0.72, 0);

  doorRect(builder, 0.38, 0.62, depth / 2, baseY + 0.2, DARK_MAT);
  builder.box([0.62, 0.05, 0.07], GOLD_MAT, 0, baseY + 0.88, depth / 2 + 0.03);
  builder.cylinder(0.16, 0.16, 0.03, 14, GOLD_MAT, 0, 1.18, depth / 2 + 0.05, Math.PI / 2, 0, 0);
  builder.cylinder(0.13, 0.13, 0.035, 14, clothMat(palette), 0, 1.18, depth / 2 + 0.065, Math.PI / 2, 0, 0);
  for (const side of [-1, 1]) {
    builder.box([0.03, 0.3, 0.02], GOLD_MAT, 0, 1.2, depth / 2 + 0.09, 0, 0, side * 0.62);
  }
  hangingBanner(builder, palette, -0.58, 1.42, depth / 2 + 0.04, 0.26, 0.5);
  hangingBanner(builder, palette, 0.58, 1.42, depth / 2 + 0.04, 0.26, 0.5);

  if (tier >= 2) {
    for (const x of [-0.52, 0.52]) {
      builder.cylinder(0.075, 0.09, 0.8, 8, STONE_LIGHT_MAT, x, 0.5, depth / 2 + 0.46);
      builder.box([0.18, 0.05, 0.18], GOLD_MAT, x, 0.9, depth / 2 + 0.46);
    }
    builder.box([1.32, 0.09, 0.5], roof, 0, 1.02, depth / 2 + 0.42, 0.12, 0, 0);
    builder.box([1.4, 0.05, 0.06], GOLD_MAT, 0, 0.95, depth / 2 + 0.64);
    builder.box([0.9, 0.03, 0.06], GOLD_MAT, 0, eave + 0.35, depth / 2 + 0.14);
    crate(builder, -0.95, 1.05, 0.8);
    barrel(builder, 0.95, 1.0, 0.8);
  }
  if (tier >= 3) {
    builder.box([0.62, 1.85, 0.62], STONE_MAT, -0.88, 0.92, -0.7);
    builder.box([0.5, 0.55, 0.2], STONE_MAT, -0.55, 0.28, -0.7);
    builder.box([0.58, 0.06, 0.26], STONE_LIGHT_MAT, -0.55, 0.58, -0.7);
    builder.box([0.74, 0.08, 0.74], STONE_LIGHT_MAT, -0.88, 1.88, -0.7);
    builder.cone(0.5, 0.5, 4, roof, -0.88, 2.15, -0.7, Math.PI / 4);
    builder.cone(0.05, 0.18, 5, GOLD_MAT, -0.88, 2.46, -0.7);
    builder.box([0.58, 0.03, 0.58], GOLD_MAT, -0.88, 1.9, -0.7);
    pennant(builder, palette, -0.88, 2.5, -0.7, 0.3, 0.22);
    for (const x of [0.42, 0.68]) {
      builder.cylinder(0.1, 0.12, 0.5, 8, STONE_LIGHT_MAT, x, 0.25, 1.02);
    }
    builder.box([0.7, 0.05, 0.3], roof, 0.55, 0.55, 1.02);
    trainingDummy(builder, palette, 1.0, 0.85);
    weaponRack(builder, 0.95, 0.2, 0.4);
  }

  pennant(builder, palette, 0.46, eave + 0.66, 0, 0.32, 0.22);
  return builder.finish();
}

function buildTower(palette: TeamPalette, level: BuildingLevel, variant: number): THREE.Group {
  const builder = new ModelBuilder();
  const tier = levelOf(level);
  const roof = roofMat(palette);
  const stone = material(variant % 2 === 0 ? STONE : 0x837c6b, { rough: 1 });
  const width = 0.74 + (tier - 1) * 0.05;
  const depth = 0.74 + (tier - 1) * 0.05;
  const baseH = tier >= 2 ? 0.5 : 0.3;
  const bodyH = 0.95 + (tier - 1) * 0.22;
  const bodyTop = baseH + bodyH;

  plinth(builder, 0.9, 0.9);
  builder.box([0.82, baseH, 0.82], stone, 0, 0.12 + baseH / 2, 0);
  builder.box([width, bodyH, depth], material(PLASTERS[(variant + 1) % PLASTERS.length], { rough: 0.95 }), 0, 0.12 + baseH + bodyH / 2, 0);

  if (tier >= 2) {
    for (const x of [-width / 2, width / 2]) {
      for (const z of [-depth / 2, depth / 2]) {
        builder.box([0.09, bodyH, 0.09], TIMBER_MAT, x, 0.12 + baseH + bodyH / 2, z);
      }
    }
  }

  const deckY = 0.12 + bodyTop;
  const deckSize = 1.15 + (tier - 1) * 0.12;
  builder.box([deckSize, 0.09, deckSize], material(0x7a5a3a, { rough: 0.95 }), 0, deckY + 0.045, 0);
  const postBase = deckY + 0.09;
  const postH = 0.5 + (tier - 1) * 0.1;
  for (const x of [-deckSize / 2 + 0.06, deckSize / 2 - 0.06]) {
    for (const z of [-deckSize / 2 + 0.06, deckSize / 2 - 0.06]) {
      builder.box([0.06, postH, 0.06], TIMBER_MAT, x, postBase + postH / 2, z);
    }
  }
  for (const y of [postBase + 0.16, postBase + postH - 0.12]) {
    for (const side of [-1, 1]) {
      builder.box([deckSize - 0.02, 0.035, 0.035], TIMBER_MAT, 0, y, side * (deckSize / 2 - 0.06));
      builder.box([0.035, 0.035, deckSize - 0.02], TIMBER_MAT, side * (deckSize / 2 - 0.06), y, 0);
    }
  }
  for (const side of [-1, 1]) {
    builder.box([deckSize + 0.06, 0.05, 0.08], TIMBER_MAT, 0, postBase + postH, side * (deckSize / 2 - 0.06));
    builder.box([0.08, 0.05, deckSize + 0.06], TIMBER_MAT, side * (deckSize / 2 - 0.06), postBase + postH, 0);
  }

  if (tier >= 3) {
    builder.box([deckSize - 0.1, 0.05, 0.05], TIMBER_MAT, 0, postBase + postH + 0.5, 0);
    builder.cone(deckSize * 0.62, 0.36, 4, roof, 0, postBase + postH + 0.2, 0, Math.PI / 4);
    builder.cylinder(0.015, 0.015, 0.4, 5, IRON_MAT, 0, postBase + postH + 0.5, 0);
    pennant(builder, palette, 0.34, postBase + postH + 0.3, -0.34, 0.24, 0.18);
  } else {
    builder.cylinder(0.022, 0.026, 1.05, 5, TIMBER_MAT, 0.42, postBase + 0.9, -0.4);
    pennant(builder, palette, 0.42, postBase + postH + 0.18, -0.4, 0.3, 0.22);
  }

  archDoor(builder, 0.28, 0.46, depth / 2 + 0.02, 0.34, DARK_MAT);
  for (const y of [0.95, 1.3]) {
    if (y < 0.12 + baseH + bodyH - 0.08) {
      builder.box([0.06, 0.16, 0.04], DARK_MAT, 0, y, depth / 2 + 0.012);
    }
  }

  target(builder, -0.55, 0.55, 0.33, 0.85);
  target(builder, 0.55, 0.55, 0.33, 0.85);
  if (tier >= 2) {
    builder.box([0.34, 0.02, 0.34], DARK_MAT, 0, deckY + 0.1, 0.1);
    builder.cylinder(0.08, 0.1, 0.14, 8, material(0x9a7a3a, { rough: 0.45, metal: 0.5 }), 0, postBase + 0.28, -0.3);
    builder.box([0.05, 0.05, 0.05], GOLD_MAT, 0.36, postBase + 0.5, 0.36);
    pennant(builder, palette, 0.36, postBase + 0.35, 0.36, 0.22, 0.16);
  }
  if (tier >= 3) {
    builder.box([0.62, 0.06, 0.62], TIMBER_MAT, 0, deckY + 0.12, 0);
    builder.cylinder(0.09, 0.11, 0.16, 8, material(0x9a7a3a, { rough: 0.45, metal: 0.5 }), 0, postBase + 0.3, 0);
    for (const x of [-0.45, 0.45]) {
      builder.box([0.06, 0.06, 0.5], TIMBER_MAT, x, postBase + postH + 0.06, 0);
    }
    crate(builder, -0.95, 0.7, 0.8);
  }

  return builder.finish();
}

function buildGranary(palette: TeamPalette, level: BuildingLevel, variant: number): THREE.Group {
  const builder = new ModelBuilder();
  const tier = levelOf(level);
  const roof = roofMat(palette);
  const planks = material(variant % 2 === 0 ? 0x9a784d : 0x8d6d45, { rough: 1 });
  const width = 1.55;
  const depth = 1.05;
  const floorY = 0.38 + (tier - 1) * 0.04;
  const wall = 0.66 + (tier - 1) * 0.1;
  const eave = floorY + wall;

  plinth(builder, width + 0.1, depth + 0.1);
  for (const x of [-0.52, 0, 0.52]) {
    for (const z of [-0.34, 0.34]) {
      builder.box([0.09, floorY, 0.09], STONE_DARK_MAT, x, floorY / 2, z);
    }
  }
  builder.box([width, 0.07, depth], planks, 0, floorY, 0);
  builder.box([width, wall, depth], planks, 0, floorY + wall / 2, 0);
  for (let index = 0; index < 6; index += 1) {
    builder.box([0.025, wall - 0.03, 0.025], DARK_MAT, -width / 2 + 0.14 + index * 0.26, floorY + wall / 2, depth / 2 + 0.002);
  }
  roofSlab(builder, roof, width, depth, 0.52, 0.13, eave, 0);
  gableEnd(builder, planks, depth, width, 0.52, eave, 0);
  archDoor(builder, 0.44, 0.44, depth / 2 + 0.01, floorY + 0.02, DARK_MAT);
  builder.box([0.5, 0.05, 0.4], TIMBER_MAT, 0, floorY + 0.02, depth / 2 + 0.28, -0.18, 0, 0);
  for (const x of [-0.5, 0, 0.5]) {
    builder.box([0.22, 0.06, 0.06], TIMBER_MAT, x, floorY + wall - 0.06, depth / 2 + 0.01);
  }

  sack(builder, -0.95, 0.7, 1.1);
  sack(builder, -0.72, 0.82, 0.9);
  sack(builder, 0.78, 0.75, 1);
  hayBale(builder, 0.95, 0.35, 0.9);
  crate(builder, -0.92, 0.28, 0.8);

  if (tier >= 2) {
    builder.cylinder(0.32, 0.36, 1.1, 10, planks, 1.08, 0.65, -0.42);
    builder.box([0.5, 0.06, 0.5], STONE_LIGHT_MAT, 1.08, 1.22, -0.42);
    builder.cone(0.42, 0.38, 8, roof, 1.08, 1.44, -0.42);
    builder.box([0.3, 0.12, 0.3], TIMBER_MAT, 1.08, 1.3, -0.42);
    sack(builder, 1.3, 0.35, 0.9);
    sack(builder, 0.55, 0.95, 0.9);
    cart(builder, 0.95, 0.9, 0.6);
    fenceLine(builder, -1.1, 0.95, 0.45, 0.95, 0.34);
  }
  if (tier >= 3) {
    const millX = -1.5;
    const millZ = -0.45;
    builder.cylinder(0.36, 0.46, 1.65, 10, STONE_MAT, millX, 0.9, millZ);
    builder.cylinder(0.42, 0.42, 0.08, 10, STONE_LIGHT_MAT, millX, 1.75, millZ);
    builder.cone(0.5, 0.46, 8, roof, millX, 2.01, millZ);
    builder.cylinder(0.06, 0.06, 0.18, 6, TIMBER_MAT, millX, 1.72, millZ + 0.5, Math.PI / 2, 0, 0);
    const hub = new THREE.Vector3(millX, 1.72, millZ + 0.6);
    for (const angle of [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4]) {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, angle));
      const offset = new THREE.Vector3(0, 0.5, 0).applyQuaternion(q);
      builder.addMatrix(
        new THREE.BoxGeometry(0.13, 0.9, 0.035),
        TIMBER_MAT,
        new THREE.Matrix4().compose(new THREE.Vector3(hub.x + offset.x, hub.y + offset.y, hub.z), q, new THREE.Vector3(1, 1, 1)),
      );
      const lattice = new THREE.Vector3(0, 0.32, 0).applyQuaternion(q);
      builder.addMatrix(
        new THREE.BoxGeometry(0.42, 0.035, 0.045),
        TIMBER_MAT,
        new THREE.Matrix4().compose(new THREE.Vector3(hub.x + lattice.x, hub.y + lattice.y, hub.z + 0.01), q, new THREE.Vector3(1, 1, 1)),
      );
    }
    builder.cylinder(0.1, 0.1, 0.08, 8, IRON_MAT, millX, 1.72, millZ + 0.62, Math.PI / 2, 0, 0);
    for (const x of [-0.8, 0.4]) {
      sack(builder, x, -0.85, 1.1);
    }
    fenceLine(builder, -1.25, -0.95, 0.2, -0.95, 0.36);
    lamp(builder, 0.5, 0.85, 1.0);
  }

  return builder.finish();
}

function buildMine(palette: TeamPalette, level: BuildingLevel, variant: number): THREE.Group {
  const builder = new ModelBuilder();
  const tier = levelOf(level);
  const roof = roofMat(palette, 0.9);
  const stone = material(variant % 2 === 0 ? 0x7c7666 : 0x8a8270, { rough: 1 });

  const growth = 1 + (tier - 1) * 0.1;
  rock(builder, -0.35, 0.62, -0.38, 1.15 * growth, 0.82 * growth, 0.95 * growth);
  rock(builder, 0.55, 0.45, -0.48, 0.82 * growth, 0.62 * growth, 0.72 * growth);
  rock(builder, 0.1, 0.22, -0.1, 1.3 * growth, 0.42 * growth, 1.05 * growth);
  for (const [x, y, z] of [[-0.7, 0.85, -0.2], [0.4, 0.7, -0.55], [0.15, 0.45, 0.25]] as Array<[number, number, number]>) {
    builder.add(new THREE.DodecahedronGeometry(0.09, 0), ORE_MAT, new THREE.Vector3(x, y, z));
  }

  builder.shape(archShape(0.6, 0.82), material(0x171310), -0.2, 0.06, 0.62);
  builder.box([0.1, 0.9, 0.14], TIMBER_MAT, -0.54, 0.45, 0.64);
  builder.box([0.1, 0.9, 0.14], TIMBER_MAT, 0.14, 0.45, 0.64);
  builder.box([0.78, 0.12, 0.18], TIMBER_MAT, -0.2, 0.92, 0.64);
  builder.box([0.66, 0.08, 0.14], TIMBER_MAT, -0.2, 1.02, 0.64);

  for (const x of [-0.36, -0.04]) {
    builder.box([0.035, 0.03, 1.35], IRON_MAT, x, 0.035, 0.95);
  }
  for (let index = 0; index < 6; index += 1) {
    builder.box([0.44, 0.03, 0.07], TIMBER_MAT, -0.2, 0.02, 0.42 + index * 0.22);
  }
  oreCart(builder, -0.2, 1.12, 0);

  if (tier >= 2) {
    for (const x of [-0.58, 0.18]) {
      builder.box([0.09, 1.7, 0.09], TIMBER_MAT, x, 0.85, 0.08);
    }
    builder.box([0.9, 0.1, 0.14], TIMBER_MAT, -0.2, 1.72, 0.08);
    builder.box([0.09, 0.09, 0.5], TIMBER_MAT, -0.58, 1.52, 0.3, 0.5, 0, 0);
    builder.box([0.09, 0.09, 0.5], TIMBER_MAT, 0.18, 1.52, 0.3, 0.5, 0, 0);
    builder.cylinder(0.18, 0.18, 0.05, 10, IRON_MAT, -0.2, 1.72, 0.3, 0, 0, Math.PI / 2);
    builder.cylinder(0.05, 0.05, 0.06, 8, GOLD_MAT, -0.2, 1.72, 0.33, 0, 0, Math.PI / 2);
    builder.box([0.03, 0.55, 0.03], IRON_MAT, -0.2, 1.45, 0.3);
    oreCart(builder, 0.4, 1.0, 0.3);
    crate(builder, -0.95, 0.6, 1);
    oreCart(builder, 0.8, 0.55, -0.4);
    builder.add(new THREE.DodecahedronGeometry(0.12, 0), ORE_MAT, new THREE.Vector3(0.62, 0.12, 0.42));
    builder.add(new THREE.DodecahedronGeometry(0.09, 0), ORE_MAT, new THREE.Vector3(0.8, 0.09, 0.25));
  }
  if (tier >= 3) {
    builder.box([0.62, 0.7, 0.62], stone, 0.92, 0.35, -0.15);
    builder.box([0.72, 0.07, 0.72], STONE_LIGHT_MAT, 0.92, 0.73, -0.15);
    builder.cone(0.42, 0.3, 4, roof, 0.92, 0.9, -0.15, Math.PI / 4);
    builder.box([0.18, 0.32, 0.04], DARK_MAT, 0.92, 0.3, 0.2);
    builder.box([0.12, 0.24, 0.12], STONE_DARK_MAT, 1.18, 0.86, -0.4);
    builder.cone(0.14, 0.18, 8, STONE_DARK_MAT, 1.18, 1.06, -0.4);
    builder.box([0.05, 0.05, 1.1], TIMBER_MAT, 0.92, 0.78, 0.2);
    builder.box([0.42, 0.05, 0.05], TIMBER_MAT, 0.72, 0.78, 0.62);
    builder.box([0.03, 0.4, 0.03], IRON_MAT, 0.72, 0.6, 0.62);
    builder.box([0.18, 0.12, 0.18], ORE_MAT, 0.72, 0.08, 0.62);
    for (const [x, z] of [[-1.0, 0.35], [0.45, 0.7], [-0.7, 0.85]] as Array<[number, number]>) {
      builder.add(new THREE.DodecahedronGeometry(0.11, 0), ORE_MAT, new THREE.Vector3(x, 0.1, z));
    }
    pennant(builder, palette, -0.2, 1.78, 0.08, 0.32, 0.22);
    hangingBanner(builder, palette, -1.0, 0.85, 0.35, 0.24, 0.36);
  } else {
    builder.add(new THREE.DodecahedronGeometry(0.1, 0), ORE_MAT, new THREE.Vector3(0.5, 0.1, 0.35));
  }

  return builder.finish();
}

export type BuildingBuilder = (palette: TeamPalette, level: BuildingLevel, variant: number) => THREE.Group;

const BUILDERS: Record<BuildingKind, BuildingBuilder> = {
  barbarian: buildInfantry,
  warrior: buildShield,
  ranger: buildCavalry,
  archer: buildArcher,
  mage: buildElite,
  tower: buildTower,
  granary: buildGranary,
  mine: buildMine,
};

export function buildBuilding(
  kind: BuildingKind,
  palette: TeamPalette,
  level: number = 1,
  variant: number = 0,
): THREE.Group {
  const safe = levelOf(level);
  const group = BUILDERS[kind](palette, safe, variant);
  group.name = "building-" + kind + "-L" + safe;
  group.userData.kind = kind;
  group.userData.level = safe;
  group.scale.setScalar(0.94 + (safe - 1) * 0.03);
  return group;
}

export const LEVEL_NAMES: Record<BuildingLevel, string> = {
  1: "L1 营地",
  2: "L2 驻所",
  3: "L3 要塞",
};
