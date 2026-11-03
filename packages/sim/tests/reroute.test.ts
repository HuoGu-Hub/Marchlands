import { describe, expect, it } from "vitest";
import { createGame, step } from "../src/game";
import { hash } from "../src/hash";
import { nextAnchor, routeOptions } from "../src/routes";
import { DEFAULT_RULESET } from "../src/rules";
import type { Command, SimState } from "../src/types";
import { JUNCTION_MAP, rulesWith, TIMED_RULES } from "./fixtures";

function site(state: SimState, id: string) {
  const found = state.cities.find((city) => city.id === id);
  if (!found) throw new Error(`missing site ${id}`);
  return found;
}

function squad(state: SimState) {
  const found = state.squads[0];
  if (!found) throw new Error("missing squad");
  return found;
}

function runUntil(state: SimState, tick: number, commands: Command[] = []): SimState {
  let current = state;
  while (current.tick < tick) {
    current = step(current, current.tick === 0 ? commands : []).state;
  }
  return current;
}

function sendToD(): SimState {
  const state = createGame(JUNCTION_MAP, 1, TIMED_RULES);
  site(state, "d").maxPop = 5;
  return step(state, [{ type: "send", from: "a", to: "d" }]).state;
}

describe("squad routing", () => {
  it("offers the current hop and every other simple branch to the destination", () => {
    const state = sendToD();
    const unit = squad(state);
    expect(nextAnchor(unit)).toBe("b");
    expect(unit.path).toEqual(["a", "b", "d"]);

    const options = routeOptions(state.graph, unit);
    expect(options.map((option) => [option.via, option.current])).toEqual([
      ["d", true],
      ["c", false],
    ]);
    expect(options[1].path).toEqual(["b", "c", "d"]);
  });

  it("changes the next hop at the upcoming junction", () => {
    let state = sendToD();
    const unit = squad(state);
    expect(unit.arrivalTick).toBe(150);

    state = runUntil(state, 10);
    state = step(state, [
      { type: "retarget", squad: unit.id, to: "d", via: "c" },
    ]).state;

    const retargeted = squad(state);
    expect(retargeted.path).toEqual(["a", "b", "c", "d"]);
    expect(retargeted.to).toBe("d");
    expect(retargeted.arrivalTick).toBe(217);
    expect(state.events.some((event) => event.type === "squadRetargeted")).toBe(true);

    state = runUntil(state, 150);
    expect(site(state, "d").owner).toBe(2);
    state = runUntil(state, 218);
    expect(site(state, "d").owner).toBe(1);
    expect(state.squads).toHaveLength(0);
  });

  it("changes the destination without leaving the current edge", () => {
    let state = sendToD();
    site(state, "c").maxPop = 5;
    const unit = squad(state);

    state = runUntil(state, 10);
    state = step(state, [{ type: "retarget", squad: unit.id, to: "c" }]).state;

    const retargeted = squad(state);
    expect(retargeted.path).toEqual(["a", "b", "c"]);
    expect(retargeted.to).toBe("c");
    expect(retargeted.arrivalTick).toBe(142);

    state = runUntil(state, 143);
    expect(site(state, "c").owner).toBe(1);
    expect(state.squads).toHaveLength(0);
  });

  it("rejects unknown squads, unknown destinations and bad next hops", () => {
    const state = sendToD();
    const unit = squad(state);
    const unknownSquad = step(state, [
      { type: "retarget", squad: "nope", to: "d" },
    ]);
    expect(unknownSquad.rejected[0]?.reason).toBe("unknown_squad");

    const unknownTarget = step(state, [
      { type: "retarget", squad: unit.id, to: "nope" },
    ]);
    expect(unknownTarget.rejected[0]?.reason).toBe("unknown_target");

    const badVia = step(state, [
      { type: "retarget", squad: unit.id, to: "d", via: "nope" },
    ]);
    expect(badVia.rejected[0]?.reason).toBe("invalid_via");
  });

  it("keeps a deterministic hash across reroutes", () => {
    const run = () => {
      let state = sendToD();
      const command: Command = { type: "retarget", squad: "s000001", to: "d", via: "c" };
      state = runUntil(state, 10);
      state = step(state, [command]).state;
      for (let tick = 0; tick < 250; tick += 1) state = step(state, []).state;
      return hash(state);
    };
    expect(run()).toBe(run());
  });
});

describe("squad supply", () => {
  it("keeps troops while supplies last, then loses one per interval", () => {
    const rules = rulesWith({
      supply: { carryTicks: 10, starveIntervalTicks: 5, starveLoss: 1 },
    });
    let state = createGame(JUNCTION_MAP, 1, rules);
    site(state, "d").maxPop = 5;
    state = step(state, [{ type: "send", from: "a", to: "d" }]).state;
    expect(squad(state).supplyLeft).toBe(10);
    expect(squad(state).nextStarveTick).toBe(10);

    state = runUntil(state, 10);
    expect(squad(state).count).toBe(10);
    expect(squad(state).supplyLeft).toBe(1);

    state = step(state, []).state;
    expect(squad(state).count).toBe(9);
    expect(squad(state).supplyLeft).toBe(0);
    expect(squad(state).nextStarveTick).toBe(15);
    expect(state.events.some((event) => event.type === "squadStarved")).toBe(true);
  });

  it("destroys a squad when starvation reaches zero", () => {
    const rules = rulesWith({
      supply: { carryTicks: 10, starveIntervalTicks: 5, starveLoss: 1 },
    });
    let state = createGame(JUNCTION_MAP, 1, rules);
    site(state, "d").maxPop = 5;
    state = step(state, [{ type: "send", from: "a", to: "d" }]).state;
    state = runUntil(state, 56);
    expect(state.squads).toHaveLength(0);
    expect(site(state, "d").owner).toBe(2);
    const starved = state.events.find((event) => event.type === "squadStarved");
    expect(starved && starved.type === "squadStarved" ? starved.destroyed : false).toBe(true);
  });

  it("does not reset supplies when rerouting", () => {
    let state = sendToD();
    const unit = squad(state);
    state = runUntil(state, 10);
    const before = squad(state).supplyLeft;
    const control = step(state, []).state;
    state = step(state, [
      { type: "retarget", squad: unit.id, to: "d", via: "c" },
    ]).state;
    expect(squad(state).supplyLeft).toBe(squad(control).supplyLeft);
    expect(squad(state).supplyLeft).toBeLessThan(before);
  });

  it("uses the default supply rules from content", () => {
    expect(DEFAULT_RULESET.supply.carryTicks).toBe(600);
    expect(DEFAULT_RULESET.supply.starveIntervalTicks).toBe(200);
    expect(DEFAULT_RULESET.supply.starveLoss).toBe(1);
  });
});
