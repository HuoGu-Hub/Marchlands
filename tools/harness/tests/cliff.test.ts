import { describe, expect, it } from "vitest";
import { loadContent } from "@marchlands/content/node";
import { createUnitNavGrid, planGridRoute } from "@marchlands/sim";
import type { MapDef } from "@marchlands/sim";
import { runMatch } from "../src/match";

const highlandContent = loadContent("maps/highland01.json");
const highland = highlandContent.map;
const crossroads = loadContent("maps/crossroads01.json").map;

function gridOf(map: MapDef) {
  const grid = map.grid;
  if (!grid) throw new Error("missing grid");
  const buffer = Buffer.from(grid.heightCm, "base64");
  const heights = new Int16Array(buffer.length / 2);
  for (let index = 0; index < heights.length; index += 1) heights[index] = buffer.readInt16LE(index * 2);
  const surfaces = Buffer.from(grid.surface, "base64");
  return { grid, heights, surfaces };
}

function cmOf(map: MapDef, cellX: number, cellZ: number): [number, number] {
  const grid = map.grid;
  if (!grid) throw new Error("missing grid");
  return [
    (cellX + 0.5) * grid.cellSizeCm - map.size[0] * 5,
    (cellZ + 0.5) * grid.cellSizeCm - map.size[1] * 5,
  ];
}

describe("cliffs", () => {
  it("has cliff edges that no unit can step over", () => {
    const { grid, heights } = gridOf(highland);
    let edges = 0;
    let sample: [number, number] | null = null;
    for (let z = 0; z < grid.height - 1; z += 1) {
      for (let x = 0; x < grid.width - 1; x += 1) {
        const index = z * grid.width + x;
        const right = heights[index + 1];
        if (Math.abs(right - heights[index]) >= 120) {
          edges += 1;
          if (!sample) sample = [index, index + 1];
        }
      }
    }
    expect(edges).toBeGreaterThan(0);
    for (const kind of ["warrior", "barbarian", "archer", "ranger", "cavalry", "mage"] as const) {
      const nav = createUnitNavGrid(highland, [], 1, kind);
      if (!nav) throw new Error("missing nav");
      expect(nav.canStep(sample![0], sample![1]), kind).toBe(false);
    }
  });

  it("carves ramps through cliffs", () => {
    const { grid, heights, surfaces } = gridOf(highland);
    let rampCells = 0;
    for (let z = 1; z < grid.height - 1; z += 1) {
      for (let x = 1; x < grid.width - 1; x += 1) {
        const index = z * grid.width + x;
        if (surfaces[index] !== 3) continue;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const neighbor = (z + dz) * grid.width + (x + dx);
          if (Math.abs(heights[neighbor] - heights[index]) >= 120 && heights[neighbor] > heights[index]) {
            rampCells += 1;
            break;
          }
        }
      }
    }
    expect(rampCells).toBeGreaterThan(0);
  });

  it("keeps straight-line distances on open ground", () => {
    const nav = createUnitNavGrid(crossroads, [], 1, "warrior");
    if (!nav) throw new Error("missing nav");
    const from = cmOf(crossroads, 8, 30);
    const to = cmOf(crossroads, 40, 30);
    const route = planGridRoute(crossroads, nav, from, to, 40, "warrior");
    expect(route).not.toBeNull();
    const straight = Math.hypot(from[0] - to[0], from[1] - to[1]);
    expect(route!.distance).toBeLessThan(straight * 1.25);
  });

  it("finishes a full match on the hilly map", { timeout: 300000 }, () => {
    // 176×128 的网格图跑完整局要四十秒左右，超时放宽。
    const { state } = runMatch(highland, highlandContent.rules, 7);
    expect(state.status).toBe("finished");
    expect(state.tick).toBeLessThanOrEqual(highlandContent.rules.maxTicks);
  });
});
