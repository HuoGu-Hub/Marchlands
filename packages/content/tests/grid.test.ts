import { describe, expect, it } from "vitest";
import { encodeBitmapBase64, encodeInt16Base64, encodeUint8Base64 } from "@marchlands/nav";
import { mapHashOf, type MapDef } from "@marchlands/sim";
import { ContentError, validateMap } from "../src";

function gridMap(): MapDef {
  const width = 20;
  const height = 20;
  const cells = width * height;
  const map: MapDef = {
    schema: 2,
    navigation: "grid",
    mapHash: "0000000000000000",
    slug: "grid-test",
    name: "Grid Test",
    biome: "frontier",
    size: [200, 200],
    scale: 0.1,
    ruleset: "1",
    players: [
      { id: 1, name: "Player", color: "green", ai: false },
      { id: 2, name: "AI", color: "red", ai: true },
    ],
    cities: [
      { id: "c1", kind: "barbarian", owner: 1, level: 1, pop: 10, pos: [-50, 0], layer: 0 },
      { id: "c2", kind: "barbarian", owner: 2, level: 1, pop: 10, pos: [50, 0], layer: 0 },
    ],
    edges: [],
    objectives: [{ type: "capture_all" }],
    grid: {
      cellSizeCm: 100,
      width,
      height,
      heightCm: encodeInt16Base64(new Int16Array(cells)),
      surface: encodeUint8Base64(new Uint8Array(cells)),
      blocked: encodeBitmapBase64(new Uint8Array(cells)),
      walkableOverride: encodeBitmapBase64(new Uint8Array(cells)),
    },
  };
  map.mapHash = mapHashOf(map);
  return map;
}

describe("grid map validation", () => {
  it("accepts a schema 2 grid map without road edges", () => {
    const map = gridMap();
    expect(map.edges).toHaveLength(0);
    expect(() => validateMap(map)).not.toThrow();
  });

  it("rejects a grid that does not match the map size", () => {
    const map = gridMap();
    if (!map.grid) throw new Error("missing grid");
    map.grid = { ...map.grid, width: 21 };
    expect(() => validateMap(map)).toThrow(/grid.width/);
  });

  it("rejects a corrupt height payload", () => {
    const map = gridMap();
    if (!map.grid) throw new Error("missing grid");
    map.grid = { ...map.grid, heightCm: "AAAA" };
    expect(() => validateMap(map)).toThrow(/grid.heightCm/);
  });

  it("requires a map hash on schema 2", () => {
    const map = gridMap();
    delete map.mapHash;
    expect(() => validateMap(map)).toThrow(/mapHash/);
  });

  it("rejects a grid on graph navigation", () => {
    const map = gridMap();
    map.navigation = "graph";
    expect(() => validateMap(map)).toThrow(/grid only allowed/);
  });

  it("rejects a missing grid payload", () => {
    const map = gridMap();
    delete map.grid;
    expect(() => validateMap(map)).toThrow(ContentError);
  });
});