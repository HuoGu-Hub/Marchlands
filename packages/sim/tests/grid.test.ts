import { describe, expect, it } from "vitest";
import { encodeBitmapBase64, encodeInt16Base64, encodeUint8Base64 } from "@marchlands/nav";
import { createAi, createGame, hash, step } from "../src";
import type { MapDef } from "../src/types";

const WIDTH = 40;
const HEIGHT = 20;

function gridMap(blockedCells: Array<[number, number]> = [], aiOwner = 2): MapDef {
  const cells = WIDTH * HEIGHT;
  const blocked = new Uint8Array(cells);
  for (const [x, z] of blockedCells) blocked[z * WIDTH + x] = 1;
  return {
    schema: 2,
    navigation: "grid",
    slug: "grid-sim",
    name: "Grid Sim",
    biome: "frontier",
    size: [400, 200],
    scale: 0.1,
    ruleset: "1",
    players: [
      { id: 1, name: "P1", color: "green", ai: false },
      { id: 2, name: "P2", color: "red", ai: true },
    ],
    cities: [
      {
        id: "a",
        kind: "town",
        owner: 1,
        level: 1,
        pop: 30,
        pos: [-150, 0],
        layer: 0,
        footprintCm: 800,
        captureRadiusCm: 400,
      },
      {
        id: "b",
        kind: "town",
        owner: aiOwner as 1 | 2,
        level: 1,
        pop: 10,
        pos: [150, 0],
        layer: 0,
        footprintCm: 800,
        captureRadiusCm: 400,
      },
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

describe("grid simulation", () => {
  it("sends a squad along the grid and captures the target", () => {
    let state = createGame(gridMap(), 1);
    expect(state.nav).not.toBeNull();
    state = step(state, [{ type: "send", from: "a", to: "b" }]).state;
    expect(state.squads).toHaveLength(1);
    const squad = state.squads[0];
    expect(squad.xCm).toBeGreaterThan(-1500);
    expect(squad.arrivalTick).toBeGreaterThan(1);
    expect(squad.gridPath?.length).toBeGreaterThan(2);

    let arrived = false;
    for (let tick = 0; tick < 400 && !arrived; tick += 1) {
      state = step(state, []).state;
      arrived = state.cities.find((city) => city.id === "b")?.owner === 1;
      if (arrived) {
        expect(state.events.some((event) => event.type === "squadArrived")).toBe(true);
      }
    }
    expect(arrived).toBe(true);
    expect(state.squads).toHaveLength(0);
  });

  it("rejects a grid destination split by a wall", () => {
    const blocked: Array<[number, number]> = [];
    for (let z = 0; z < HEIGHT; z += 1) blocked.push([20, z]);
    let state = createGame(gridMap(blocked), 1);
    const result = step(state, [{ type: "send", from: "a", to: "b" }]);
    state = result.state;
    expect(result.rejected[0]?.reason).toBe("no_route");
    expect(state.squads).toHaveLength(0);
  });

  it("keeps grid replays deterministic", () => {
    const play = () => {
      let state = createGame(gridMap(), 7);
      state = step(state, [{ type: "send", from: "a", to: "b" }]).state;
      for (let tick = 0; tick < 40; tick += 1) state = step(state, []).state;
      return state;
    };
    const first = play();
    const second = play();
    expect(hash(first)).toBe(hash(second));
    expect(first.squads[0]?.xCm).toBeGreaterThan(-1500);
  });

  it("finishes a full grid match with the AI", () => {
    const map = gridMap();
    map.cities[0].pop = 5;
    map.cities[1].pop = 30;
    let state = createGame(map, 11);
    const ai = createAi(2);
    for (let tick = 0; tick < 4000 && state.status === "playing"; tick += 1) {
      state = step(state, ai.decide(state)).state;
    }
    expect(state.status).toBe("finished");
    expect(state.winner).toBe(2);
  });

  it("lets the AI send squads along the grid", () => {
    const map = gridMap();
    map.cities[0].pop = 2;
    map.cities[1].pop = 30;
    const state = createGame(map, 3);
    const commands = createAi(2).decide(state);
    expect(commands.some((command) => command.type === "send" && command.from === "b")).toBe(true);
    const next = step(state, commands).state;
    expect(next.squads.some((squad) => squad.owner === 2)).toBe(true);
  });
});
