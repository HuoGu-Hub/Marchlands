import { describe, expect, it } from "vitest";
import { encodeBitmapBase64, encodeInt16Base64, encodeUint8Base64 } from "@marchlands/nav";
import { createGame, hash, reachableGridCells, reachableGridCities, sendReachableTargets, step } from "../src";
import type { MapDef, SimState } from "../src/types";
import { TIMED_RULES } from "./fixtures";

const WIDTH = 40;
const HEIGHT = 20;

function gridMap(blockedCells: Array<[number, number]> = []): MapDef {
  const cells = WIDTH * HEIGHT;
  const blocked = new Uint8Array(cells);
  for (const [x, z] of blockedCells) blocked[z * WIDTH + x] = 1;
  return {
    schema: 2,
    navigation: "grid",
    slug: "grid-cell",
    name: "Grid Cell",
    biome: "frontier",
    size: [400, 200],
    scale: 0.1,
    ruleset: "1",
    players: [
      { id: 1, name: "P1", color: "green", ai: false },
      { id: 2, name: "P2", color: "red", ai: true },
    ],
    cities: [
      { id: "a", kind: "barracks", owner: 1, level: 1, pop: 30, pos: [-150, 0], layer: 0, captureRadiusCm: 400 },
      { id: "b", kind: "barracks", owner: 2, level: 1, pop: 30, pos: [150, 0], layer: 0, captureRadiusCm: 400 },
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

function cellCenter(xCm: number, zCm: number): [number, number] {
  return [xCm, zCm];
}

function runUntilSettled(state: SimState, ticks = 800): SimState {
  let next = state;
  for (let tick = 0; tick < ticks; tick += 1) {
    if (next.squads.length === 0) break;
    const before = next.squads.length;
    next = step(next, []).state;
    const idle = next.squads.some((squad) => (squad.gridIndex ?? 0) >= (squad.gridPath?.length ?? 0));
    if (idle && before === next.squads.length) break;
  }
  return next;
}

describe("grid cell reachability", () => {
  it("marks the open plain as reachable and respects building blocks", () => {
    const state = createGame(gridMap(), 7, TIMED_RULES);
    const reach = reachableGridCells(state, "a");
    expect(reach).not.toBeNull();
    if (!reach) return;
    const total = reach.cells.reduce((sum, value) => sum + value, 0);
    expect(total).toBeGreaterThan(WIDTH * HEIGHT * 0.9);
    // 敌方建筑的格子被阻挡，不算可达地面。
    const enemyCell = reach.nav.cellFromWorld(150 * 10 + 2000, 0 + 1000);
    expect(reach.cells[enemyCell]).toBe(0);
  });

  it("derives city targets from the reachable bitmap", () => {
    const state = createGame(gridMap(), 7, TIMED_RULES);
    const reach = reachableGridCells(state, "a");
    expect(reach).not.toBeNull();
    if (!reach) return;
    expect(reachableGridCities(state, "a", reach).sort()).toEqual(
      sendReachableTargets(state, "a").sort(),
    );
  });

  it("does not flood through a wall", () => {
    const blocked: Array<[number, number]> = [];
    for (let z = 0; z < HEIGHT; z += 1) blocked.push([20, z]);
    const state = createGame(gridMap(blocked), 7, TIMED_RULES);
    const reach = reachableGridCells(state, "a");
    expect(reach).not.toBeNull();
    if (!reach) return;
    const beyond = reach.nav.cellFromWorld(500 + 2000, 1000);
    expect(reach.cells[beyond]).toBe(0);
  });
});

describe("send to a grid cell", () => {
  it("moves a squad to a cell and keeps it there", () => {
    let state = createGame(gridMap(), 7, TIMED_RULES);
    const target = cellCenter(0, 0);
    state = step(state, [{ type: "sendCell", from: "a", xCm: target[0], zCm: target[1] }]).state;
    expect(state.squads).toHaveLength(1);
    const squad = state.squads[0];
    expect(squad.to).toBe("");
    expect(squad.toCell).toEqual(target);

    state = runUntilSettled(state);
    expect(state.squads).toHaveLength(1);
    const idle = state.squads[0];
    expect(idle.gridIndex).toBe(idle.gridPath?.length);
    const supply = idle.supplyLeft;
    state = step(state, []).state;
    state = step(state, []).state;
    expect(state.squads[0].supplyLeft).toBe(supply);
  });

  it("rejects a destination behind a wall", () => {
    const blocked: Array<[number, number]> = [];
    for (let z = 0; z < HEIGHT; z += 1) blocked.push([20, z]);
    const state = createGame(gridMap(blocked), 7, TIMED_RULES);
    const result = step(state, [{ type: "sendCell", from: "a", xCm: 500, zCm: 0 }]);
    expect(result.rejected[0]?.reason).toBe("no_route");
    expect(result.state.squads).toHaveLength(0);
  });

  it("retargets an idle squad to another cell", () => {
    let state = createGame(gridMap(), 7, TIMED_RULES);
    state = step(state, [{ type: "sendCell", from: "a", xCm: 0, zCm: 0 }]).state;
    state = runUntilSettled(state);
    const squad = state.squads[0];
    expect(squad).toBeDefined();
    state = step(state, [{ type: "retargetCell", squad: squad.id, xCm: -500, zCm: 0 }]).state;
    expect(state.squads[0]?.toCell).toEqual([-500, 0]);
    state = runUntilSettled(state);
    expect(state.squads[0]?.toCell).toEqual([-500, 0]);
  });

  it("keeps replays deterministic with cell destinations", () => {
    const play = () => {
      let state = createGame(gridMap(), 3, TIMED_RULES);
      state = step(state, [{ type: "sendCell", from: "a", xCm: 0, zCm: 0 }]).state;
      for (let tick = 0; tick < 120; tick += 1) state = step(state, []).state;
      return state;
    };
    expect(hash(play())).toBe(hash(play()));
  });
});
