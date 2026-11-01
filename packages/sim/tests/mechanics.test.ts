import { describe, expect, it } from "vitest";
import { createAi } from "../src/ai";
import { createGame, step } from "../src/game";
import { hash } from "../src/hash";
import { DEFAULT_RULESET } from "../src/rules";
import type { Command, SimState } from "../src/types";
import {
  AI_OUTPOST_MAP,
  DECAY_MAP,
  GRANARY_DEFENSE_MAP,
  GRANARY_MAP,
  OUTPOST_MAP,
  VICTORY_MAP,
  rulesWith,
} from "./fixtures";

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

function runUntil(state: SimState, tick: number, commands: Command[] = []): SimState {
  let current = state;
  while (current.tick < tick) {
    current = step(current, current.tick === 0 ? commands : []).state;
  }
  return current;
}

function fastDecayRules() {
  return rulesWith({
    outpost: {
      ...DEFAULT_RULESET.outpost,
      graceTicks: 0,
      decayIntervalTicks: 1,
      decayPerInterval: 2,
    },
  });
}

describe("granary", () => {
  it("speeds up marches and strengthens troops while owned", () => {
    const start = createGame(GRANARY_MAP, 1);
    site(start, "b").maxPop = 5;
    const sent = step(start, [{ type: "send", from: "a", to: "b" }]).state;
    const squad = sent.squads[0];
    expect(squad.speedMilli).toBe(1200);
    expect(squad.strengthMilli).toBe(1200);
    expect(squad.arrivalTick).toBe(56);

    const arrived = runUntil(sent, 57);
    expect(site(arrived, "b").owner).toBe(1);
    const combat = arrived.events.find((event) => event.type === "combatResolved");
    expect(combat && combat.type === "combatResolved" ? combat.attackerLoss : -1).toBe(4);
  });

  it("uses base speed and strength without a granary", () => {
    const start = createGame(GRANARY_MAP, 1);
    site(start, "g1").owner = 0;
    site(start, "b").maxPop = 5;
    const sent = step(start, [{ type: "send", from: "a", to: "b" }]).state;
    expect(sent.squads[0].speedMilli).toBe(1000);
    expect(sent.squads[0].strengthMilli).toBe(1000);
    expect(sent.squads[0].arrivalTick).toBe(67);

    const arrived = runUntil(sent, 68);
    expect(site(arrived, "b").owner).toBe(1);
    const combat = arrived.events.find((event) => event.type === "combatResolved");
    expect(combat && combat.type === "combatResolved" ? combat.attackerLoss : -1).toBe(5);
  });

  it("holds troops, produces no growth or gold, and cannot be upgraded", () => {
    let state = createGame(GRANARY_MAP, 1);
    state = runUntil(state, 20);
    expect(site(state, "g1").pop).toBe(0);
    expect(player(state, 1).gold).toBe(2);

    const rejected = step(state, [{ type: "upgrade", city: "g1" }]);
    expect(rejected.rejected[0]?.reason).toBe("not_upgradable");

    state = step(state, [{ type: "send", from: "a", to: "g1" }]).state;
    state = runUntil(state, 50);
    expect(site(state, "g1").pop).toBeGreaterThan(0);
    expect(site(state, "g1").pop).toBeLessThanOrEqual(state.rules.granary.capacity);
  });

  it("stacks its strength bonus on defense", () => {
    const start = createGame(GRANARY_DEFENSE_MAP, 1);
    site(start, "b").maxPop = 10;
    const sent = step(start, [{ type: "send", from: "a", to: "b" }]).state;
    const arrived = runUntil(sent, 68);
    expect(site(arrived, "b").owner).toBe(2);
    expect(site(arrived, "b").pop).toBe(2);

    const noBuff = createGame(GRANARY_DEFENSE_MAP, 1);
    site(noBuff, "g1").owner = 0;
    site(noBuff, "b").maxPop = 10;
    const baseline = runUntil(step(noBuff, [{ type: "send", from: "a", to: "b" }]).state, 68);
    expect(site(baseline, "b").owner).toBe(2);
    expect(site(baseline, "b").pop).toBe(0);
  });

  it("keeps the same hash for the same command stream", () => {
    const run = () => {
      let state = createGame(GRANARY_MAP, 7);
      for (let tick = 0; tick < 200; tick += 1) {
        const commands: Command[] = tick === 0 ? [{ type: "send", from: "a", to: "b" }] : [];
        state = step(state, commands).state;
      }
      return hash(state);
    };
    expect(run()).toBe(run());
  });
});

