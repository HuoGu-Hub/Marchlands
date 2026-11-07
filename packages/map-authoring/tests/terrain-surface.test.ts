import { describe, expect, it } from "vitest";
import { buildGridSurface } from "../src/terrain-surface";
import type { GridSurface } from "../src/terrain-surface";

function surfaceOf(
  width: number,
  height: number,
  heightCmAt: (x: number, z: number) => number,
  options: { samplesPerCell?: number; originX?: number; originZ?: number; seed?: number; relief?: number; warp?: number } = {},
): GridSurface {
  return buildGridSurface(
    { width, height, cellSizeCm: 100, heightCmAt },
    { samplesPerCell: 2, smoothing: 0, relief: 0, warp: 0, ...options },
  );
}

describe("grid surface", () => {
  it("keeps a flat grid flat and covers every cell", () => {
    const surface = surfaceOf(4, 3, () => 150);
    expect(surface.cols).toBe(4 * 2 + 1);
    expect(surface.rows).toBe(3 * 2 + 1);
    expect(surface.indices.length).toBe(4 * 2 * 3 * 2 * 6);
    expect(surface.minY).toBeCloseTo(1.5, 6);
    expect(surface.maxY).toBeCloseTo(1.5, 6);
    expect(surface.heightAt(0.5, 0.5)).toBeCloseTo(1.5, 6);
    expect(surface.heightAt(3.99, 2.99)).toBeCloseTo(1.5, 6);
  });

  it("is continuous across cell borders", () => {
    const surface = surfaceOf(4, 4, (x) => x * 100);
    // 相邻格共享采样点：跨格线的左右两侧必须是同一高度，不能出现折角裂缝。
    for (let border = 1; border < 4; border += 1) {
      const left = surface.heightAt(border - 1e-4, 2.3);
      const right = surface.heightAt(border + 1e-4, 2.3);
      expect(Math.abs(left - right)).toBeLessThan(1e-3);
    }
    // 格心高度仍按双三次落在原始采样上。
    expect(surface.heightAt(0.5, 0.5)).toBeCloseTo(0, 6);
    expect(surface.heightAt(2.5, 0.5)).toBeCloseTo(2, 6);
  });

  it("turns a one-metre cliff into a ramp instead of a vertical wall", () => {
    const surface = surfaceOf(3, 1, (x) => (x >= 2 ? 300 : 0));
    // 一格高差被摊成约一格的连续坡：没有断开的面，也没有独立墙面。
    expect(surface.heightAt(1.55, 0.5)).toBeLessThan(0.35);
    expect(surface.heightAt(2.0, 0.5)).toBeCloseTo(1.5, 3);
    expect(surface.heightAt(2.45, 0.5)).toBeGreaterThan(2.65);
    // 台面内部仍是原始高度。
    expect(surface.heightAt(2.75, 0.5)).toBeCloseTo(3, 2);
  });

  it("does not overshoot the authored heights", () => {
    const surface = surfaceOf(5, 3, (x) => (x >= 2 ? 240 : 0));
    expect(surface.minY).toBeGreaterThanOrEqual(-1e-4);
    expect(surface.maxY).toBeLessThanOrEqual(2.4001);
    for (let step = 0; step <= 50; step += 1) {
      const y = surface.heightAt((step / 50) * 4.99, 1.5);
      expect(y).toBeGreaterThanOrEqual(-1e-4);
      expect(y).toBeLessThanOrEqual(2.4001);
    }
  });

  it("honours the origin", () => {
    const surface = surfaceOf(2, 1, () => 50, { originX: -10, originZ: 20 });
    expect(surface.positions[0]).toBeCloseTo(-10, 6);
    expect(surface.positions[2]).toBeCloseTo(20, 6);
    expect(surface.heightAt(-10 + 0.5, 20.5)).toBeCloseTo(0.5, 6);
  });

  it("adds relief on cliffs and keeps flats almost unchanged", () => {
    const flat = surfaceOf(6, 6, () => 100, { seed: 7, relief: 0.42, warp: 0.5 });
    for (let index = 1; index < flat.positions.length; index += 3) {
      expect(Math.abs(flat.positions[index] - 1)).toBeLessThan(0.08);
    }
    const cliff = surfaceOf(6, 6, (x) => (x >= 3 ? 400 : 0), { seed: 7, relief: 0.42, warp: 0.5 });
    let spread = 0;
    for (let index = 1; index < cliff.positions.length; index += 3) {
      spread = Math.max(spread, Math.abs(cliff.positions[index] - (index % 24 < 12 ? 0 : 4)));
    }
    expect(spread).toBeGreaterThan(0.05);
  });

  it("is reproducible for the same seed", () => {
    const build = (): Float32Array =>
      surfaceOf(5, 4, (x, z) => Math.round((x * 37 + z * 61) % 180), { seed: 99, relief: 0.4, warp: 0.4 }).positions;
    const first = build();
    const second = build();
    expect(Array.from(first)).toEqual(Array.from(second));
    const other = surfaceOf(5, 4, (x, z) => Math.round((x * 37 + z * 61) % 180), {
      seed: 100,
      relief: 0.4,
      warp: 0.4,
    }).positions;
    expect(Array.from(other)).not.toEqual(Array.from(first));
  });
});
