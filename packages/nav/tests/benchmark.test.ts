import { describe, expect, it } from "vitest";
import { planPath } from "../src";
import { makeGrid } from "./helpers";

describe("nav benchmark", () => {
  it("records the 8800 cell pathfinding baseline", () => {
    const width = 110;
    const height = 80;
    const blocked: Array<[number, number]> = [];
    for (let z = 0; z < height; z += 1) {
      if (z !== 40) blocked.push([55, z]);
    }
    expect(width * height).toBe(8800);
    const grid = makeGrid({ width, height, blocked });
    const from = grid.centerOf(grid.index(2, 2));
    const to = grid.centerOf(grid.index(107, 77));

    const warm = planPath(grid, from, to, { cache: false });
    expect(warm).not.toBeNull();

    const samples: number[] = [];
    for (let run = 0; run < 25; run += 1) {
      const started = performance.now();
      const path = planPath(grid, from, to, { cache: false });
      samples.push(performance.now() - started);
      expect(path?.cost).toBe(warm?.cost);
    }
    samples.sort((a, b) => a - b);
    console.log(
      "nav 8800 cells: min=" +
        samples[0].toFixed(2) +
        "ms p50=" +
        samples[12].toFixed(2) +
        "ms max=" +
        samples[24].toFixed(2) +
        "ms",
    );
    expect(samples[12]).toBeLessThan(25);
  });
});
