import { describe, expect, it } from "vitest";
import { findCellPath, planPath, type PlanOptions } from "../src";
import { makeGrid } from "./helpers";
import type { NavGrid } from "../src";

function plan(grid: NavGrid, from: [number, number], to: [number, number], options: PlanOptions = {}) {
  return planPath(grid, grid.centerOf(grid.index(from[0], from[1])), grid.centerOf(grid.index(to[0], to[1])), options);
}

describe("nav grid pathfinding", () => {
  it("finds the straight shortest path on flat ground", () => {
    const grid = makeGrid({ width: 8, height: 8 });
    const path = plan(grid, [0, 0], [4, 0]);
    expect(path).not.toBeNull();
    expect(path?.cost).toBe(4000);
    expect(path?.points).toHaveLength(2);
    expect(path?.points[0]).toMatchObject({ xCm: 50, zCm: 50, heightCm: 0 });
    expect(path?.points[1]).toMatchObject({ xCm: 450, zCm: 50 });
  });

  it("uses the diagonal cost on open ground", () => {
    const grid = makeGrid({ width: 4, height: 4 });
    const path = plan(grid, [0, 0], [2, 2]);
    expect(path?.cost).toBe(2828);
    expect(path?.points).toHaveLength(2);
  });

  it("detours around a wall", () => {
    const blocked: Array<[number, number]> = [];
    for (let z = 0; z <= 5; z += 1) blocked.push([3, z]);
    const grid = makeGrid({ width: 7, height: 7, blocked });
    const path = plan(grid, [0, 3], [6, 3], { smooth: false });
    expect(path).not.toBeNull();
    expect(path?.cost).toBe(9656);
    for (const cell of path?.cells ?? []) expect(grid.isBlocked(cell)).toBe(false);
    expect(path?.cells[0]).toBe(grid.index(0, 3));
    expect(path?.cells[path.cells.length - 1]).toBe(grid.index(6, 3));
  });

  it("refuses to cut a blocked corner", () => {
    const grid = makeGrid({ width: 3, height: 3, blocked: [[1, 0], [0, 1]] });
    expect(plan(grid, [0, 0], [1, 1])).toBeNull();

    const single = makeGrid({ width: 2, height: 2, blocked: [[1, 0]] });
    expect(single.canStep(single.index(0, 0), single.index(1, 1))).toBe(false);
    expect(plan(single, [0, 0], [1, 1])?.cost).toBe(2000);
  });

  it("treats a one metre cliff as impassable", () => {
    const grid = makeGrid({ width: 5, height: 5, heightAt: (x) => (x === 2 ? 100 : 0) });
    expect(plan(grid, [0, 2], [4, 2])).toBeNull();
  });

  it("walks a ramp with 25 cm steps", () => {
    const grid = makeGrid({ width: 5, height: 1, heightAt: (x) => x * 25 });
    const path = plan(grid, [0, 0], [4, 0]);
    expect(path).not.toBeNull();
    expect(path?.cost).toBe(8000);
    expect(grid.heightCmAtXZ(450, 50)).toBe(100);
  });

  it("walks a gentle step and rejects one above the slope limit", () => {
    // 坡度 700‰，一格一米：70 厘米以内可走，超过就挡住。
    const allowed = makeGrid({ width: 2, height: 1, heightAt: (x) => x * 30 });
    expect(plan(allowed, [0, 0], [1, 0])?.cost).toBe(2200);

    const denied = makeGrid({ width: 2, height: 1, heightAt: (x) => x * 80 });
    expect(plan(denied, [0, 0], [1, 0])).toBeNull();
  });

  it("rejects slopes above the limit even when the step is allowed", () => {
    const ok = makeGrid({ width: 2, height: 1, heightAt: (x) => x * 60, rules: { maxStepCm: 100 } });
    expect(plan(ok, [0, 0], [1, 0])?.cost).toBe(3400);

    const steep = makeGrid({ width: 2, height: 1, heightAt: (x) => x * 80, rules: { maxStepCm: 100 } });
    expect(plan(steep, [0, 0], [1, 0])).toBeNull();
  });

  it("applies road and downhill cost modifiers", () => {
    const road = makeGrid({ width: 2, height: 1, surface: (x) => (x === 1 ? 3 : 0) });
    expect(plan(road, [0, 0], [1, 0])?.cost).toBe(700);

    const downhill = makeGrid({ width: 2, height: 1, heightAt: (x) => -x * 25 });
    expect(plan(downhill, [0, 0], [1, 0])?.cost).toBe(750);
  });

  it("blocks deep water unless the cell is overridden", () => {
    const water = makeGrid({ width: 2, height: 1, surface: (x) => (x === 1 ? 5 : 0) });
    expect(plan(water, [0, 0], [1, 0])).toBeNull();

    const bridge = makeGrid({
      width: 2,
      height: 1,
      surface: (x) => (x === 1 ? 5 : 0),
      override: [[1, 0]],
    });
    expect(plan(bridge, [0, 0], [1, 0])?.cost).toBe(1000);
  });

  it("is deterministic across repeated searches", () => {
    const blocked: Array<[number, number]> = [];
    for (let z = 1; z <= 9; z += 2) {
      const gap = (z * 7) % 11;
      for (let x = 0; x <= 10; x += 1) {
        if (x !== gap) blocked.push([x, z]);
      }
    }
    const grid = makeGrid({ width: 11, height: 11, blocked });
    const start = grid.index(0, 0);
    const goal = grid.index(10, 10);
    const first = findCellPath(grid, start, goal, { cache: false });
    expect(first).not.toBeNull();
    for (let run = 0; run < 20; run += 1) {
      const next = findCellPath(grid, start, goal, { cache: false });
      expect(next?.cells).toEqual(first?.cells);
      expect(next?.cost).toBe(first?.cost);
    }
  });

  it("inflates obstacles by unit radius", () => {
    const blocked: Array<[number, number]> = [];
    for (let z = 0; z < 5; z += 1) {
      blocked.push([1, z]);
      blocked.push([3, z]);
    }
    const grid = makeGrid({ width: 5, height: 5, blocked });
    const start = grid.index(2, 0);
    const goal = grid.index(2, 4);
    expect(findCellPath(grid, start, goal, { radiusCm: 40, snap: false })).not.toBeNull();
    expect(findCellPath(grid, start, goal, { radiusCm: 80, snap: false })).toBeNull();
    expect(grid.isWalkable(grid.index(2, 2), grid.clearance(40))).toBe(true);
    expect(grid.isWalkable(grid.index(2, 2), grid.clearance(80))).toBe(false);
  });

  it("snaps a blocked click to the nearest walkable cell", () => {
    const grid = makeGrid({ width: 3, height: 3, blocked: [[1, 1]] });
    const path = plan(grid, [1, 1], [2, 2], { snap: true });
    expect(path).not.toBeNull();
    expect(path?.startCell).toBe(grid.index(1, 0));
  });

  it("finds the nearest walkable cell deterministically", () => {
    const grid = makeGrid({ width: 3, height: 3, blocked: [[1, 1]] });
    expect(grid.nearestWalkable(grid.index(1, 1))).toBe(grid.index(1, 0));
  });

  it("samples heights bilinearly between cell centres", () => {
    const grid = makeGrid({ width: 2, height: 2, heightAt: (x) => x * 100 });
    expect(grid.heightCmAtXZ(50, 50)).toBe(0);
    expect(grid.heightCmAtXZ(150, 50)).toBe(100);
    expect(grid.heightCmAtXZ(100, 50)).toBe(50);
    expect(grid.heightCmAtXZ(-500, 500)).toBe(0);
  });

  it("smooths a staircase into a direct line", () => {
    const grid = makeGrid({ width: 8, height: 8 });
    const raw = plan(grid, [0, 0], [7, 7], { smooth: false });
    expect(raw?.cells.length).toBeGreaterThan(2);
    const smooth = plan(grid, [0, 0], [7, 7]);
    expect(smooth?.points).toHaveLength(2);
    expect(smooth?.points[0]).toEqual(raw?.points[0]);
    expect(smooth?.points[1]).toEqual(raw?.points[raw.points.length - 1]);
  });
});