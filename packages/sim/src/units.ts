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
  infantry: { kind: "infantry", label: "步兵", surfaces: DRY, maxStepCm: 500, footprint: "1x1", turnFootprint: "1x1" },
  shield: { kind: "shield", label: "盾兵", surfaces: DRY, maxStepCm: 500, footprint: "2x1", turnFootprint: "2x2" },
  cavalry: { kind: "cavalry", label: "骑兵", surfaces: LAND, maxStepCm: 2000, footprint: "1x1", turnFootprint: "1x1" },
  archer: { kind: "archer", label: "弓兵", surfaces: DRY, maxStepCm: 500, footprint: "1x1", turnFootprint: "1x1" },
  elite: { kind: "elite", label: "精兵", surfaces: ALL, maxStepCm: 10000, footprint: "1x1", turnFootprint: "1x1" },
};

export function unitProfile(kind: UnitKind): UnitProfile {
  return UNIT_PROFILES[kind];
}
