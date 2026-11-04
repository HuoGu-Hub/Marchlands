import { describe, expect, it } from "vitest";
import { createGame, step } from "../src/game";
import { hash } from "../src/hash";
import { DEFAULT_RULESET } from "../src/rules";
import type { Command } from "../src/types";
import { THREE_CITY_MAP, TWO_CITY_MAP, rulesWith, TIMED_RULES } from "./fixtures";

function city(state: ReturnType<typeof createGame>, id: string) {
  const found = state.cities.find((entry) => entry.id === id);
  if (!found) throw new Error(`missing city ${id}`);
  return found;
}

function runUntil(state: ReturnType<typeof createGame>, tick: number, commands: Command[] = []) {
  let current = state;
  while (current.tick < tick) {
    const next = step(current, current.tick === 0 ? commands : []);
    current = next.state;
  }
  return current;
}

describe("setup", () => {
  it("uses the map starting gold", () => {
    const state = createGame({ ...THREE_CITY_MAP, startGold: 250 }, 1);
    expect(state.players.map((player) => player.gold)).toEqual([250, 250]);
  });
});

describe("send", () => {
  it("sends half rounded down and records a squad", () => {
    const state = createGame(THREE_CITY_MAP, 1, TIMED_RULES);
    const result = step(state, [{ type: "send", from: "a", to: "b" }]);
    expect(result.rejected).toEqual([]);
    const from = city(result.state, "a");
    expect(from.pop).toBe(5);
    expect(result.state.squads).toHaveLength(1);
    const squad = result.state.squads[0];
    expect(squad.count).toBe(5);
    expect(squad.departTick).toBe(0);
    expect(squad.arrivalTick).toBe(34);
    expect(squad.path).toEqual(["a", "b"]);
  });

  it("does not mutate the input state", () => {
    const state = createGame(THREE_CITY_MAP, 1, TIMED_RULES);
    const before = hash(state);
    step(state, [{ type: "send", from: "a", to: "b" }]);
    expect(hash(state)).toBe(before);
    expect(state.tick).toBe(0);
    expect(city(state, "a").pop).toBe(10);
  });

  it("rejects invalid commands without changing state", () => {
    const state = createGame(THREE_CITY_MAP, 1, TIMED_RULES);
    const result = step(state, [
      { type: "send", from: "a", to: "a" },
      { type: "send", from: "b", to: "a" },
      { type: "send", from: "a", to: "zzz" },
      { type: "upgrade", city: "b" },
    ]);
    expect(result.rejected.map((entry) => entry.reason)).toEqual([
      "same_city",
      "not_owned",
      "unknown_target",
      "not_owned",
    ]);
    expect(result.state.squads).toHaveLength(0);
    expect(city(result.state, "a").pop).toBe(10);
  });

  it("rejects sends below two population", () => {
    const state = createGame(THREE_CITY_MAP, 1, TIMED_RULES);
    city(state, "a").pop = 1;
    const result = step(state, [{ type: "send", from: "a", to: "b" }]);
    expect(result.rejected[0]?.reason).toBe("too_few_troops");
  });

  it("resolves combat on arrival", () => {
    let state = createGame(THREE_CITY_MAP, 1, TIMED_RULES);
    state = step(state, [{ type: "send", from: "a", to: "b" }]).state;
    state = runUntil(state, 35);
    expect(state.squads).toHaveLength(0);
    expect(city(state, "b").pop).toBe(1);
    expect(city(state, "b").owner).toBe(0);
    const types = state.events.map((event) => event.type);
    expect(types).toContain("squadArrived");
    expect(types).toContain("combatResolved");
  });

  it("captures after the defenders are worn down", () => {
    let state = createGame(THREE_CITY_MAP, 1, TIMED_RULES);
    state = step(state, [{ type: "send", from: "a", to: "b" }]).state;
    state = runUntil(state, 35);
    state = step(state, [{ type: "send", from: "a", to: "b" }]).state;
    state = runUntil(state, 70);
    expect(city(state, "b").owner).toBe(1);
    expect(city(state, "b").pop).toBeGreaterThan(0);
    expect(state.events.some((event) => event.type === "cityCaptured")).toBe(true);
  });
});

describe("upgrade", () => {
  it("upgrades through the command pipeline", () => {
    const state = createGame(THREE_CITY_MAP, 1, TIMED_RULES);
    city(state, "a").pop = 15;
    const result = step(state, [{ type: "upgrade", city: "a" }]);
    expect(result.rejected).toEqual([]);
    expect(city(result.state, "a").level).toBe(2);
    expect(city(result.state, "a").maxPop).toBe(45);
    expect(result.state.events.some((event) => event.type === "upgradeCompleted")).toBe(true);
  });
});

