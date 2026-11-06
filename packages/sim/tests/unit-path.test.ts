import { describe, expect, it } from "vitest";
import {
  Surface,
  encodeBitmapBase64,
  encodeInt16Base64,
  encodeUint8Base64,
} from "@marchlands/nav";
import type { MapDef } from "../src/types";
import { createUnitNavGrid, planGridRoute } from "../src/grid";

function gridMap(width: number, height: number, heightsCm: number[], surface: number[], blocked: number[] = []): MapDef {
  const cells = width * height;
  const blockedMask = new Uint8Array(cells);
  for (const cell of blocked) blockedMask[cell] = 1;
  return {
    schema: 2,
    navigation: "grid",
    slug: "unit-test",
    name: "unit-test",
    biome: "frontier",
    size: [width * 100, height * 100],
    scale: 0.1,
    ruleset: "1",
    players: [
      { id: 1, name: "P1", color: "green", ai: false },
      { id: 2, name: "P2", color: "red", ai: true },
    ],
    cities: [],
    edges: [],
    objectives: [],
    grid: {
      cellSizeCm: 100,
      width,
      height,
      heightCm: encodeInt16Base64(new Int16Array(heightsCm)),
      surface: encodeUint8Base64(new Uint8Array(surface)),
      blocked: encodeBitmapBase64(blockedMask),
      walkableOverride: encodeBitmapBase64(new Uint8Array(cells)),
    },
  };
}

function center(map: MapDef, x: number, z: number): [number, number] {
  const offsetX = map.size[0] * 5;
  const offsetZ = map.size[1] * 5;
  return [x * 100 + 50 - offsetX, z * 100 + 50 - offsetZ];
}

describe("unit grid routing", () => {
  it("rejects a height step above the unit profile", () => {
    const map = gridMap(2, 1, [0, 70], [Surface.Grass, Surface.Grass]);
    const infantry = createUnitNavGrid(map, [], 1, "barbarian");
    const elite = createUnitNavGrid(map, [], 1, "mage");
    if (!infantry || !elite) throw new Error("missing nav");
    expect(planGridRoute(map, infantry, center(map, 0, 0), center(map, 1, 0), 40, "barbarian")).toBeNull();
    expect(planGridRoute(map, elite, center(map, 0, 0), center(map, 1, 0), 40, "mage")).not.toBeNull();
  });

  it("blocks a cliff for heavy units but lets a mage over it", () => {
    // 60 厘米高差在一米格上是 600‰，精锐战士 400‰ 上不去，法师 900‰ 可以。
    const map = gridMap(2, 1, [0, 60], [Surface.Grass, Surface.Grass]);
    const warrior = createUnitNavGrid(map, [], 1, "warrior");
    const mage = createUnitNavGrid(map, [], 1, "mage");
    if (!warrior || !mage) throw new Error("missing nav");
    expect(planGridRoute(map, warrior, center(map, 0, 0), center(map, 1, 0), 40, "warrior")).toBeNull();
    expect(planGridRoute(map, mage, center(map, 0, 0), center(map, 1, 0), 40, "mage")).not.toBeNull();
  });

  it("uses the map climb override for every unit", () => {
    const map = gridMap(2, 1, [0, 70], [Surface.Grass, Surface.Grass]);
    map.climbCm = 50;
    const tight = createUnitNavGrid(map, [], 1, "barbarian");
    if (!tight) throw new Error("missing nav");
    expect(planGridRoute(map, tight, center(map, 0, 0), center(map, 1, 0), 40, "barbarian")).toBeNull();
    map.climbCm = 80;
    const loose = createUnitNavGrid(map, [], 1, "barbarian");
    if (!loose) throw new Error("missing nav");
    expect(planGridRoute(map, loose, center(map, 0, 0), center(map, 1, 0), 40, "barbarian")).not.toBeNull();
  });

  it("filters surfaces by unit profile", () => {
    const map = gridMap(2, 1, [0, 0], [Surface.Grass, Surface.DeepWater]);
    const infantry = createUnitNavGrid(map, [], 1, "barbarian");
    const elite = createUnitNavGrid(map, [], 1, "mage");
    if (!infantry || !elite) throw new Error("missing nav");
    expect(planGridRoute(map, infantry, center(map, 0, 0), center(map, 1, 0), 40, "barbarian")).toBeNull();
    expect(planGridRoute(map, elite, center(map, 0, 0), center(map, 1, 0), 40, "mage")).not.toBeNull();
  });

  it("requires a 2x2 corridor for shield troops", () => {
    const width = 4;
    const height = 5;
    const blocked: number[] = [];
    for (const z of [2, 3]) {
      blocked.push(z * width + 0, z * width + 2, z * width + 3);
    }
    const map = gridMap(width, height, new Array(width * height).fill(0), new Array(width * height).fill(Surface.Grass), blocked);
    const infantry = createUnitNavGrid(map, [], 1, "barbarian");
    const shield = createUnitNavGrid(map, [], 1, "warrior");
    if (!infantry || !shield) throw new Error("missing nav");
    const from = center(map, 1, 1);
    const to = center(map, 1, 3);
    expect(planGridRoute(map, infantry, from, to, 40, "barbarian")).not.toBeNull();
    expect(planGridRoute(map, shield, from, to, 40, "warrior")).toBeNull();
  });
});