describe("outpost", () => {
  it("does not decay during the grace window, then loses troops periodically", () => {
    const rules = rulesWith({
      outpost: { ...DEFAULT_RULESET.outpost, graceTicks: 20, decayIntervalTicks: 10, decayPerInterval: 1 },
    });
    let state = createGame(DECAY_MAP, 1, rules);
    expect(site(state, "o1").decayAtTick).toBe(20);

    state = runUntil(state, 20);
    expect(site(state, "o1").pop).toBe(5);

    state = step(state, []).state;
    expect(site(state, "o1").pop).toBe(4);
    expect(site(state, "o1").decayAtTick).toBe(30);
    expect(state.events.some((event) => event.type === "outpostDecayed")).toBe(true);

    state = runUntil(state, 30);
    expect(site(state, "o1").pop).toBe(4);
    state = step(state, []).state;
    expect(site(state, "o1").pop).toBe(3);
  });

  it("empties and neutralizes an outpost when decay reaches zero", () => {
    let state = createGame(DECAY_MAP, 1, fastDecayRules());
    expect(site(state, "o1").decayAtTick).toBe(0);
    expect(site(state, "o1").pop).toBe(5);

    state = step(state, []).state;
    expect(site(state, "o1").pop).toBe(3);
    state = step(state, []).state;
    expect(site(state, "o1").pop).toBe(1);
    state = step(state, []).state;
    expect(site(state, "o1").pop).toBe(0);
    expect(site(state, "o1").owner).toBe(0);
    expect(site(state, "o1").stance).toBe("evade");
  });

  it("resets the grace timer when friendly troops arrive", () => {
    const rules = rulesWith({
      outpost: { ...DEFAULT_RULESET.outpost, graceTicks: 20, decayIntervalTicks: 10, decayPerInterval: 1 },
    });
    let state = createGame(DECAY_MAP, 1, rules);
    state = step(state, [{ type: "send", from: "a", to: "o1" }]).state;
    expect(state.squads[0].arrivalTick).toBe(60);

    state = runUntil(state, 60);
    expect(site(state, "o1").pop).toBe(1);
    state = step(state, []).state;
    expect(site(state, "o1").pop).toBe(11);
    expect(site(state, "o1").decayAtTick).toBe(80);
  });

  it("changes stance only on owned outposts", () => {
    const state = createGame(OUTPOST_MAP, 1);
    const changed = step(state, [{ type: "setStance", city: "o1", stance: "evade" }]);
    expect(changed.rejected).toEqual([]);
    expect(site(changed.state, "o1").stance).toBe("evade");
    expect(changed.state.events.some((event) => event.type === "stanceChanged")).toBe(true);

    const town = step(state, [{ type: "setStance", city: "b", stance: "engage" }]);
    expect(town.rejected[0]?.reason).toBe("not_outpost");

    const neutral = createGame(OUTPOST_MAP, 1);
    site(neutral, "o1").owner = 0;
    const unowned = step(neutral, [{ type: "setStance", city: "o1", stance: "engage" }]);
    expect(unowned.rejected[0]?.reason).toBe("not_owned");

    const invalid = step(state, [
      { type: "setStance", city: "o1", stance: "charge" as never },
    ]);
    expect(invalid.rejected[0]?.reason).toBe("invalid_stance");
  });

  it("intercepts passing squads when engaging", () => {
    let state = createGame(OUTPOST_MAP, 1);
    site(state, "c").maxPop = 5;
    state = step(state, [{ type: "send", from: "a", to: "c" }]).state;
    expect(state.squads[0].count).toBe(10);
    expect(state.squads[0].arrivalTick).toBe(100);

    state = runUntil(state, 25);
    expect(site(state, "o1").pop).toBe(10);
    expect(state.squads[0].count).toBe(10);

    state = step(state, []).state;
    expect(site(state, "o1").owner).toBe(0);
    expect(site(state, "o1").pop).toBe(0);
    expect(state.squads[0].count).toBe(2);
    expect(state.events.some((event) => event.type === "squadIntercepted")).toBe(true);

    state = runUntil(state, 100);
    state = step(state, []).state;
    expect(site(state, "c").pop).toBe(3);
    expect(site(state, "c").owner).toBe(0);
    expect(state.squads).toHaveLength(0);
  });

  it("lets squads pass when the outpost avoids battle", () => {
    let state = createGame(OUTPOST_MAP, 1);
    site(state, "o1").stance = "evade";
    state = step(state, [{ type: "send", from: "a", to: "c" }]).state;
    state = runUntil(state, 26);
    expect(site(state, "o1").pop).toBe(10);
    expect(state.squads[0].count).toBe(10);
  });

  it("destroys a passing squad when the outpost is stronger", () => {
    let state = createGame(OUTPOST_MAP, 1);
    site(state, "o1").pop = 20;
    state = step(state, [{ type: "send", from: "a", to: "c" }]).state;
    state = runUntil(state, 25);
    state = step(state, []).state;
    expect(state.squads).toHaveLength(0);
    expect(site(state, "o1").owner).toBe(2);
    expect(site(state, "o1").pop).toBe(6);
    const event = state.events.find((entry) => entry.type === "squadIntercepted");
    expect(event && event.type === "squadIntercepted" ? event.squadDestroyed : false).toBe(true);
  });

  it("always fights a direct invasion, even when avoiding battle", () => {
    let state = createGame(OUTPOST_MAP, 1);
    site(state, "o1").stance = "evade";
    state = step(state, [{ type: "send", from: "a", to: "o1" }]).state;
    expect(state.squads[0].arrivalTick).toBe(84);

    state = runUntil(state, 84);
    expect(site(state, "o1").pop).toBe(10);
    state = step(state, []).state;
    expect(site(state, "o1").owner).toBe(1);
    expect(site(state, "o1").pop).toBe(2);
    expect(site(state, "o1").stance).toBe("evade");
    expect(site(state, "o1").decayAtTick).toBe(684);
  });

  it("does not count as a town for victory", () => {
    let state = createGame(VICTORY_MAP, 1);
    state = step(state, [{ type: "send", from: "a", to: "b" }]).state;
    state = runUntil(state, 68);
    expect(state.status).toBe("finished");
    expect(state.winner).toBe(1);
    expect(state.finishReason).toBe("eliminated");
    expect(state.cities.filter((city) => city.owner === 2).map((city) => city.id).sort()).toEqual(["g1", "o1"]);
  });

  it("does not block capture when only buildings remain neutral", () => {
    let state = createGame(GRANARY_MAP, 1);
    site(state, "g1").owner = 0;
    state = step(state, [{ type: "send", from: "a", to: "b" }]).state;
    state = runUntil(state, 68);
    expect(state.status).toBe("finished");
    expect(state.winner).toBe(1);
    expect(state.finishReason).toBe("capture_all");
  });

  it("keeps a deterministic hash with outposts and timers", () => {
    const run = () => {
      let state = createGame(OUTPOST_MAP, 9);
      for (let tick = 0; tick < 300; tick += 1) {
        const commands: Command[] = tick === 0 ? [{ type: "send", from: "a", to: "c" }] : [];
        state = step(state, commands).state;
      }
      return hash(state);
    };
    expect(run()).toBe(run());
  });
});

describe("ai", () => {
  it("switches an owned outpost to engage", () => {
    const state = createGame(AI_OUTPOST_MAP, 1);
    const commands = createAi(2).decide(state);
    expect(commands).toContainEqual({ type: "setStance", city: "o1", stance: "engage" });
  });
});
