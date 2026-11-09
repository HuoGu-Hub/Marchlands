import type { NavGrid } from "./grid";

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

const CACHE_LIMIT = 512;
const caches = new WeakMap<NavGrid, Map<string, NavPath | null>>();
interface SearchScratch {
  scores: Int32Array;
  parents: Int32Array;
  closed: Uint8Array;
}
const scratchCache = new WeakMap<NavGrid, SearchScratch>();
interface FlowField {
  distance: Int32Array;
  parents: Int32Array;
}
const flowCaches = new WeakMap<NavGrid, Map<string, FlowField>>();
const flowRequests = new WeakMap<NavGrid, Map<string, number>>();
const FLOW_LIMIT = 8;
/**
 * 同一个目标至少被查询几次后才建距离场；避免一次性路径反而多付铺图成本。
 * 大图铺满整张图的代价更高，需要更多次查询才划算。
 */
function flowRequestThreshold(cellCount: number): number {
  if (cellCount > 100_000) return 10;
  if (cellCount > 20_000) return 6;
  return 4;
}

export interface SearchOptions {
  readonly radiusCm?: number;
  readonly maxExpanded?: number;
  readonly snap?: boolean;
  readonly snapRadiusCells?: number;
  readonly cache?: boolean;
}

export interface NavPath {
  readonly cells: number[];
  readonly cost: number;
  readonly expanded: number;
  readonly startCell: number;
  readonly goalCell: number;
}

class CellHeap {
  private readonly scores: number[] = [];
  private readonly cells: number[] = [];

  get size(): number {
    return this.cells.length;
  }

  push(score: number, cell: number): void {
    this.scores.push(score);
    this.cells.push(cell);
    this.up(this.cells.length - 1);
  }

  pop(): number {
    const last = this.cells.length - 1;
    if (last < 0) return -1;
    const top = this.cells[0];
    this.swap(0, last);
    this.scores.pop();
    this.cells.pop();
    if (this.cells.length > 0) this.down(0);
    return top;
  }

  private less(a: number, b: number): boolean {
    if (this.scores[a] !== this.scores[b]) return this.scores[a] < this.scores[b];
    return this.cells[a] < this.cells[b];
  }

  private swap(a: number, b: number): void {
    const score = this.scores[a];
    this.scores[a] = this.scores[b];
    this.scores[b] = score;
    const cell = this.cells[a];
    this.cells[a] = this.cells[b];
    this.cells[b] = cell;
  }

  private up(index: number): void {
    let current = index;
    while (current > 0) {
      const parent = (current - 1) >> 1;
      if (!this.less(current, parent)) break;
      this.swap(current, parent);
      current = parent;
    }
  }

  private down(index: number): void {
    let current = index;
    for (;;) {
      const left = current * 2 + 1;
      const right = left + 1;
      let best = current;
      if (left < this.cells.length && this.less(left, best)) best = left;
      if (right < this.cells.length && this.less(right, best)) best = right;
      if (best === current) break;
      this.swap(current, best);
      current = best;
    }
  }
}

function heuristic(grid: NavGrid, from: number, goal: number): number {
  const dx = Math.abs(grid.cellX(goal) - grid.cellX(from));
  const dz = Math.abs(grid.cellZ(goal) - grid.cellZ(from));
  const diagonal = Math.min(dx, dz);
  const straight = Math.max(dx, dz) - diagonal;
  return grid.minDiagonalCost * diagonal + grid.minStraightCost * straight;
}

function search(
  grid: NavGrid,
  start: number,
  goal: number,
  coverage: Uint8Array | undefined,
  maxExpanded: number,
): NavPath | null {
  const count = grid.cellCount;
  let scratch = scratchCache.get(grid);
  if (!scratch) {
    scratch = {
      scores: new Int32Array(count),
      parents: new Int32Array(count),
      closed: new Uint8Array(count),
    };
    scratchCache.set(grid, scratch);
  }
  const scores = scratch.scores;
  const parents = scratch.parents;
  const closed = scratch.closed;
  scores.fill(-1);
  parents.fill(-1);
  closed.fill(0);
  const heap = new CellHeap();
  scores[start] = 0;
  heap.push(heuristic(grid, start, goal), start);
  let expanded = 0;

  while (heap.size > 0) {
    const current = heap.pop();
    if (closed[current] === 1) continue;
    if (current === goal) {
      const cells: number[] = [];
      for (let at = goal; at !== -1; at = parents[at]) cells.push(at);
      cells.reverse();
      return { cells, cost: scores[goal], expanded, startCell: start, goalCell: goal };
    }
    closed[current] = 1;
    expanded += 1;
    if (expanded > maxExpanded) return null;

    const cx = grid.cellX(current);
    const cz = grid.cellZ(current);
    for (const neighbor of NEIGHBORS) {
      const nx = cx + neighbor[0];
      const nz = cz + neighbor[1];
      if (!grid.inBounds(nx, nz)) continue;
      const next = grid.index(nx, nz);
      if (closed[next] === 1) continue;
      if (!grid.isWalkable(next, coverage)) continue;
      if (!grid.canStep(current, next, coverage)) continue;

      const tentative = scores[current] + grid.stepCost(current, next);
      const existing = scores[next];
      if (existing !== -1) {
        if (tentative > existing) continue;
        if (tentative === existing && parents[next] !== -1 && parents[next] <= current) continue;
      }
      scores[next] = tentative;
      parents[next] = current;
      heap.push(tentative + heuristic(grid, next, goal), next);
    }
  }
  return null;
}

