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

describe("兵团行军姿态", () => {
  it("强行军不停止，警戒方停下并造成伤害", () => {
    const start = createGame(TWO_CITY_MAP, 1, TIMED_RULES);
    let state = step(start, [
      { type: "send", from: "a", to: "b", stance: "forced" },
      { type: "send", from: "b", to: "a", stance: "guard" },
    ]).state;
    const forced = state.squads.find((squad) => squad.stance === "forced");
    const guard = state.squads.find((squad) => squad.stance === "guard");
    if (!forced || !guard) throw new Error("missing squads");
    forced.unitKind = "barbarian";
    guard.unitKind = "barbarian";
    const forcedInitial = forced.count;
    const guardInitial = guard.count;

    let clashState = state;
    for (let i = 0; i < 200; i += 1) {
      clashState = step(clashState, []).state;
      if (clashState.events.some((event) => event.type === "squadClashed")) break;
    }
    const forcedBefore = clashState.squads.find((squad) => squad.id === forced.id);
    const guardBefore = clashState.squads.find((squad) => squad.id === guard.id);
    if (!forcedBefore || !guardBefore) throw new Error("clash did not start");

    for (let i = 0; i < 20; i += 1) clashState = step(clashState, []).state;
    const forcedAfter = clashState.squads.find((squad) => squad.id === forced.id);
    const guardAfter = clashState.squads.find((squad) => squad.id === guard.id);
    if (!forcedAfter || !guardAfter) throw new Error("squads disappeared too early");

    expect(forcedAfter.arrivalTick).toBe(forcedBefore.arrivalTick);
    expect(guardAfter.arrivalTick).toBeGreaterThan(guardBefore.arrivalTick);
    expect(guardAfter.count).toBe(guardInitial);
    expect(forcedAfter.count).toBeLessThan(forcedInitial);
  });

  it("两支强行军互相穿过，不进入交战", () => {
    let state = step(createGame(TWO_CITY_MAP, 1, TIMED_RULES), [
      { type: "send", from: "a", to: "b", stance: "forced" },
      { type: "send", from: "b", to: "a", stance: "forced" },
    ]).state;
    let clashes = 0;
    for (let i = 0; i < 40; i += 1) {
      state = step(state, []).state;
      clashes += state.events.filter((event) => event.type === "squadClashed").length;
    }
    expect(clashes).toBe(0);
  });

  it("交战至少锁定 3 秒才能脱战", () => {
    let state = step(createGame(TWO_CITY_MAP, 1, TIMED_RULES), [
      { type: "send", from: "a", to: "b", stance: "forced" },
      { type: "send", from: "b", to: "a", stance: "guard" },
    ]).state;
    const guard = state.squads.find((squad) => squad.stance === "guard");
    const forced = state.squads.find((squad) => squad.stance === "forced");
    if (!guard || !forced) throw new Error("missing squads");
    // 直接摆到射程外，只验证脱战锁；把路径时间推远，避免自动走到终点。
    guard.xCm = -1000;
    guard.zCm = 0;
    forced.xCm = 1000;
    forced.zCm = 0;
    guard.engagedWith = forced.id;
    forced.engagedWith = guard.id;
    const until = state.tick + state.rules.tickHz * 3;
    guard.engagedUntilTick = until;
    for (const squad of [guard, forced]) {
      squad.legStartTick = state.tick;
      squad.legEndTick = state.tick + 100000;
      squad.arrivalTick = state.tick + 100000;
    }

    while (state.tick < until - 1) state = step(state, []).state;
    expect(state.squads.find((squad) => squad.id === guard.id)?.engagedWith).toBe(forced.id);
    state = step(state, []).state;
    expect(state.squads.find((squad) => squad.id === guard.id)?.engagedWith).toBe(forced.id);
    state = step(state, []).state;
    expect(state.squads.find((squad) => squad.id === guard.id)?.engagedWith).toBeUndefined();
    expect(state.squads.find((squad) => squad.id === forced.id)?.engagedWith).toBeUndefined();
  });

  it("可以中途切换兵团姿态", () => {
    let state = step(createGame(TWO_CITY_MAP, 1, TIMED_RULES), [
      { type: "send", from: "a", to: "b" },
    ]).state;
    const squad = state.squads[0];
    expect(squad.stance).toBe("guard");
    state = step(state, [{ type: "setSquadStance", squad: squad.id, stance: "forced" }]).state;
    expect(state.squads[0].stance).toBe("forced");
    state = step(state, [{ type: "setSquadStance", squad: squad.id, stance: "guard" }]).state;
    expect(state.squads[0].stance).toBe("guard");
  });
});
