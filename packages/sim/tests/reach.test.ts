import { describe, expect, it } from "vitest";
import { encodeBitmapBase64, encodeInt16Base64, encodeUint8Base64 } from "@marchlands/nav";
import { createGame, sendReachableTargets, step } from "../src";
import type { MapDef } from "../src/types";
import { THREE_CITY_MAP, TIMED_RULES } from "./fixtures";

function friendly(overrides: Partial<MapDef> = {}): MapDef {
  return { ...THREE_CITY_MAP, transit: "friendly", ...overrides };
}

describe("sendReachableTargets", () => {
  it("only reaches the adjacent neutral town when the road is blocked", () => {
    const state = createGame(friendly(), 1);
    expect(sendReachableTargets(state, "a")).toEqual(["b"]);
  });

  it("reaches through a neutral town whose transit is open", () => {
    const map = friendly({
      cities: THREE_CITY_MAP.cities.map((city) => (city.id === "b" ? { ...city, transit: "open" } : city)),
    });
    const state = createGame(map, 1);
    expect(sendReachableTargets(state, "a")).toEqual(["b", "c"]);
  });

  it("reaches through a friendly town", () => {
    const map = friendly({
      cities: THREE_CITY_MAP.cities.map((city) => (city.id === "b" ? { ...city, owner: 1 } : city)),
    });
    const state = createGame(map, 1);
    expect(sendReachableTargets(state, "a")).toEqual(["b", "c"]);
  });

  it("reaches every town on a map without transit rules", () => {
    const state = createGame(THREE_CITY_MAP, 1);
    expect(sendReachableTargets(state, "a")).toEqual(["b", "c"]);
  });

  it("reports no target when the garrison is too small", () => {
    const map = friendly({
      cities: THREE_CITY_MAP.cities.map((city) => (city.id === "a" ? { ...city, pop: 1 } : city)),
    });
    const state = createGame(map, 1);
    expect(sendReachableTargets(state, "a")).toEqual([]);
  });

  it("reports no target from a non-producing site", () => {
    const map = friendly({
      cities: THREE_CITY_MAP.cities.map((city) => (city.id === "a" ? { ...city, kind: "granary" as const } : city)),
    });
    const state = createGame(map, 1);
    expect(sendReachableTargets(state, "a")).toEqual([]);
  });

  it("agrees with the send command for every target", () => {
    const state = createGame(friendly(), 1);
    for (const target of ["b", "c"]) {
      const reachable = sendReachableTargets(state, "a").includes(target);
      const rejected = step(state, [{ type: "send", from: "a", to: target }]).rejected;
      expect(reachable).toBe(rejected.length === 0);
    }
  });
});

const WIDTH = 40;
const HEIGHT = 20;

function gridMap(blockedCells: Array<[number, number]> = []): MapDef {
  const cells = WIDTH * HEIGHT;
  const blocked = new Uint8Array(cells);
  for (const [x, z] of blockedCells) blocked[z * WIDTH + x] = 1;
  return {
    schema: 2,
    navigation: "grid",
    slug: "grid-reach",
    name: "Grid Reach",
    biome: "frontier",
    size: [400, 200],
    scale: 0.1,
    ruleset: "1",
    players: [
      { id: 1, name: "P1", color: "green", ai: false },
      { id: 2, name: "P2", color: "red", ai: true },
    ],
    cities: [
      { id: "a", kind: "barracks", owner: 1, level: 1, pop: 30, pos: [-150, 0], layer: 0 },
      { id: "b", kind: "barracks", owner: 2, level: 1, pop: 10, pos: [150, 0], layer: 0 },
    ],
    edges: [],
    objectives: [{ type: "capture_all" }],
    grid: {
      cellSizeCm: 100,
      width: WIDTH,
      height: HEIGHT,
      heightCm: encodeInt16Base64(new Int16Array(cells)),
      surface: encodeUint8Base64(new Uint8Array(cells)),
      blocked: encodeBitmapBase64(blocked),
      walkableOverride: encodeBitmapBase64(new Uint8Array(cells)),
    },
  };
}

describe("sendReachableTargets on grid maps", () => {
  it("reaches a town across open ground", () => {
    const state = createGame(gridMap(), 1, TIMED_RULES);
    expect(sendReachableTargets(state, "a")).toEqual(["b"]);
  });

  it("reports nothing when a wall splits the map", () => {
    const blocked: Array<[number, number]> = [];
    for (let z = 0; z < HEIGHT; z += 1) blocked.push([20, z]);
    const state = createGame(gridMap(blocked), 1, TIMED_RULES);
    expect(sendReachableTargets(state, "a")).toEqual([]);
  });
});
