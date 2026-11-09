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