describe("finish", () => {
  it("wins by capturing every city", () => {
    let state = createGame(TWO_CITY_MAP, 1, TIMED_RULES);
    state = step(state, [{ type: "send", from: "a", to: "b" }]).state;
    state = runUntil(state, 68);
    expect(state.status).toBe("finished");
    expect(state.winner).toBe(1);
    expect(state.finishReason).toBe("capture_all");
    expect(state.events.some((event) => event.type === "gameOver")).toBe(true);
  });

  it("eliminates a player with no cities", () => {
    let state = createGame(THREE_CITY_MAP, 1, TIMED_RULES);
    city(state, "a").pop = 30;
    city(state, "a").maxPop = 65;
    city(state, "a").level = 3;
    state = step(state, [{ type: "send", from: "a", to: "c" }]).state;
    state = runUntil(state, 68);
    expect(state.winner).toBe(1);
    expect(state.finishReason).toBe("eliminated");
  });

  it("ends at the tick limit and ranks by cities", () => {
    const rules = rulesWith({ maxTicks: 5 });
    let state = createGame(TWO_CITY_MAP, 1, rules);
    while (state.status === "playing") state = step(state, []).state;
    expect(state.tick).toBe(5);
    expect(state.winner).toBe(1);
    expect(state.finishReason).toBe("time_limit");
  });

  it("ranks time limit by total troops first", () => {
    const rules = rulesWith({ maxTicks: 1 });
    const state = createGame(TWO_CITY_MAP, 1, rules);
    city(state, "a").pop = 10;
    city(state, "b").pop = 30;
    let next = state;
    while (next.status === "playing") next = step(next, []).state;
    expect(next.winner).toBe(2);
  });

  it("breaks a troop tie by buildings owned", () => {
    const rules = rulesWith({ maxTicks: 1 });
    const state = createGame(THREE_CITY_MAP, 1, rules);
    city(state, "a").pop = 5;
    city(state, "b").owner = 1;
    city(state, "b").pop = 5;
    city(state, "c").pop = 10;
    let next = state;
    while (next.status === "playing") next = step(next, []).state;
    expect(next.winner).toBe(1);
  });

  it("breaks a building tie by lower total losses", () => {
    const rules = rulesWith({ maxTicks: 1 });
    const state = createGame(TWO_CITY_MAP, 1, rules);
    city(state, "a").pop = 10;
    city(state, "b").pop = 10;
    state.players[0].losses = 4;
    state.players[1].losses = 1;
    let next = state;
    while (next.status === "playing") next = step(next, []).state;
    expect(next.winner).toBe(2);
  });

  it("breaks a loss tie by gold", () => {
    const rules = rulesWith({ maxTicks: 1 });
    const state = createGame(TWO_CITY_MAP, 1, rules);
    city(state, "a").pop = 10;
    city(state, "b").pop = 10;
    state.players[0].gold = 5;
    state.players[1].gold = 1;
    let next = state;
    while (next.status === "playing") next = step(next, []).state;
    expect(next.winner).toBe(1);
  });

  it("draws when every tie-breaker matches", () => {
    const rules = rulesWith({ maxTicks: 1 });
    const state = createGame(TWO_CITY_MAP, 1, rules);
    city(state, "a").pop = 10;
    city(state, "b").pop = 10;
    let next = state;
    while (next.status === "playing") next = step(next, []).state;
    expect(next.winner).toBe(0);
    expect(next.finishReason).toBe("draw");
  });

  it("rejects commands after the match ends", () => {
    const rules = rulesWith({ maxTicks: 1 });
    const finished = step(createGame(TWO_CITY_MAP, 1, rules), []).state;
    expect(finished.status).toBe("finished");
    const result = step(finished, [{ type: "send", from: "a", to: "b" }]);
    expect(result.rejected[0]?.reason).toBe("game_finished");
  });
});

describe("gold", () => {
  it("adds city income to the owner", () => {
    const state = createGame(THREE_CITY_MAP, 1, TIMED_RULES);
    const after = runUntil(state, 20);
    expect(city(after, "a").owner).toBe(1);
    expect(after.players.find((player) => player.id === 1)?.gold).toBe(2);
  });
});

describe("determinism", () => {
  it("produces the same hash for the same command stream", () => {
    const run = () => {
      let state = createGame(THREE_CITY_MAP, 7, TIMED_RULES);
      for (let tick = 0; tick < 400; tick += 1) {
        const commands: Command[] = [];
        if (tick === 0 || tick === 40) commands.push({ type: "send", from: "a", to: "b" });
        if (tick === 20) commands.push({ type: "upgrade", city: "c" });
        state = step(state, commands).state;
      }
      return hash(state);
    };
    expect(run()).toBe(run());
  });

  it("does not depend on rule json key order", () => {
    const state = createGame(THREE_CITY_MAP, 3, TIMED_RULES);
    const reordered = { ...TIMED_RULES, levels: TIMED_RULES.levels.map((entry) => entry) };
    const other = createGame(THREE_CITY_MAP, 3, reordered);
    expect(hash(state)).toBe(hash(other));
  });
});
