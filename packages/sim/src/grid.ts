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

/**
 * 同一张地图上，按 owner/兵种/目标/据点归属复用的导航网格。
 * 每次派兵都重建 NavGrid 要重新解码地形并扫描净空，后期 AI 连续派兵时会卡帧。
 */
const unitNavCache = new WeakMap<object, Map<string, NavGrid>>();
/** 大地图单张 NavGrid 很大，缓存条目要相应收紧。 */
function unitNavCacheLimit(cellCount: number): number {
  return cellCount > 100_000 ? 6 : 24;
}

function cityBlockSignature(cities: readonly CityState[]): string {
  let signature = "";
  for (const city of cities) {
    signature += `${city.id}:${city.owner}:${city.transit ?? ""};`;
  }
  return signature;
}

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

/** 同一兵种的地形底图：只做地表过滤，不含据点阻挡。 */
const unitNavBaseCache = new WeakMap<object, Map<string, NavGrid>>();
const UNIT_NAV_BASE_LIMIT = 12;

function unitNavBase(map: MapDef, kind: UnitKind): NavGrid | null {
  if (!map.grid) return null;
  const grid = map.grid;
  const count = grid.width * grid.height;
  const profile = unitProfile(kind);
  let cache = unitNavBaseCache.get(grid);
  if (!cache) {
    cache = new Map<string, NavGrid>();
    unitNavBaseCache.set(grid, cache);
  }
  const baseKey = `${kind}|${map.climbCm ?? ""}`;
  const cached = cache.get(baseKey);
  if (cached) return cached;

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
  const base = new NavGrid({
    cellSizeCm: grid.cellSizeCm,
    width: grid.width,
    height: grid.height,
    heightCm: decodeInt16Base64(grid.heightCm, count),
    surface: surfaces,
    blocked,
    walkableOverride: override,
    rules: {
      // climbCm 是"一格最多爬多高"，除以格宽就是坡度；不填就用兵种自己的上限。
      maxSlopePermille: map.climbCm
        ? Math.round((map.climbCm / grid.cellSizeCm) * 1000)
        : profile.maxSlopePermille,
    },
  });
  if (cache.size >= UNIT_NAV_BASE_LIMIT) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(baseKey, base);
  return base;
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
  let cache = unitNavCache.get(grid);
  if (!cache) {
    cache = new Map<string, NavGrid>();
    unitNavCache.set(grid, cache);
  }
  const cacheKey = `${owner}|${kind}|${destination ?? ""}|${map.climbCm ?? ""}|${cityBlockSignature(cities)}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const base = unitNavBase(map, kind);
  if (!base) return null;
  const blockedCells: number[] = [];
  for (const city of cities) {
    if (city.owner === owner) continue;
    if (city.id === destination) continue;
    if (city.transit === "open") continue;
    const cell = siteCell(map, city);
    if (cell >= 0) blockedCells.push(cell);
  }
  const nav = blockedCells.length > 0 ? base.withBlockedCells(blockedCells) : base;
  if (cache.size >= unitNavCacheLimit(count)) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(cacheKey, nav);
  return nav;
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

/** 供派兵流程先尝试直线；返回 null 时再走图引导或完整 A*。 */
export function planDirectGridRoute(
  map: MapDef,
  nav: NavGrid,
  fromCm: [number, number],
  toCm: [number, number],
  radiusCm = GRID_UNIT_RADIUS_CM,
  unitKind?: UnitKind,
): GridRoute | null {
  if (unitKind === "warrior") return null;
  return directGridRoute(nav, fromCm, toCm, map.size[0] * 5, map.size[1] * 5, radiusCm);
}

/**
 * 沿据点图的中间节点分段走直线。
 * 只在最终直线被城/障碍挡住时调用；中间据点不参与阻挡，避免自己把
 * 路线节点封死。任一段被挡就返回 null，最终回退完整 A*。
 */
export function planGridGuideRoute(
  map: MapDef,
  cities: readonly CityState[],
  owner: number,
  kind: UnitKind,
  fromCm: [number, number],
  toCm: [number, number],
  guide: readonly string[],
): GridRoute | null {
  if (kind === "warrior" || guide.length <= 2) return null;
  const guideIds = new Set(guide);
  const nav = createUnitNavGrid(
    map,
    cities.filter((city) => !guideIds.has(city.id)),
    owner,
    kind,
  );
  if (!nav) return null;
  const byId = new Map(cities.map((city) => [city.id, city]));
  const stops: Array<[number, number]> = [fromCm];
  for (const id of guide.slice(1, -1)) {
    const city = byId.get(id);
    if (!city) return null;
    stops.push([city.pos[0] * 10, city.pos[1] * 10]);
  }
  stops.push(toCm);

  const offsetX = map.size[0] * 5;
  const offsetZ = map.size[1] * 5;
  const points: Array<[number, number]> = [];
  let distance = 0;
  for (let index = 0; index < stops.length - 1; index += 1) {
    const segment = directGridRoute(
      nav,
      stops[index],
      stops[index + 1],
      offsetX,
      offsetZ,
      GRID_UNIT_RADIUS_CM,
    );
    if (!segment) return null;
    for (const point of segment.points) {
      if (points.length === 0) points.push(point);
      else {
        const last = points[points.length - 1];
        if (last[0] !== point[0] || last[1] !== point[1]) points.push(point);
      }
    }
    distance += segment.distance;
  }
  return { cost: Math.round(distance), distance, points };
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

/**
 * 视线内没有阻挡时直接走直线。
 * 开阔地图上大多数派兵都属于这种情况，可以跳过整张图的 A* 展开；
 * 任一点贴墙就返回 null，让调用方回退到完整寻路。
 */
function directGridRoute(
  nav: NavGrid,
  fromCm: [number, number],
  toCm: [number, number],
  offsetX: number,
  offsetZ: number,
  radiusCm: number,
): GridRoute | null {
  const fromX = fromCm[0] + offsetX;
  const fromZ = fromCm[1] + offsetZ;
  const toX = toCm[0] + offsetX;
  const toZ = toCm[1] + offsetZ;
  const dx = toX - fromX;
  const dz = toZ - fromZ;
  const distance = Math.hypot(dx, dz);
  if (distance < 1) return null;
  const coverage = radiusCm > 0 ? nav.clearance(radiusCm) : undefined;
  const steps = Math.max(1, Math.ceil(distance / (nav.cellSizeCm / 4)));
  const length = Math.hypot(dx, dz) || 1;
  const perpX = (-dz / length) * radiusCm;
  const perpZ = (dx / length) * radiusCm;

  let previousCell = -1;
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;
    const x = fromX + dx * t;
    const z = fromZ + dz * t;
    const cell = nav.cellFromWorld(x, z);
    if (cell < 0 || !nav.isWalkable(cell, coverage)) return null;
    if (previousCell >= 0 && cell !== previousCell && !nav.canStep(previousCell, cell, coverage)) {
      return null;
    }
    previousCell = cell;
    if (radiusCm > 0) {
      for (const side of [-1, 1]) {
        const sideX = x + perpX * side;
        const sideZ = z + perpZ * side;
        const sideCell = nav.cellFromWorld(sideX, sideZ);
        if (sideCell < 0 || !nav.isWalkable(sideCell, coverage)) return null;
      }
    }
  }

  // 校验要密，但返回给模拟/渲染的折线不用每个校验点都存；保持约一格一个点。
  const pointSteps = Math.max(1, Math.ceil(distance / nav.cellSizeCm));
  const points: Array<[number, number]> = [[fromCm[0], fromCm[1]]];
  for (let index = 1; index < pointSteps; index += 1) {
    const t = index / pointSteps;
    points.push([fromCm[0] + (toCm[0] - fromCm[0]) * t, fromCm[1] + (toCm[1] - fromCm[1]) * t]);
  }
  points.push([toCm[0], toCm[1]]);
  return { cost: Math.round(distance), distance, points };
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
  // 盾墙兵种还要额外检查 2×2 格，直线通道留到 A* 后再验证。
  if (unitKind !== "warrior") {
    const direct = directGridRoute(nav, fromCm, toCm, offsetX, offsetZ, radiusCm);
    if (direct) return direct;
  }
  const path = planPath(
    nav,
    { xCm: Math.round(fromCm[0] + offsetX), zCm: Math.round(fromCm[1] + offsetZ) },
    { xCm: Math.round(toCm[0] + offsetX), zCm: Math.round(toCm[1] + offsetZ) },
    { radiusCm, smooth: true },
  );
  if (!path) return null;
  if (unitKind === "warrior" && !shieldPathClear(nav, path.cells)) return null;
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
