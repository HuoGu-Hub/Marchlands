import { describe, expect, it } from "vitest";
import { defenseValue, resolveAttack } from "../src/combat";
import { initialGarrison } from "../src/garrison";
import { DEFAULT_RULESET } from "../src/rules";
import type { CityState } from "../src/types";

function city(level: CityState["level"], pop: number): CityState {
  return {
    id: "x",
    kind: "barbarian",
    owner: 2,
    level,
    pop,
    garrison: initialGarrison("barbarian", pop),
    maxPop: 65,
    growthCarry: 123,
    growthLockUntil: 0,
    overCapCarry: 0,
    pos: [0, 0],
    layer: 0,
    stance: "evade",
    decayAtTick: 0,
    watch: null,
  };
}

describe("combat", () => {
  it("captures when troops exceed defense", () => {
    const target = city(1, 10);
    const outcome = resolveAttack(target, 1, 11, DEFAULT_RULESET);
    expect(outcome).toEqual({ captured: true, attackerLoss: 10, defenderLoss: 10 });
    expect(target.owner).toBe(1);
    expect(target.pop).toBe(1);
  });

  it("keeps the defender when troops equal defense", () => {
    const target = city(1, 10);
    const outcome = resolveAttack(target, 1, 10, DEFAULT_RULESET);
    expect(outcome.captured).toBe(false);
    expect(target.owner).toBe(2);
    expect(target.pop).toBe(0);
    expect(outcome.attackerLoss).toBe(10);
    expect(outcome.defenderLoss).toBe(10);
  });

  it("applies the level-3 defense multiplier", () => {
    const target = city(3, 10);
    expect(defenseValue(target, DEFAULT_RULESET)).toBe(12);
    const repelled = resolveAttack(target, 1, 12, DEFAULT_RULESET);
    expect(repelled.captured).toBe(false);
    expect(target.pop).toBe(0);
    const captured = resolveAttack(city(3, 10), 1, 13, DEFAULT_RULESET);
    expect(captured.captured).toBe(true);
  });

  it("never lets a tiny attack increase population", () => {
    const target = city(3, 10);
    resolveAttack(target, 1, 1, DEFAULT_RULESET);
    expect(target.pop).toBeLessThanOrEqual(10);
  });

  it("caps captured population at max", () => {
    const target = city(1, 10);
    target.maxPop = 5;
    resolveAttack(target, 1, 40, DEFAULT_RULESET);
    expect(target.pop).toBe(5);
  });
});
