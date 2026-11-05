import {
  NavGrid,
  Surface,
  decodeBitmapBase64,
  surfaceProfile,
  decodeInt16Base64,
  decodeUint8Base64,
  isqrt,
  planPath,
} from "@marchlands/nav";
import type { CityState, MapDef, Ruleset, UnitKind } from "./types";
import { unitProfile } from "./units";

export const GRID_UNIT_RADIUS_CM = 40;
export const GRID_CAPTURE_RADIUS_CM = 400;

export function createNavGrid(map: MapDef): NavGrid | null {
  if (!map.grid) return null;
  const grid = map.grid;
  const cells = grid.width * grid.height;
  return new NavGrid({
    cellSizeCm: grid.cellSizeCm,
    width: grid.width,
    height: grid.height,
    heightCm: decodeInt16Base64(grid.heightCm, cells),
    surface: decodeUint8Base64(grid.surface, cells),
    blocked: decodeBitmapBase64(grid.blocked, cells),
    walkableOverride: decodeBitmapBase64(grid.walkableOverride, cells),
  });
}

function siteCell(map: MapDef, site: CityState): number {
  const grid = map.grid;
  if (!grid) return -1;
  const x = Math.floor((site.pos[0] * 10 + map.size[0] * 5) / grid.cellSizeCm);
  const z = Math.floor((site.pos[1] * 10 + map.size[1] * 5) / grid.cellSizeCm);
  if (x < 0 || z < 0 || x >= grid.width || z >= grid.height) return -1;
  return z * grid.width + x;
}

export function createUnitNavGrid(
  map: MapDef,
  cities: readonly CityState[],
  owner: number,
  kind: UnitKind,
  destination?: string,
): NavGrid | null {
  if (!map.grid) return null;
  const grid = map.grid;
  const count = grid.width * grid.height;
  const profile = unitProfile(kind);
  const maxStepCm = map.climbCm ?? profile.maxStepCm;
  const blocked = decodeBitmapBase64(grid.blocked, count);
  const override = decodeBitmapBase64(grid.walkableOverride, count);
  const surfaces = decodeUint8Base64(grid.surface, count);
  for (let index = 0; index < count; index += 1) {
    if (!profile.surfaces.has(surfaces[index])) {
      blocked[index] = 1;
      override[index] = 0;
    } else if (blocked[index] === 0 && override[index] === 0 && !surfaceProfile(surfaces[index]).walkable) {
      // 该兵种允许深水等非常规地表时，用可走覆盖打开它。
      override[index] = 1;
    }
  }
  for (const city of cities) {
    if (city.owner === owner) continue;
    if (city.id === destination) continue;
    if (city.transit === "open") continue;
    const cell = siteCell(map, city);
    if (cell >= 0) {
      blocked[cell] = 1;
      override[cell] = 0;
    }
  }
  return new NavGrid({
    cellSizeCm: grid.cellSizeCm,
    width: grid.width,
    height: grid.height,
    heightCm: decodeInt16Base64(grid.heightCm, count),
    surface: surfaces,
    blocked,
    walkableOverride: override,
    rules: {
      maxStepCm,
      maxSlopePermille: Math.max(1000, Math.round((maxStepCm / grid.cellSizeCm) * 1000)),
    },
  });
}

function shieldPathClear(nav: NavGrid, cells: readonly number[]): boolean {
  for (const cell of cells) {
    const x = nav.cellX(cell);
    const z = nav.cellZ(cell);
    for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
      if (!nav.inBounds(x + dx, z + dz)) return false;
      if (!nav.isWalkable(nav.index(x + dx, z + dz))) return false;
    }
  }
  return true;
}

export function gridSpeedCmPerTick(rules: Ruleset, speedMilli: number, surface?: number): number {
  const base = Math.max(
    1,
    Math.floor((rules.speedDmPerSecond * 10 * Math.max(1, speedMilli)) / (rules.tickHz * 1000)),
  );
  const factor = surface === Surface.Road || surface === Surface.Bridge ? 1250 : 1000;
  return Math.max(1, Math.floor((base * factor) / 1000));
}

export function gridTravelTicks(distanceCm: number, rules: Ruleset, speedMilli: number): number {
  return Math.max(1, Math.ceil(distanceCm / gridSpeedCmPerTick(rules, speedMilli)));
}

export interface GridRoute {
  readonly cost: number;
  readonly distance: number;
  readonly points: Array<[number, number]>;
}

/** 地图坐标以中心为原点，网格坐标以左下角为原点。 */
export function planGridRoute(
  map: MapDef,
  nav: NavGrid,
  fromCm: [number, number],
  toCm: [number, number],
  radiusCm = GRID_UNIT_RADIUS_CM,
  unitKind?: UnitKind,
): GridRoute | null {
  const offsetX = map.size[0] * 5;
  const offsetZ = map.size[1] * 5;
  const path = planPath(
    nav,
    { xCm: Math.round(fromCm[0] + offsetX), zCm: Math.round(fromCm[1] + offsetZ) },
    { xCm: Math.round(toCm[0] + offsetX), zCm: Math.round(toCm[1] + offsetZ) },
    { radiusCm, smooth: true },
  );
  if (!path) return null;
  if (unitKind === "shield" && !shieldPathClear(nav, path.cells)) return null;
  const points = path.points.map((point) => [point.xCm - offsetX, point.zCm - offsetZ] as [number, number]);
  return { cost: path.cost, points, distance: polylineLength(points) };
}

export function polylineLength(points: ReadonlyArray<readonly [number, number]>): number {
  let total = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const dx = points[index + 1][0] - points[index][0];
    const dz = points[index + 1][1] - points[index][1];
    total += isqrt(dx * dx + dz * dz);
  }
  return total;
}

export interface GridMove {
  readonly xCm: number;
  readonly zCm: number;
  readonly index: number;
}

export function moveAlongGridPath(
  xCm: number,
  zCm: number,
  path: ReadonlyArray<readonly [number, number]>,
  startIndex: number,
  budgetCm: number,
): GridMove {
  let x = xCm;
  let z = zCm;
  let cursor = startIndex;
  let budget = budgetCm;
  while (budget > 0 && cursor < path.length) {
    const target = path[cursor];
    const dx = target[0] - x;
    const dz = target[1] - z;
    const distance = isqrt(dx * dx + dz * dz);
    if (distance <= budget) {
      x = target[0];
      z = target[1];
      budget -= distance;
      cursor += 1;
      continue;
    }
    x += Math.trunc((dx * budget) / distance);
    z += Math.trunc((dz * budget) / distance);
    budget = 0;
  }
  return { xCm: x, zCm: z, index: cursor };
}

export function gridDistance(a: readonly [number, number], b: readonly [number, number]): number {
  const dx = a[0] - b[0];
  const dz = a[1] - b[1];
  return isqrt(dx * dx + dz * dz);
}
