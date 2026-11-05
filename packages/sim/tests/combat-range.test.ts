import { describe, expect, it } from "vitest";
import { createGame, step } from "../src/game";
import { UNIT_PROFILES } from "../src/units";
import type { SimState } from "../src/types";
import { TIMED_RULES, TWO_CITY_MAP } from "./fixtures";

function runUntilClash(state: SimState, limit = 400): { state: SimState; clash: any } {
  let current = state;
  for (let i = 0; i < limit; i += 1) {
    current = step(current, []).state;
    const clash = current.events.find((event) => event.type === "squadClashed");
    if (clash) return { state: current, clash };
  }
  throw new Error("没有发生交战");
}

describe("交战距离", () => {
  it("远程兵种能在近战够不着的位置先手", () => {
    const start = createGame(TWO_CITY_MAP, 1, TIMED_RULES);
    const sent = step(start, [
      { type: "send", from: "a", to: "b" },
      { type: "send", from: "b", to: "a" },
    ]).state;
    expect(sent.squads.length).toBe(2);
    sent.squads[0].unitKind = "archer";
    sent.squads[1].unitKind = "warrior";

    const { clash } = runUntilClash(sent, 120);
    // 弓箭手是发起方：它先打到人，近战这一 tick 完全够不着。
    expect(clash.attackerLoss).toBe(0);
    expect(clash.defenderLoss).toBeGreaterThan(0);
  });

  it("两个近战只有贴近了才开打", () => {
    const start = createGame(TWO_CITY_MAP, 1, TIMED_RULES);
    const sent = step(start, [
      { type: "send", from: "a", to: "b" },
      { type: "send", from: "b", to: "a" },
    ]).state;
    sent.squads[0].unitKind = "barbarian";
    sent.squads[1].unitKind = "barbarian";

    const { state, clash } = runUntilClash(sent, 200);
    expect(clash.attackerLoss).toBeGreaterThan(0);
    expect(clash.defenderLoss).toBeGreaterThan(0);
    const a = state.squads.find((squad) => squad.id === clash.attacker);
    const b = state.squads.find((squad) => squad.id === clash.defender);
    expect(a && b).toBeTruthy();
    if (a && b) expect(a.engagedWith).toBe(b.id);
  });

  it("交战中原地停下，时间轴往后推", () => {
    const start = createGame(TWO_CITY_MAP, 1, TIMED_RULES);
    const sent = step(start, [
      { type: "send", from: "a", to: "b" },
      { type: "send", from: "b", to: "a" },
    ]).state;
    sent.squads[0].unitKind = "archer";
    sent.squads[1].unitKind = "warrior";

    const { state } = runUntilClash(sent, 120);
    const before = state.squads.map((squad) => squad.arrivalTick);
    const later = step(step(state, []).state, []).state;
    const after = later.squads.map((squad) => squad.arrivalTick);
    expect(after).toEqual(before.map((tick) => tick + 2));
  });

  it("兵种表里的交战距离按远近排序", () => {
    expect(UNIT_PROFILES.mage.attackRangeCm).toBeGreaterThan(UNIT_PROFILES.archer.attackRangeCm);
    expect(UNIT_PROFILES.archer.attackRangeCm).toBeGreaterThan(UNIT_PROFILES.ranger.attackRangeCm);
    expect(UNIT_PROFILES.warrior.attackRangeCm).toBeGreaterThan(UNIT_PROFILES.barbarian.attackRangeCm);
  });
});
