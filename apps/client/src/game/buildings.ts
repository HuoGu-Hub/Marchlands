import * as THREE from "three";
import {
  ModelBuilder,
  STONE,
  STONE_DARK,
  STONE_LIGHT,
  TEAM_PALETTES,
  TIMBER_DARK,
  archShape,
  bannerShape,
  flagShape,
  material,
} from "./building-kit";
import type { TeamPalette } from "./building-kit";
import {
  DARK_MAT,
  IRON_MAT,
  STONE_DARK_MAT,
  STONE_LIGHT_MAT,
  STONE_MAT,
  TIMBER_MAT,
  WATER_MAT,
  archDoor,
  barrel,
  cart,
  clothMat,
  crate,
  edgeMat,
  lamp,
  roofMat,
  sack,
} from "./building-props";
import { buildBuilding } from "./building-types";
import type { BuildingKind } from "./building-types";

export * from "./building-types";

export interface BuildingPlacement {
  kind: BuildingKind;
  x: number;
  z: number;
  rotation: number;
}

const SLOTS: Array<{ x: number; z: number }> = [
  { x: -2.4, z: -0.95 },
  { x: 2.4, z: -0.95 },
  { x: -1.95, z: 1.95 },
  { x: 1.95, z: 1.95 },
];

export function townPlacements(level: number, seed: number): BuildingPlacement[] {
  const back: BuildingKind[] = (seed & 1) === 0 ? ["infantry", "archer"] : ["archer", "infantry"];
  const front: BuildingKind[] = (seed & 2) === 0 ? ["cavalry", "elite"] : ["elite", "cavalry"];
  const kinds: BuildingKind[] = [back[0], back[1], front[0], front[1]];
  const count = Math.min(4, Math.max(2, level + 1));
  return SLOTS.slice(0, count).map((slot, index) => ({
    kind: kinds[index],
    x: slot.x,
    z: slot.z,
    rotation: Math.atan2(-slot.x, -slot.z) + ((seed >> (index + 2)) & 1 ? 0.08 : -0.08),
  }));
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

export function buildWall(level: number, palette: TeamPalette, radius = 4.5): THREE.Group {
  const builder = new ModelBuilder();
  const stone = level === 1 ? material(0x5c422c, { rough: 1 }) : material(0x6f736c, { rough: 1 });
  const crenel = level === 1 ? material(0x7a5a3a, { rough: 1 }) : material(0x9a9d92, { rough: 1 });
  const trim = level === 1 ? DARK_MAT : STONE_DARK_MAT;
  const cloth = clothMat(palette);
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
        height + 0.09,
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
      (height + 0.16) / 2,
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

export function buildTown(level: number, palette: TeamPalette, seed: number): THREE.Group {
  const group = new THREE.Group();
  const keep = buildKeep(palette, level);
  keep.position.set(0, 0, -2.7);
  group.add(keep);

  for (const placement of townPlacements(level, seed)) {
    const variant = Math.abs(seed + Math.round(placement.x * 3));
    const building = buildBuilding(placement.kind, palette, level, variant);
    building.position.set(placement.x, 0, placement.z);
    building.rotation.y = placement.rotation;
    group.add(building);
  }

  const props = new ModelBuilder();
  const cloth = clothMat(palette);
  if (level >= 2) {
    props.cylinder(0.72, 0.78, 0.24, 14, STONE_DARK_MAT, 0, 0.12, 0.35);
    props.cylinder(0.6, 0.6, 0.2, 14, WATER_MAT, 0, 0.14, 0.35);
    props.cylinder(0.16, 0.2, 0.58, 8, STONE_LIGHT_MAT, 0, 0.42, 0.35);
    props.cylinder(0.34, 0.34, 0.07, 12, STONE_LIGHT_MAT, 0, 0.72, 0.35);
    props.cylinder(0.06, 0.06, 0.2, 8, WATER_MAT, 0, 0.82, 0.35);
    for (const angle of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
      lamp(props, Math.cos(angle) * 1.15, 0.35 + Math.sin(angle) * 1.15, 1.0);
    }
  } else {
    props.cylinder(0.31, 0.33, 0.26, 10, STONE_DARK_MAT, 0, 0.13, 0.35);
    props.cylinder(0.23, 0.23, 0.27, 10, material(0x171310), 0, 0.14, 0.35);
    for (const x of [-0.3, 0.3]) {
      props.box([0.05, 0.56, 0.05], TIMBER_MAT, x, 0.45, 0.35);
    }
    props.box([0.78, 0.045, 0.05], TIMBER_MAT, 0, 0.71, 0.35);
    props.box([0.86, 0.06, 0.74], roofMat(palette, 0.9), 0, 0.78, 0.35, 0.56, 0, 0);
  }

  cart(props, 0.15, 3.9, 0.24);
  crate(props, -1.4, 3.9, 0.9);
  barrel(props, -1.2, 3.55, 0.8);
  sack(props, 0.85, 3.8, 0.9);

  for (const side of [-1, 1]) {
    const x = side * 1.02;
    const z = 3.5;
    props.cylinder(0.07, 0.09, 0.1, 8, STONE_MAT, x, 0.05, z);
    props.cylinder(0.022, 0.022, 1.2, 5, TIMBER_MAT, x, 0.62, z);
    props.shape(flagShape(0.3, 0.2), cloth, x + 0.02, 1.2, z);
  }

  group.add(props.finish());
  return group;
}

export function paletteFor(owner: number): TeamPalette {
  return TEAM_PALETTES[owner] ?? TEAM_PALETTES[0];
}
