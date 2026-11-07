import { describe, expect, it } from "vitest";
import { makeGrid } from "./helpers";

/** 两个相邻格子之间能不能走，只看坡度。 */
describe("grid slope", () => {
  it("measures the slope of one step in permille", () => {
    const grid = makeGrid({ width: 3, height: 1, heightAt: (x) => x * 30 });
    expect(grid.stepSlopePermille(grid.index(0, 0), grid.index(1, 0))).toBe(300);
    expect(grid.stepSlopePermille(grid.index(1, 0), grid.index(0, 0))).toBe(300);
  });

  it("uses the diagonal run for diagonal steps", () => {
    const grid = makeGrid({ width: 2, height: 2, heightAt: (x, z) => (x === 1 && z === 1 ? 30 : 0) });
    // 斜走水平距离 1.414 米，30 厘米的落差只有 212‰。
    expect(grid.stepSlopePermille(grid.index(1, 0), grid.index(0, 1))).toBe(0);
    expect(grid.stepSlopePermille(grid.index(0, 0), grid.index(1, 1))).toBe(212);
  });

  it("keeps the same physical slope limit at half-metre cells", () => {
    // 同样是 300‰：1 米格要爬 30 厘米，半米格只爬 15 厘米。
    const coarse = makeGrid({ width: 2, height: 1, cellSizeCm: 100, heightAt: (x) => x * 30, rules: { maxSlopePermille: 300 } });
    expect(coarse.canStep(coarse.index(0, 0), coarse.index(1, 0))).toBe(true);

    const fineOk = makeGrid({ width: 2, height: 1, cellSizeCm: 50, heightAt: (x) => x * 15, rules: { maxSlopePermille: 300 } });
    expect(fineOk.canStep(fineOk.index(0, 0), fineOk.index(1, 0))).toBe(true);

    const fineSteep = makeGrid({ width: 2, height: 1, cellSizeCm: 50, heightAt: (x) => x * 20, rules: { maxSlopePermille: 300 } });
    expect(fineSteep.canStep(fineSteep.index(0, 0), fineSteep.index(1, 0))).toBe(false);
  });

  it("reports the steepest step around a cell without blocking the cell itself", () => {
    const grid = makeGrid({ width: 3, height: 3, heightAt: (x, z) => (x === 1 && z === 1 ? 90 : 0) });
    const middle = grid.index(1, 1);
    expect(grid.slopePermille(middle)).toBe(900);
    expect(grid.slopePermille(grid.index(0, 1))).toBe(900);
    expect(grid.slopePermille(grid.index(0, 0))).toBe(0);
    // 台面本身仍是可站立的格子；挡住的是跨过那条陡边的移动。
    expect(grid.isWalkable(middle)).toBe(true);
    expect(grid.canStep(middle, grid.index(0, 1))).toBe(false);
  });

  it("crosses a gentle hill and refuses a cliff", () => {
    const gentle = makeGrid({ width: 5, height: 1, heightAt: (x) => x * 30 });
    for (let x = 0; x < 4; x += 1) {
      expect(gentle.canStep(gentle.index(x, 0), gentle.index(x + 1, 0))).toBe(true);
    }
    const cliff = makeGrid({ width: 3, height: 1, heightAt: (x) => (x === 1 ? 200 : 0) });
    expect(cliff.canStep(cliff.index(0, 0), cliff.index(1, 0))).toBe(false);
    expect(cliff.canStep(cliff.index(1, 0), cliff.index(2, 0))).toBe(false);
  });
});
