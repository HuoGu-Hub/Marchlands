import { findCellPath, type NavPath, type SearchOptions } from "./astar";
import type { NavGrid, NavPoint } from "./grid";
import { smoothPath } from "./smooth";

export interface PlanOptions extends SearchOptions {
  readonly smooth?: boolean;
}

export interface PlannedPath {
  readonly cells: number[];
  readonly points: NavPoint[];
  readonly cost: number;
  readonly expanded: number;
  readonly startCell: number;
  readonly goalCell: number;
}

interface WorldPoint {
  readonly xCm: number;
  readonly zCm: number;
}

export function planPath(
  grid: NavGrid,
  from: WorldPoint,
  to: WorldPoint,
  options: PlanOptions = {},
): PlannedPath | null {
  const start = grid.cellFromWorld(from.xCm, from.zCm);
  const goal = grid.cellFromWorld(to.xCm, to.zCm);
  if (start < 0 || goal < 0) return null;
  const found: NavPath | null = findCellPath(grid, start, goal, options);
  if (!found) return null;
  const radius = Math.max(0, Math.floor(options.radiusCm ?? 0));
  const coverage = radius > 0 ? grid.clearance(radius) : undefined;
  const cells = options.smooth === false ? found.cells : smoothPath(grid, found.cells, coverage);
  return {
    cells,
    points: cells.map((cell) => grid.centerOf(cell)),
    cost: found.cost,
    expanded: found.expanded,
    startCell: found.startCell,
    goalCell: found.goalCell,
  };
}
