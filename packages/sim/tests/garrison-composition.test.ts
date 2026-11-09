import { describe, expect, it } from "vitest";
import { encodeBitmapBase64, encodeInt16Base64, encodeUint8Base64 } from "@marchlands/nav";
import { createGame, step } from "../src";
import type { MapDef } from "../src/types";
import { TIMED_RULES } from "./fixtures";

const MAP: MapDef = {
  schema: 1,
  slug: "garrison-composition",
  name: "Garrison Composition",
  biome: "test",
  size: [400, 400],
  scale: 0.1,
  ruleset: "1",
  players: [
    { id: 1, name: "P1", color: "green", ai: false },
    { id: 2, name: "P2", color: "red", ai: true },
  ],
  cities: [
    { id: "a", kind: "archer", owner: 1, level: 1, pop: 10, pos: [-100, 0], layer: 0 },
    { id: "b", kind: "warrior", owner: 1, level: 1, pop: 10, pos: [100, 0], layer: 0 },
    { id: "g", kind: "granary", owner: 1, level: 1, pop: 0, pos: [0, 0], layer: 0 },
    { id: "c", kind: "barbarian", owner: 2, level: 1, pop: 10, pos: [0, 100], layer: 0 },
  ],
  edges: [
    { from: "a", to: "g", length: 100 },
    { from: "b", to: "g", length: 100 },
    { from: "g", to: "c", length: 100 },
  ],
  objectives: [{ type: "capture_all" }],
};


const WIDTH = 40;
const HEIGHT = 20;

function gridMap(): MapDef {
  const cells = WIDTH * HEIGHT;
  return {
    schema: 3,
    navigation: "grid",
    slug: "garrison-grid",
    name: "Garrison Grid",
    biome: "test",
    size: [400, 200],
    scale: 0.1,
    ruleset: "1",
    players: [
      { id: 1, name: "P1", color: "green", ai: false },
      { id: 2, name: "P2", color: "red", ai: true },
    ],
    cities: [
      { id: "a", kind: "archer", owner: 1, level: 1, pop: 10, pos: [-150, 0], layer: 0, footprintCm: 800, captureRadiusCm: 400 },
      { id: "b", kind: "warrior", owner: 1, level: 1, pop: 10, pos: [150, 0], layer: 0, footprintCm: 800, captureRadiusCm: 400 },
      { id: "g", kind: "granary", owner: 1, level: 1, pop: 0, pos: [0, 50], layer: 0, footprintCm: 800, captureRadiusCm: 400 },
      { id: "c", kind: "barbarian", owner: 2, level: 1, pop: 10, pos: [0, -100], layer: 0, footprintCm: 800, captureRadiusCm: 400 },
    ],
    edges: [],
    objectives: [{ type: "capture_all" }],
    grid: {
      cellSizeCm: 100,
      width: WIDTH,
      height: HEIGHT,
      heightCm: encodeInt16Base64(new Int16Array(cells)),
      surface: encodeUint8Base64(new Uint8Array(cells)),
      blocked: encodeBitmapBase64(new Uint8Array(cells)),
      walkableOverride: encodeBitmapBase64(new Uint8Array(cells)),
    },
  };
}

describe("驻军兵种账本", () => {
  it("分别记录不同兵种，并按兵种分别派兵", () => {
    let state = createGame(MAP, 1, TIMED_RULES);
    state = step(state, [
      { type: "send", from: "a", to: "g" },
      { type: "send", from: "b", to: "g" },
    ]).state;
    for (let tick = 0; tick < 120; tick += 1) state = step(state, []).state;

    const granary = state.cities.find((city) => city.id === "g");
    if (!granary) throw new Error("missing granary");
    expect(granary.pop).toBe(10);
    expect(granary.garrison.archer).toBe(5);
    expect(granary.garrison.warrior).toBe(5);
    expect(state.squads).toHaveLength(0);

    const result = step(state, [{ type: "send", from: "g", to: "c" }]);
    state = result.state;
    expect(result.rejected).toHaveLength(0);
    expect(state.squads).toHaveLength(2);
    expect(
      state.squads
        .map((squad) => [squad.unitKind, squad.count] as const)
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    ).toEqual([
      ["archer", 2],
      ["warrior", 2],
    ]);
    const after = state.cities.find((city) => city.id === "g");
    if (!after) throw new Error("missing granary after dispatch");
    expect(after.garrison.archer).toBe(3);
    expect(after.garrison.warrior).toBe(3);
    expect(after.pop).toBe(6);
  });



  it("网格地图也按兵种分别记账和派兵", () => {
    let state = createGame(gridMap(), 1, TIMED_RULES);
    state = step(state, [
      { type: "send", from: "a", to: "g" },
      { type: "send", from: "b", to: "g" },
    ]).state;
    for (let tick = 0; tick < 200; tick += 1) state = step(state, []).state;
    const granary = state.cities.find((city) => city.id === "g");
    if (!granary) throw new Error("missing grid granary");
    expect(granary.garrison.archer).toBe(5);
    expect(granary.garrison.warrior).toBe(5);

    const result = step(state, [{ type: "send", from: "g", to: "c" }]);
    state = result.state;
    expect(result.rejected).toHaveLength(0);
    expect(state.squads).toHaveLength(2);
    expect(
      state.squads
        .map((squad) => [squad.unitKind, squad.count] as const)
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    ).toEqual([
      ["archer", 2],
      ["warrior", 2],
    ]);
  });

  it("城破后按进攻兵种记录新驻军", () => {
    let state = createGame(MAP, 1, TIMED_RULES);
    const target = state.cities.find((city) => city.id === "c");
    if (!target) throw new Error("missing target");
    target.pop = 1;
    state = step(state, [{ type: "send", from: "a", to: "c" }]).state;
    for (let tick = 0; tick < 120 && state.cities.find((city) => city.id === "c")?.owner !== 1; tick += 1) {
      state = step(state, []).state;
    }
    const captured = state.cities.find((city) => city.id === "c");
    if (!captured) throw new Error("missing captured city");
    expect(captured.owner).toBe(1);
    expect(captured.garrison.archer).toBe(captured.pop);
    expect(captured.garrison.warrior).toBe(0);
  });
});
