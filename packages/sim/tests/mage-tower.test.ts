import { describe, expect, it } from "vitest";
import { createAi } from "../src/ai";
import { applyUpgrade } from "../src/economy";
import { createGame, step } from "../src/game";
import { DEFAULT_RULESET } from "../src/rules";
import type { SimEvent, SimState } from "../src/types";
import { MAGE_TOWER_MAP, rulesWith } from "./fixtures";

function site(state: SimState, id: string) {
  const found = state.cities.find((city) => city.id === id);
  if (!found) throw new Error(`missing site ${id}`);
  return found;
}

function player(state: SimState, id: 1 | 2) {
  const found = state.players.find((entry) => entry.id === id);
  if (!found) throw new Error(`missing player ${id}`);
  return found;
}

function advance(state: SimState, ticks: number): SimState {
  let current = state;
  for (let index = 0; index < ticks; index += 1) current = step(current, []).state;
  return current;
}

describe("mage tower", () => {
  it("normalizes the building to level 1 and refuses upgrades", () => {
    const map = {
      ...MAGE_TOWER_MAP,
      cities: MAGE_TOWER_MAP.cities.map((city) =>
        city.id === "m1" ? { ...city, owner: 1 as const, level: 3 as const, pop: 20 } : city,
      ),
    };
    const state = createGame(map, 1);
    const mage = site(state, "m1");
    expect(mage.level).toBe(1);
    expect(mage.maxPop).toBe(30);

    const rejected = step(state, [{ type: "upgrade", city: "m1" }]).rejected;
    expect(rejected[0]?.reason).toBe("not_upgradable");
    expect(applyUpgrade(mage, DEFAULT_RULESET)).toBe(false);
  });

  it("fires at an enemy squad on its own interval and records the losses", () => {
    const rules = rulesWith({
      speedDmPerSecond: 10,
      mageTower: { rangeCm: 800, intervalTicks: 20, damage: 2 },
    });
    let state = createGame(MAGE_TOWER_MAP, 1, rules);
    state = step(state, [{ type: "send", from: "a", to: "b" }]).state;
    const shots: Array<{ tick: number; event: Extract<SimEvent, { type: "mageTowerFired" }> }> = [];

    for (let index = 0; index < 400 && state.squads.length > 0; index += 1) {
      state = step(state, []).state;
      for (const event of state.events) {
        if (event.type === "mageTowerFired") shots.push({ tick: state.tick, event });
      }
    }

    expect(shots.length).toBeGreaterThanOrEqual(3);
    expect(shots[0].event.cityId).toBe("m1");
    expect(shots[0].event.owner).toBe(2);
    expect(shots[0].event.squadOwner).toBe(1);
    expect(shots[0].event.loss).toBe(2);
    expect(shots[1].tick - shots[0].tick).toBe(20);
    expect(shots[2].tick - shots[1].tick).toBe(20);
    expect(shots[0].event.squadCount).toBeLessThan(10);
    expect(player(state, 1).losses).toBe(10);
    expect(state.squads).toHaveLength(0);
  });

  it("stays silent while neutral", () => {
    const rules = rulesWith({
      speedDmPerSecond: 10,
      mageTower: { rangeCm: 800, intervalTicks: 20, damage: 2 },
    });
    let state = createGame(MAGE_TOWER_MAP, 1, rules);
    site(state, "m1").owner = 0;
    state = step(state, [{ type: "send", from: "a", to: "b" }]).state;
    state = advance(state, 200);
    expect(state.events.some((event) => event.type === "mageTowerFired")).toBe(false);
    expect(state.squads[0]?.count).toBe(10);
  });

  it("is never picked for an AI upgrade", () => {
    const state = createGame(MAGE_TOWER_MAP, 1, rulesWith({ maxTicks: 100 }));
    state.tick = 40;
    site(state, "m1").pop = 30;
    const commands = createAi(2, { decideTicks: 1 }).decide(state);
    expect(commands.some((command) => command.type === "upgrade" && command.city === "m1")).toBe(false);
  });
});
