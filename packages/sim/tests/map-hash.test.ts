import { describe, expect, it } from "vitest";
import { mapHashOf } from "../src";
import { THREE_CITY_MAP } from "./fixtures";

describe("map hash", () => {
  it("is stable and ignores an existing mapHash field", () => {
    const first = mapHashOf(THREE_CITY_MAP);
    expect(first).toMatch(/^[0-9a-f]{16}$/);
    expect(mapHashOf({ ...THREE_CITY_MAP, mapHash: "ffffffffffffffff" })).toBe(first);
  });

  it("changes when map content changes", () => {
    const base = mapHashOf(THREE_CITY_MAP);
    const moved: typeof THREE_CITY_MAP = {
      ...THREE_CITY_MAP,
      cities: THREE_CITY_MAP.cities.map((city) =>
        city.id === "b" ? { ...city, pos: [1, 0] } : city,
      ),
    };
    expect(mapHashOf(moved)).not.toBe(base);
  });
});
