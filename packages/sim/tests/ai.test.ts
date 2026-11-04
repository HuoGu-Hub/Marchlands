import { describe, expect, it } from "vitest";
import { createAi } from "../src/ai";
import { createGame, step } from "../src/game";
import { AI_MAP, AI_OUTPOST_MAP, OUTPOST_MAP, TIMED_RULES } from "./fixtures";

describe("ai", () => {
  it("finishes a match within the tick limit", () => {
    let state = createGame(AI_MAP, 11, TIMED_RULES);
    const one = createAi(1);
    const two = createAi(2);
    let guard = 0;
    while (state.status === "playing" && guard < state.rules.maxTicks) {
      const commands = state.tick % 40 === 0 ? [...one.decide(state), ...two.decide(state)] : [];
      state = step(state, commands).state;
      guard += 1;
    }
    expect(state.status).toBe("finished");
    expect(state.tick).toBeLessThanOrEqual(state.rules.maxTicks);
  });

  it("issues only valid, owned commands", () => {
    let state = createGame(AI_MAP, 5, TIMED_RULES);
    const one = createAi(1);
    for (let tick = 0; tick < 2000; tick += 1) {
      const commands = tick % 40 === 0 ? one.decide(state) : [];
      for (const command of commands) {
        if (command.type === "send") {
          const from = state.cities.find((city) => city.id === command.from);
          expect(from?.owner).toBe(1);
        } else if (command.type === "retarget") {
          const squad = state.squads.find((entry) => entry.id === command.squad);
          expect(squad?.owner).toBe(1);
        } else if (command.type === "upgrade" || command.type === "setStance" || command.type === "setTransit") {
          const city = state.cities.find((entry) => entry.id === command.city);
          expect(city?.owner).toBe(1);
        }
      }
      state = step(state, commands).state;
      if (state.status !== "playing") break;
    }
  });

  it("does nothing between decision ticks", () => {
    const state = createGame(AI_MAP, 2, TIMED_RULES);
    const ai = createAi(1);
    const offset = { ...state, tick: 3 };
    expect(ai.decide(offset)).toEqual([]);
  });

  it("uses the configured decision cadence", () => {
    const state = createGame(AI_MAP, 7, TIMED_RULES);
    const slow = createAi(2, { decideTicks: 80 });
    expect(slow.decide({ ...state, tick: 40 })).toEqual([]);
  });

  it("uses the configured send threshold", () => {
    const state = createGame(AI_MAP, 7, TIMED_RULES);
    const eager = createAi(2, { sendThresholdPercent: 40 });
    const relaxed = createAi(2, { sendThresholdPercent: 90 });
    const at = { ...state, tick: 40 };
    expect(eager.decide(at).some((command) => command.type === "send")).toBe(true);
    expect(relaxed.decide(at).some((command) => command.type === "send")).toBe(false);
  });

  it("switches an owned outpost to engage", () => {
    const state = createGame(AI_OUTPOST_MAP, 1, TIMED_RULES);
    expect(createAi(2).decide(state)).toContainEqual({
      type: "setStance",
      city: "o1",
      stance: "engage",
    });
  });

  it("finishes a match that contains buildings", () => {
    let state = createGame(OUTPOST_MAP, 11, TIMED_RULES);
    const one = createAi(1);
    const two = createAi(2);
    let guard = 0;
    while (state.status === "playing" && guard < state.rules.maxTicks) {
      const commands = state.tick % 40 === 0 ? [...one.decide(state), ...two.decide(state)] : [];
      state = step(state, commands).state;
      guard += 1;
    }
    expect(state.status).toBe("finished");
    expect(state.tick).toBeLessThanOrEqual(state.rules.maxTicks);
  });
});
