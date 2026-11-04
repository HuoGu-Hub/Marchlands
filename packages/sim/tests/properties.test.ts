import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { createGame, step } from "../src/game";
import type { Command } from "../src/types";
import { THREE_CITY_MAP } from "./fixtures";

describe("properties", () => {
  it("keeps population and gold invariants", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100000 }),
        fc.array(fc.integer({ min: 0, max: 400 }), { maxLength: 30 }),
        (seed, sendTicks) => {
          let state = createGame(THREE_CITY_MAP, seed);
          const schedule = new Map<number, Command[]>();
          sendTicks.forEach((tick, index) => {
            const list = schedule.get(tick) ?? [];
            list.push({ type: "send", from: index % 2 === 0 ? "a" : "c", to: "b" });
            schedule.set(tick, list);
          });

          for (let tick = 0; tick < 600 && state.status === "playing"; tick += 1) {
            state = step(state, schedule.get(tick) ?? []).state;
            for (const city of state.cities) {
              expect(city.pop).toBeGreaterThanOrEqual(0);
              expect(city.pop).toBeLessThanOrEqual(city.maxPop + 120);
              expect(city.owner).toBeGreaterThanOrEqual(0);
              expect(city.owner).toBeLessThanOrEqual(2);
            }
            for (const player of state.players) {
              expect(player.gold).toBeGreaterThanOrEqual(0);
              expect(player.goldCarry).toBeGreaterThanOrEqual(0);
            }
            const ids = new Set(state.squads.map((squad) => squad.id));
            expect(ids.size).toBe(state.squads.length);
            for (const squad of state.squads) {
              expect(squad.count).toBeGreaterThan(0);
              expect(squad.arrivalTick).toBeGreaterThan(squad.departTick);
            }
          }
          return true;
        },
      ),
      { numRuns: 25 },
    );
  });
});
