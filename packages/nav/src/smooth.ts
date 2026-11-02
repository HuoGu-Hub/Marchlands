import type { NavGrid } from "./grid";
import { divTrunc, isqrt } from "./math";

export function lineOfSight(
  grid: NavGrid,
  from: number,
  to: number,
  coverage?: Uint8Array,
): boolean {
  if (from === to) return true;
  const start = grid.centerOf(from);
  const end = grid.centerOf(to);
  const dx = end.xCm - start.xCm;
  const dz = end.zCm - start.zCm;
  const distance = isqrt(dx * dx + dz * dz);
  const sampleCm = Math.max(1, Math.floor(grid.cellSizeCm / 4));
  const steps = Math.max(1, Math.ceil(distance / sampleCm));
  let previous = from;

  for (let step = 1; step <= steps; step += 1) {
    const x = start.xCm + divTrunc(dx * step, steps);
    const z = start.zCm + divTrunc(dz * step, steps);
    const cell = grid.cellFromWorld(x, z);
    if (cell < 0 || !grid.isWalkable(cell, coverage)) return false;
    if (cell !== previous) {
      if (!grid.canStep(previous, cell, coverage)) return false;
      previous = cell;
    }
  }
  return previous === to;
}

export function smoothPath(grid: NavGrid, cells: readonly number[], coverage?: Uint8Array): number[] {
  if (cells.length <= 2) return cells.slice();
  const result: number[] = [cells[0]];
  let anchor = 0;
  while (anchor < cells.length - 1) {
    let next = cells.length - 1;
    while (next > anchor + 1 && !lineOfSight(grid, cells[anchor], cells[next], coverage)) {
      next -= 1;
    }
    result.push(cells[next]);
    anchor = next;
  }
  return result;
}
