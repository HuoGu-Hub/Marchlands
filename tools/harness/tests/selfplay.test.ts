import { describe, expect, it } from "vitest";
import { loadContent } from "@marchlands/content/node";
import { hash } from "@marchlands/sim";
import { replayMatch, runMatch } from "../src/match";

describe("self play", () => {
  const { map, rules } = loadContent();

  it("finishes every seeded match", () => {
    for (let seed = 1; seed <= 5; seed += 1) {
      const { state } = runMatch(map, rules, seed);
      expect(state.status, `seed ${seed}`).toBe("finished");
      expect(state.tick).toBeLessThanOrEqual(rules.maxTicks);
    }
  });

  it("replays to the same final hash", () => {
    const { replay } = runMatch(map, rules, 42);
    const replayed = replayMatch(map, rules, replay);
    expect(hash(replayed)).toBe(replay.result.finalHash);
  });

  it("is deterministic across runs", () => {
    const first = runMatch(map, rules, 9);
    const second = runMatch(map, rules, 9);
    expect(first.replay.result.finalHash).toBe(second.replay.result.finalHash);
    expect(first.state.tick).toBe(second.state.tick);
  });

  it("flips the winner when the seats are mirrored", () => {
    const mirrored = {
      ...map,
      cities: map.cities.map((city) => ({
        ...city,
        owner: city.owner === 1 ? (2 as const) : city.owner === 2 ? (1 as const) : (0 as const),
        pos: [-city.pos[0], city.pos[1]] as [number, number],
      })),
    };
    const base = runMatch(map, rules, 1).state;
    const flipped = runMatch(mirrored, rules, 1).state;
    expect(base.winner).toBe(1);
    expect(flipped.winner).toBe(2);
    expect(flipped.finishReason).toBe("eliminated");
  });
});
