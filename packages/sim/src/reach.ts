import type { NavGrid } from "@marchlands/nav";
import { GRID_CAPTURE_RADIUS_CM, GRID_UNIT_RADIUS_CM, createUnitNavGrid } from "./grid";
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

/**
 * 网格模式下用一次洪泛结果判断哪些建筑可抵达，避免对每座城各跑一次 A*。
 * 只要建筑格相邻的任意一格可达，兵团就能借目标豁免走进建筑格。
 */
export function reachableGridCities(
  state: SimState,
  fromId: CityId,
  reach: GridReach,
): CityId[] {
  const nav = reach.nav;
  const grid = state.map.grid;
  if (!grid) return [];
  const offsetX = state.map.size[0] * 5;
  const offsetZ = state.map.size[1] * 5;
  const radius = Math.max(1, Math.ceil(GRID_CAPTURE_RADIUS_CM / grid.cellSizeCm));
  const result: CityId[] = [];
  for (const city of state.cities) {
    if (city.id === fromId) continue;
    const cell = nav.cellFromWorld(city.pos[0] * 10 + offsetX, city.pos[1] * 10 + offsetZ);
    if (cell < 0) continue;
    const cx = nav.cellX(cell);
    const cz = nav.cellZ(cell);
    let found = false;
    for (let dz = -radius; dz <= radius && !found; dz += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        const nx = cx + dx;
        const nz = cz + dz;
        if (!nav.inBounds(nx, nz)) continue;
        if (reach.cells[nav.index(nx, nz)] !== 1) continue;
        found = true;
        break;
      }
    }
    if (found) result.push(city.id);
  }
  return result;
}

export function sendReachableTargets(state: SimState, fromId: CityId): CityId[] {
  const from = state.cities.find((city) => city.id === fromId);
  if (!canSendFrom(from)) return [];
  const targets: CityId[] = [];

  if (state.nav) {
    // 从出发点洪泛一次，判断哪些建筑可达；逐城 A* 会把一次点选拖成几百毫秒。
    const reach = reachableGridCells(state, from.id);
    return reach ? reachableGridCities(state, from.id, reach) : [];
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
