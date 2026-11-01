import { describe, expect, it } from "vitest";
import { createAi } from "../src/ai";
import { createGame, step } from "../src/game";
import { AI_MAP, AI_OUTPOST_MAP, OUTPOST_MAP } from "./fixtures";

describe("ai", () => {
  it("finishes a match within the tick limit", () => {
    let state = createGame(AI_MAP, 11);
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
    let state = createGame(AI_MAP, 5);
    const one = createAi(1);
    for (let tick = 0; tick < 2000; tick += 1) {
      const commands = tick % 40 === 0 ? one.decide(state) : [];
      for (const command of commands) {
        if (command.type === "send") {
          const from = state.cities.find((city) => city.id === command.from);
          expect(from?.owner).toBe(1);
        } else {
          const city = state.cities.find((entry) => entry.id === command.city);
          expect(city?.owner).toBe(1);
        }
      }
      state = step(state, commands).state;
      if (state.status !== "playing") break;
    }
  });

  it("does nothing between decision ticks", () => {
    const state = createGame(AI_MAP, 2);
    const ai = createAi(1);
    const offset = { ...state, tick: 3 };
    expect(ai.decide(offset)).toEqual([]);
  });

  it("switches an owned outpost to engage", () => {
    const state = createGame(AI_OUTPOST_MAP, 1);
    expect(createAi(2).decide(state)).toContainEqual({
      type: "setStance",
      city: "o1",
      stance: "engage",
    });
  });

  it("finishes a match that contains buildings", () => {
    let state = createGame(OUTPOST_MAP, 11);
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
