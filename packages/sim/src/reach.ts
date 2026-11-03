import type { NavGrid } from "@marchlands/nav";
import { GRID_UNIT_RADIUS_CM, createUnitNavGrid, planGridRoute } from "./grid";
import { blockedTransit } from "./routes";
import { isProductionSiteKind, siteUnitKind } from "./types";
import type { CityId, CityState, SimState } from "./types";

export interface GridReach {
  /** 与派兵时相同的单位通行网格，供渲染格子高度与范围使用。 */
  readonly nav: NavGrid;
  /** 1 表示该格兵团可以抵达。 */
  readonly cells: Uint8Array;
}

const NEIGHBORS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/** 与 send 指令一致：只有己方产兵据点、且守军不少于两人时才能派兵。 */
function canSendFrom(city: CityState | undefined): city is CityState {
  return city !== undefined && city.owner !== 0 && isProductionSiteKind(city.kind) && city.pop >= 2;
}

/**
 * 从 fromId 的驻军出发可以派兵抵达的目标。
 * 规则与 send 指令保持一致：中立或敌方建筑阻断道路，但目标本身不受阻断限制。
 */
/**
 * 从某个据点出发，兵团可以踏上的所有网格。
 * 与派兵使用同一套单位通行规则：地表、坡度、单位半径，以及非己方建筑阻挡。
 */
export function reachableGridCells(state: SimState, fromId: CityId): GridReach | null {
  const from = state.cities.find((city) => city.id === fromId);
  if (!state.nav || !canSendFrom(from)) return null;
  const unitKind = siteUnitKind(from.kind) ?? "infantry";
  const nav = createUnitNavGrid(state.map, state.cities, from.owner, unitKind);
  if (!nav) return null;
  const cells = new Uint8Array(nav.cellCount);
  const coverage = nav.clearance(GRID_UNIT_RADIUS_CM);
  const offsetX = state.map.size[0] * 5;
  const offsetZ = state.map.size[1] * 5;
  const start = nav.cellFromWorld(from.pos[0] * 10 + offsetX, from.pos[1] * 10 + offsetZ);
  if (start < 0 || !nav.isWalkable(start, coverage)) return { nav, cells };

  const queue = new Int32Array(nav.cellCount);
  let head = 0;
  let tail = 0;
  cells[start] = 1;
  queue[tail] = start;
  tail += 1;
  while (head < tail) {
    const current = queue[head];
    head += 1;
    const cx = nav.cellX(current);
    const cz = nav.cellZ(current);
    for (const [dx, dz] of NEIGHBORS) {
      const nx = cx + dx;
      const nz = cz + dz;
      if (!nav.inBounds(nx, nz)) continue;
      const next = nav.index(nx, nz);
      if (cells[next] === 1) continue;
      if (!nav.isWalkable(next, coverage)) continue;
      if (!nav.canStep(current, next, coverage)) continue;
      cells[next] = 1;
      queue[tail] = next;
      tail += 1;
    }
  }
  return { nav, cells };
}

export function sendReachableTargets(state: SimState, fromId: CityId): CityId[] {
  const from = state.cities.find((city) => city.id === fromId);
  if (!canSendFrom(from)) return [];
  const targets: CityId[] = [];

  if (state.nav) {
    const unitKind = siteUnitKind(from.kind) ?? "infantry";
    const start: [number, number] = [from.pos[0] * 10, from.pos[1] * 10];
    for (const city of state.cities) {
      if (city.id === from.id) continue;
      const unitNav = createUnitNavGrid(state.map, state.cities, from.owner, unitKind, city.id);
      if (!unitNav) continue;
      const goal: [number, number] = [city.pos[0] * 10, city.pos[1] * 10];
      if (planGridRoute(state.map, unitNav, start, goal, 40, unitKind)) targets.push(city.id);
    }
    return targets;
  }

  const blocked = blockedTransit(state, from.owner);
  const visited = new Set<CityId>([from.id]);
  const queue: CityId[] = [from.id];
  while (queue.length > 0) {
    const current = queue.shift() as CityId;
    for (const next of state.graph.neighbors(current)) {
      if (visited.has(next) || blocked.has(next)) continue;
      visited.add(next);
      queue.push(next);
    }
  }

  for (const city of state.cities) {
    if (city.id === from.id) continue;
    if (visited.has(city.id)) {
      targets.push(city.id);
      continue;
    }
    // 被阻断的建筑仍可直接作为目的地，只要它紧邻已连通的道路。
    if (blocked.has(city.id) && state.graph.neighbors(city.id).some((other) => visited.has(other))) {
      targets.push(city.id);
    }
  }
  return targets;
}
