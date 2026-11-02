import { describe, expect, it } from "vitest";
import { decodeBitmapBase64 } from "@marchlands/nav";
import { applyGridBrush, createGridDocument, gridCellFromGround } from "../src";

function center(document: ReturnType<typeof createGridDocument>): number {
  const grid = document.grid;
  if (!grid) throw new Error("missing grid");
  return 35 * grid.width + 35;
}

describe("grid brush", () => {
  it("maps ground coordinates to cells", () => {
    const document = createGridDocument();
    expect(gridCellFromGround(document, [0, 0])).toEqual([35, 35]);
    expect(gridCellFromGround(document, [-350, -350])).toEqual([0, 0]);
    expect(gridCellFromGround(document, [-400, 0])).toBeNull();
  });

  it("raises a smooth mound without mutating the source document", () => {
    const document = createGridDocument();
    const raised = applyGridBrush(document, { mode: "raise", cell: [35, 35], radiusCells: 2, strengthCm: 20 });
    const grid = raised.grid;
    if (!grid) throw new Error("missing grid");
    const index = center(raised);
    expect(grid.heightCm[index]).toBe(20);
    expect(grid.heightCm[index + 1]).toBeGreaterThan(0);
    expect(grid.heightCm[index + 1]).toBeLessThan(20);
    expect(document.grid?.heightCm[index]).toBe(0);
  });

  it("lowers, smooths and cuts cliffs", () => {
    const raised = applyGridBrush(createGridDocument(), { mode: "raise", cell: [35, 35], radiusCells: 1, strengthCm: 40 });
    const lowered = applyGridBrush(raised, { mode: "lower", cell: [35, 35], radiusCells: 0, strengthCm: 10 });
    expect(lowered.grid?.heightCm[center(lowered)]).toBe(30);

    const smoothed = applyGridBrush(raised, { mode: "smooth", cell: [35, 35], radiusCells: 1, strengthCm: 20 });
    expect(smoothed.grid?.heightCm[center(smoothed)]).toBeLessThan(40);

    const cliff = applyGridBrush(createGridDocument(), { mode: "cliff", cell: [35, 35], radiusCells: 1, strengthCm: 100 });
    expect(cliff.grid?.heightCm[center(cliff)]).toBe(100);
  });

  it("paints surfaces, water, blockers and walkable overrides", () => {
    const document = createGridDocument();
    const water = applyGridBrush(document, { mode: "water", cell: [35, 35], radiusCells: 1, strengthCm: 20 });
    expect(water.grid?.surface[center(water)]).toBe(4);

    const surface = applyGridBrush(document, { mode: "surface", cell: [35, 35], radiusCells: 1, strengthCm: 20, surface: 3 });
    expect(surface.grid?.surface[center(surface)]).toBe(3);

    const blocked = applyGridBrush(document, { mode: "blocker", cell: [35, 35], radiusCells: 0, strengthCm: 20 });
    if (!blocked.grid) throw new Error("missing grid");
    const flags = decodeBitmapBase64(blocked.grid.blocked, blocked.grid.width * blocked.grid.height);
    expect(flags[center(blocked)]).toBe(1);

    const passable = applyGridBrush(blocked, { mode: "passable", cell: [35, 35], radiusCells: 0, strengthCm: 20 });
    if (!passable.grid) throw new Error("missing grid");
    const overrides = decodeBitmapBase64(passable.grid.walkableOverride, passable.grid.width * passable.grid.height);
    expect(overrides[center(passable)]).toBe(1);
  });

  it("builds a ramp between two cells", () => {
    const document = createGridDocument();
    const grid = document.grid;
    if (!grid) throw new Error("missing grid");
    const start = 35 * grid.width + 30;
    const end = 35 * grid.width + 40;
    grid.heightCm[start] = 0;
    grid.heightCm[end] = 100;
    const ramp = applyGridBrush(document, {
      mode: "ramp",
      cell: [40, 35],
      startCell: [30, 35],
      radiusCells: 2,
      strengthCm: 20,
    });
    expect(ramp.grid?.heightCm[end]).toBe(100);
    expect(ramp.grid?.heightCm[35 * grid.width + 35]).toBe(50);
    expect(ramp.grid?.heightCm[start]).toBe(0);
  });
});
