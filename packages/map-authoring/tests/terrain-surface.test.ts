import { describe, expect, it } from "vitest";
import { buildGridSurface } from "../src/terrain-surface";
import type { GridSurface } from "../src/terrain-surface";

function surfaceOf(
  width: number,
  height: number,
  heightCmAt: (x: number, z: number) => number,
  options: { cliffThresholdCm?: number; originX?: number; originZ?: number } = {},
): GridSurface {
  return buildGridSurface({ width, height, cellSizeCm: 100, heightCmAt }, options);
}

describe("grid surface", () => {
  it("keeps a gentle slope continuous and wall-free", () => {
    const surface = surfaceOf(4, 4, (x) => x * 100);
    expect(surface.cliffEdges).toBe(0);
    expect(surface.walls.length).toBe(0);
    expect(surface.indices.length).toBe(4 * 4 * 6);

    // 相邻两格共享的格角必须停在同一个高度，否则表面会裂开。
    for (let cz = 0; cz < 4; cz += 1) {
      for (let cx = 0; cx < 3; cx += 1) {
        const left = (cz * 4 + cx) * 4;
        const right = (cz * 4 + cx + 1) * 4;
        expect(surface.cellCornerHeights[left + 1]).toBeCloseTo(surface.cellCornerHeights[right], 6);
        expect(surface.cellCornerHeights[left + 3]).toBeCloseTo(surface.cellCornerHeights[right + 2], 6);
      }
    }

    const h = surface.heightAt(2.5, 2.5);
    expect(h).toBeCloseTo(2, 6);
  });

  it("turns a cliff into a step with a full-height wall", () => {
    const surface = surfaceOf(3, 1, (x) => (x >= 2 ? 300 : 0));
    expect(surface.cliffEdges).toBe(1);
    const wall = surface.walls[0];
    expect(wall.az).toBe(0);
    expect(wall.bz).toBe(1);
    expect(wall.top0).toBeCloseTo(3, 6);
    expect(wall.bottom0).toBeCloseTo(0, 6);
    expect(wall.top1).toBeCloseTo(3, 6);
    expect(wall.bottom1).toBeCloseTo(0, 6);

    // 高台一侧完整保留 3 米，低地一侧保持 0：整格高差变成一面竖墙。
    expect(surface.heightAt(2.5, 0.5)).toBeCloseTo(3, 6);
    expect(surface.heightAt(1.5, 0.5)).toBeCloseTo(0, 6);
    expect(surface.heightAt(1.999, 0.5)).toBeCloseTo(0, 6);
    expect(surface.heightAt(2.001, 0.5)).toBeCloseTo(3, 6);
  });

  it("keeps a plateau at its own height right up to the rim", () => {
    const surface = surfaceOf(5, 3, (x, z) => (x >= 1 && x <= 3 && z === 1 ? 240 : 0));
    // 台地四条边至少各有一段墙；边缘台阶处还会有几段很矮的补缝墙。
    expect(surface.cliffEdges).toBeGreaterThanOrEqual(8);
    const rim = surface.walls.find((wall) => wall.ax === 1 && wall.az === 1 && wall.top0 > 2);
    expect(rim).toBeTruthy();
    expect(rim!.top0).toBeCloseTo(2.4, 6);
    expect(rim!.bottom0).toBeCloseTo(0, 6);
  });

  it("fills every disconnected cell edge with a wall", () => {
    const surface = surfaceOf(8, 8, (x, z) => (x < 4 ? 0 : 200) + (z === 3 ? 60 : 0));
    for (let cz = 0; cz < 8; cz += 1) {
      for (let cx = 0; cx < 7; cx += 1) {
        const east = surface.cellCornerHeights[(cz * 8 + cx) * 4 + 1];
        const west = surface.cellCornerHeights[(cz * 8 + cx + 1) * 4];
        if (Math.abs(east - west) < 1e-6) continue;
        // 顶点不共点的地方一定有一面墙沿这条边补上。
        expect(
          surface.walls.some(
            (wall) => wall.ax === cx + 1 && wall.az <= cz + 1e-9 && wall.bz >= cz + 1 - 1e-9,
          ),
        ).toBe(true);
      }
    }
  });

  it("honours the origin and the cliff threshold", () => {
    const flat = surfaceOf(2, 1, () => 150, { originX: -10, originZ: 20 });
    expect(flat.cliffEdges).toBe(0);
    expect(flat.heightAt(-10 + 0.5, 20.5)).toBeCloseTo(1.5, 6);
    expect(flat.positions[0]).toBeCloseTo(-10, 6);
    expect(flat.positions[2]).toBeCloseTo(20, 6);

    const steep = surfaceOf(2, 1, (x) => (x === 1 ? 150 : 0), { cliffThresholdCm: 150 });
    expect(steep.cliffEdges).toBe(1);
    const relaxed = surfaceOf(2, 1, (x) => (x === 1 ? 150 : 0), { cliffThresholdCm: 200 });
    expect(relaxed.cliffEdges).toBe(0);
  });
});