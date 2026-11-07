export const Surface = {
  Grass: 0,
  Dirt: 1,
  Rock: 2,
  Road: 3,
  ShallowWater: 4,
  DeepWater: 5,
  Snow: 6,
  Sand: 7,
  Bridge: 8,
  Stairs: 9,
} as const;

export type SurfaceId = (typeof Surface)[keyof typeof Surface];

export interface SurfaceProfile {
  readonly id: SurfaceId;
  readonly name: string;
  readonly costPermille: number;
  readonly walkable: boolean;
}

export const SURFACE_PROFILES: readonly SurfaceProfile[] = [
  { id: Surface.Grass, name: "grass", costPermille: 1000, walkable: true },
  { id: Surface.Dirt, name: "dirt", costPermille: 1300, walkable: true },
  { id: Surface.Rock, name: "rock", costPermille: 1200, walkable: true },
  { id: Surface.Road, name: "road", costPermille: 700, walkable: true },
  { id: Surface.ShallowWater, name: "shallowWater", costPermille: 1600, walkable: true },
  { id: Surface.DeepWater, name: "deepWater", costPermille: 1000, walkable: false },
  { id: Surface.Snow, name: "snow", costPermille: 1200, walkable: true },
  { id: Surface.Sand, name: "sand", costPermille: 1300, walkable: true },
  { id: Surface.Bridge, name: "bridge", costPermille: 700, walkable: true },
  { id: Surface.Stairs, name: "stairs", costPermille: 900, walkable: true },
];

export function surfaceProfile(id: number): SurfaceProfile {
  return SURFACE_PROFILES[id] ?? SURFACE_PROFILES[0];
}

export interface NavRules {
  /** 可通行的最大坡度，千分比；1000 就是 45 度。 */
  readonly maxSlopePermille: number;
  readonly straightCost: number;
  readonly diagonalCost: number;
  readonly uphillScale: number;
  readonly downhillScale: number;
  readonly minDownhillPermille: number;
}

export const DEFAULT_NAV_RULES: NavRules = {
  maxSlopePermille: 700,
  straightCost: 1000,
  diagonalCost: 1414,
  uphillScale: 4000,
  downhillScale: 1000,
  minDownhillPermille: 300,
};
