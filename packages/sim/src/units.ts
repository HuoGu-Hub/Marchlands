import { Surface } from "@marchlands/nav";
import type { UnitKind } from "./types";

export interface UnitProfile {
  readonly kind: UnitKind;
  readonly label: string;
  /** 可通行地表；普通地面兵种默认不能走深水。 */
  readonly surfaces: ReadonlySet<number>;
  /** 相邻格最大高度差，厘米。 */
  readonly maxStepCm: number;
  /** 占地：1x1 或 2x1（盾兵）。 */
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

export const UNIT_PROFILES: Record<UnitKind, UnitProfile> = {
  barbarian: { kind: "barbarian", label: "野蛮人", surfaces: DRY, maxStepCm: 60, footprint: "1x1", turnFootprint: "1x1" },
  warrior: { kind: "warrior", label: "精锐战士", surfaces: DRY, maxStepCm: 50, footprint: "2x1", turnFootprint: "2x2" },
  ranger: { kind: "ranger", label: "游侠", surfaces: LAND, maxStepCm: 40, footprint: "1x1", turnFootprint: "1x1" },
  archer: { kind: "archer", label: "弓箭手", surfaces: DRY, maxStepCm: 60, footprint: "1x1", turnFootprint: "1x1" },
  mage: { kind: "mage", label: "法师", surfaces: ALL, maxStepCm: 80, footprint: "1x1", turnFootprint: "1x1" },
};

export function unitProfile(kind: UnitKind): UnitProfile {
  return UNIT_PROFILES[kind];
}
