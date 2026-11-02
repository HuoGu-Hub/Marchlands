import { describe, expect, it } from "vitest";
import { createGame, step } from "../src/game";
import type { MapDef } from "../src/types";
import { THREE_CITY_MAP } from "./fixtures";

function mapWith(overrides: Partial<MapDef>): MapDef {
  return { ...THREE_CITY_MAP, transit: "friendly", ...overrides };
}

describe("friendly transit", () => {
  it("blocks a route through a neutral town", () => {
    const state = createGame(mapWith({}), 1);
    const result = step(state, [{ type: "send", from: "a", to: "c" }]);
    expect(result.rejected[0]?.reason).toBe("no_route");
  });

  it("allows a continuous road that bypasses the neutral town", () => {
    const state = createGame(mapWith({ edges: [...THREE_CITY_MAP.edges, { from: "a", to: "c", length: 200 }] }), 1);
    const result = step(state, [{ type: "send", from: "a", to: "c" }]);
    expect(result.rejected).toEqual([]);
    expect(result.state.squads[0]?.path).toEqual(["a", "c"]);
  });

  it("allows a route through a friendly town", () => {
    const map = mapWith({ cities: THREE_CITY_MAP.cities.map((city) => city.id === "b" ? { ...city, owner: 1 } : city) });
    const state = createGame(map, 1);
    const result = step(state, [{ type: "send", from: "a", to: "c" }]);
    expect(result.rejected).toEqual([]);
    expect(result.state.squads[0]?.path).toEqual(["a", "b", "c"]);
  });
});
