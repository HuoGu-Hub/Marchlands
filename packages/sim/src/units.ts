import { Surface } from "@marchlands/nav";
import type { UnitKind } from "./types";

/** 兵种的通行属性，皮肤准入与寻路规则共用这一份定义。 */
export interface UnitTraits {
  /** 可渡河：能走浅水。 */
  river: boolean;
  /** 可腾空：无视地表。 */
  flying: boolean;
  /** 远程单位：留作战斗规则接入。 */
  ranged: boolean;
}

export const UNIT_TRAITS: Record<UnitKind, UnitTraits> = {
  barbarian: { river: true, flying: false, ranged: false },
  warrior: { river: false, flying: false, ranged: false },
  ranger: { river: true, flying: false, ranged: false },
  archer: { river: true, flying: false, ranged: true },
  mage: { river: true, flying: true, ranged: true },
  cavalry: { river: true, flying: false, ranged: false },
};

export interface UnitProfile {
  readonly kind: UnitKind;
  readonly label: string;
  /** 可通行地表，由属性推导。 */
  readonly surfaces: ReadonlySet<number>;
  /** 相邻格最大高度差，厘米；只用于台阶这类垂直面。 */
  readonly maxStepCm: number;
  /** 能爬的最大坡度，千分比；1000 就是 45 度。 */
  readonly maxSlopePermille: number;
  /** 交战距离：这个兵种能把伤害打到多远的敌人身上，厘米。 */
  readonly attackRangeCm: number;
  /** 占地：1x1 或 2x1。 */
  readonly footprint: "1x1" | "2x1";
  /** 盾兵转弯需要 2x2 空地。 */
  readonly turnFootprint: "1x1" | "2x2";
}

const LAND = new Set<number>([
  Surface.Grass,
  Surface.Dirt,
  Surface.Rock,
  Surface.Road,
  Surface.ShallowWater,
  Surface.Snow,
  Surface.Sand,
  Surface.Bridge,
  Surface.Stairs,
]);
const DRY = new Set<number>([...LAND].filter((surface) => surface !== Surface.ShallowWater));
const ALL = new Set<number>(Object.values(Surface));

/** 属性决定可走地表：会飞的全地形，能渡河的走浅水，其余只能走干地。 */
function surfacesFor(traits: UnitTraits): ReadonlySet<number> {
  if (traits.flying) return ALL;
  return traits.river ? LAND : DRY;
}

export const UNIT_PROFILES: Record<UnitKind, UnitProfile> = {
  barbarian: {
    kind: "barbarian",
    label: "野蛮人",
    surfaces: surfacesFor(UNIT_TRAITS.barbarian),
    maxStepCm: 60,
    maxSlopePermille: 550,
    attackRangeCm: 110,
    footprint: "1x1",
    turnFootprint: "1x1",
  },
  warrior: {
    kind: "warrior",
    label: "精锐战士",
    surfaces: surfacesFor(UNIT_TRAITS.warrior),
    maxStepCm: 50,
    maxSlopePermille: 400,
    attackRangeCm: 130,
    footprint: "2x1",
    turnFootprint: "2x2",
  },
  ranger: {
    kind: "ranger",
    label: "游侠",
    surfaces: surfacesFor(UNIT_TRAITS.ranger),
    maxStepCm: 60,
    maxSlopePermille: 600,
    attackRangeCm: 140,
    footprint: "1x1",
    turnFootprint: "1x1",
  },
  archer: {
    kind: "archer",
    label: "弓箭手",
    surfaces: surfacesFor(UNIT_TRAITS.archer),
    maxStepCm: 60,
    maxSlopePermille: 500,
    attackRangeCm: 380,
    footprint: "1x1",
    turnFootprint: "1x1",
  },
  mage: {
    kind: "mage",
    label: "法师",
    surfaces: surfacesFor(UNIT_TRAITS.mage),
    maxStepCm: 80,
    maxSlopePermille: 900,
    attackRangeCm: 460,
    footprint: "1x1",
    turnFootprint: "1x1",
  },
  cavalry: {
    kind: "cavalry",
    label: "骑兵",
    surfaces: surfacesFor(UNIT_TRAITS.cavalry),
    maxStepCm: 70,
    maxSlopePermille: 450,
    attackRangeCm: 150,
    footprint: "1x1",
    turnFootprint: "1x1",
  },
};

export function unitProfile(kind: UnitKind): UnitProfile {
  return UNIT_PROFILES[kind];
}

export function unitTraits(kind: UnitKind): UnitTraits {
  return UNIT_TRAITS[kind];
}