/**
 * 从目标反向铺一张距离场。
 * 同一目标、同一净空半径被多个起点查询时，后续起点不再单独跑 A*。
 */
function flowField(
  grid: NavGrid,
  goal: number,
  coverage: Uint8Array | undefined,
  key: string,
): FlowField | null {
  let cache = flowCaches.get(grid);
  if (!cache) {
    cache = new Map<string, FlowField>();
    flowCaches.set(grid, cache);
  }
  const cached = cache.get(key);
  if (cached) return cached;
  const count = grid.cellCount;
  const distance = new Int32Array(count).fill(-1);
  const parents = new Int32Array(count).fill(-1);
  const heap = new CellHeap();
  distance[goal] = 0;
  heap.push(0, goal);
  let expanded = 0;
  const limit = count * 2;

  while (heap.size > 0) {
    const current = heap.pop();
    expanded += 1;
    if (expanded > limit) break;
    const cx = grid.cellX(current);
    const cz = grid.cellZ(current);
    for (const neighbor of NEIGHBORS) {
      const nx = cx + neighbor[0];
      const nz = cz + neighbor[1];
      if (!grid.inBounds(nx, nz)) continue;
      const next = grid.index(nx, nz);
      if (!grid.isWalkable(next, coverage)) continue;
      // 反向扩展，因此要检查 next -> current 的通行方向。
      if (!grid.canStep(next, current, coverage)) continue;
      const tentative = distance[current] + grid.stepCost(next, current);
      if (distance[next] !== -1 && tentative >= distance[next]) continue;
      distance[next] = tentative;
      parents[next] = current;
      heap.push(tentative, next);
    }
  }

  const field: FlowField = { distance, parents };
  const limitSize = count > 100_000 ? 2 : FLOW_LIMIT;
  if (cache.size >= limitSize) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, field);
  return field;
}

function pathFromFlow(
  field: FlowField,
  start: number,
  goal: number,
): NavPath | null {
  if (field.distance[start] < 0) return null;
  const cells: number[] = [];
  let at = start;
  let guard = 0;
  while (at !== goal) {
    cells.push(at);
    at = field.parents[at];
    guard += 1;
    if (at < 0 || guard > field.distance.length) return null;
  }
  cells.push(goal);
  return {
    cells,
    cost: field.distance[start],
    expanded: 0,
    startCell: start,
    goalCell: goal,
  };
}

function cacheFor(grid: NavGrid): Map<string, NavPath | null> {
  let cache = caches.get(grid);
  if (!cache) {
    cache = new Map<string, NavPath | null>();
    caches.set(grid, cache);
  }
  return cache;
}

export function clearPathCache(grid: NavGrid): void {
  caches.delete(grid);
  scratchCache.delete(grid);
  flowCaches.delete(grid);
  flowRequests.delete(grid);
}

export function findCellPath(
  grid: NavGrid,
  start: number,
  goal: number,
  options: SearchOptions = {},
): NavPath | null {
  const radius = Math.max(0, Math.floor(options.radiusCm ?? 0));
  const coverage = radius > 0 ? grid.clearance(radius) : undefined;
  let startCell = start;
  let goalCell = goal;

  if (!grid.isWalkable(startCell, coverage)) {
    if (options.snap !== true) return null;
    const snapped = grid.nearestWalkable(startCell, coverage, options.snapRadiusCells ?? 12);
    if (snapped === null) return null;
    startCell = snapped;
  }
  if (!grid.isWalkable(goalCell, coverage)) {
    if (options.snap !== true) return null;
    const snapped = grid.nearestWalkable(goalCell, coverage, options.snapRadiusCells ?? 12);
    if (snapped === null) return null;
    goalCell = snapped;
  }
  if (startCell === goalCell) {
    return { cells: [startCell], cost: 0, expanded: 0, startCell, goalCell };
  }

  const maxExpanded = options.maxExpanded ?? grid.cellCount * 2;
  const key = radius + ":" + startCell + ":" + goalCell + ":" + maxExpanded;
  const cache = cacheFor(grid);
  if (options.cache !== false) {
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
  }

  // 同一个目标被多个起点反复查询，达到阈值后改用反向距离场；
  // 后续起点只需沿父指针回溯，不再重复展开 A*。
  if (options.cache !== false && options.maxExpanded === undefined) {
    const flowKey = radius + ":" + goalCell;
    let requests = flowRequests.get(grid);
    if (!requests) {
      requests = new Map<string, number>();
      flowRequests.set(grid, requests);
    }
    const nextCount = (requests.get(flowKey) ?? 0) + 1;
    requests.set(flowKey, nextCount);
    if (nextCount >= flowRequestThreshold(grid.cellCount)) {
      const field = flowField(grid, goalCell, coverage, flowKey);
      if (field) {
        const flowPath = pathFromFlow(field, startCell, goalCell);
        if (flowPath !== null) {
          if (cache.size >= CACHE_LIMIT) {
            const oldest = cache.keys().next();
            if (!oldest.done) cache.delete(oldest.value);
          }
          cache.set(key, flowPath);
        }
        return flowPath;
      }
    }
  }

  const result = search(grid, startCell, goalCell, coverage, maxExpanded);
  if (options.cache !== false) {
    if (cache.size >= CACHE_LIMIT) {
      const oldest = cache.keys().next();
      if (!oldest.done) cache.delete(oldest.value);
    }
    cache.set(key, result);
  }
  return result;
}
