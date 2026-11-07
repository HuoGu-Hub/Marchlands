import { describe, expect, it } from "vitest";
import { createGame, dispatchCount, sendReachableTargets, step } from "../src";
import { GRANARY_MAP, TIMED_RULES } from "./fixtures";

describe("驻军派兵", () => {
  it("粮仓收到外部兵力后可以派兵，且不超过剩余驻军", () => {
    let state = createGame(GRANARY_MAP, 1, TIMED_RULES);
    const granary = state.cities.find((city) => city.id === "g1");
    if (!granary) throw new Error("missing granary");
    granary.pop = 5;
    expect(sendReachableTargets(state, "g1")).toContain("b");

    const result = step(state, [{ type: "send", from: "g1", to: "b" }]);
    state = result.state;
    expect(result.rejected).toHaveLength(0);
    const squad = state.squads.find((entry) => entry.from === "g1");
    if (!squad) throw new Error("granary did not dispatch");
    expect(squad.count).toBe(2);
    expect(squad.count).toBeLessThanOrEqual(5);
    expect(state.cities.find((city) => city.id === "g1")?.pop).toBe(3);
  });

  it("驻兵点只剩 1 人时也能把驻军派出去", () => {
    let state = createGame(GRANARY_MAP, 1, TIMED_RULES);
    const outpost = state.cities.find((city) => city.id === "g1");
    if (!outpost) throw new Error("missing outpost");
    outpost.kind = "outpost";
    outpost.pop = 1;

    state = step(state, [{ type: "send", from: "g1", to: "a" }]).state;
    const squad = state.squads.find((entry) => entry.from === "g1");
    if (!squad) throw new Error("outpost did not dispatch");
    expect(squad.count).toBe(1);
    expect(state.cities.find((city) => city.id === "g1")?.pop).toBe(0);
  });

  it("产兵据点仍要求至少两人", () => {
    let state = createGame(GRANARY_MAP, 1, TIMED_RULES);
    const town = state.cities.find((city) => city.id === "a");
    if (!town) throw new Error("missing town");
    town.pop = 1;
    const result = step(state, [{ type: "send", from: "a", to: "b" }]);
    expect(result.rejected[0]?.reason).toBe("too_few_troops");
    expect(result.state.squads).toHaveLength(0);
  });

  it("派出人数始终不超过当前驻军", () => {
    const state = createGame(GRANARY_MAP, 1, TIMED_RULES);
    const city = state.cities.find((entry) => entry.id === "g1");
    if (!city) throw new Error("missing city");
    for (const pop of [1, 2, 3, 5, 9, 50]) {
      city.pop = pop;
      expect(dispatchCount(city, state.rules)).toBeLessThanOrEqual(pop);
      expect(dispatchCount(city, state.rules)).toBeGreaterThanOrEqual(1);
    }
  });
});
