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

export const TOWN_BUILDINGS: BuildingKind[] = ["barbarian", "warrior", "ranger", "archer", "mage"];

export const CITY_HALL_SCALE = 1.7;
export const OUTPOST_TOWER_SCALE = 1.7;
export const OUTPOST_BUILDING_SCALE = 1.55;

export function townBuildingKind(seed: number): BuildingKind {
  return TOWN_BUILDINGS[Math.abs(seed) % TOWN_BUILDINGS.length];
}

export function buildTown(level: number, palette: TeamPalette, seed: number, forced?: BuildingKind): THREE.Group {
  const group = new THREE.Group();
  const kind = forced ?? townBuildingKind(seed);
  const building = buildBuilding(kind, palette, level, Math.abs(seed) % 7);
  const scale = 2.0;
  building.scale.multiplyScalar(scale);
  building.position.set(0, 0, -0.25);
  group.add(building);

  const props = new ModelBuilder();
  const cloth = clothMat(palette);

  crate(props, -1.55, 0.92, 0.85);
  barrel(props, -1.15, 0.75, 1.15);
  sack(props, 1.35, 0.85, 0.9);
  for (const side of [-1, 1]) {
    const x = side * 1.05;
    const z = 2.45;
    props.cylinder(0.06, 0.08, 0.1, 8, STONE_MAT, x, 0.05, z);
    props.cylinder(0.02, 0.02, 1.05, 5, TIMBER_MAT, x, 0.56, z);
    props.shape(flagShape(0.28, 0.18), cloth, x + 0.02, 1.08, z);
  }
  group.add(props.finish());
  return group;
}

export function paletteFor(owner: number): TeamPalette {
  return TEAM_PALETTES[owner] ?? TEAM_PALETTES[0];
}
