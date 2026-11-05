import { describe, expect, it } from "vitest";
import { Surface } from "@marchlands/nav";
import { UNIT_PROFILES, UNIT_TRAITS } from "../src/units";

describe("unit traits", () => {
  it("can wade only when the trait says so", () => {
    for (const [kind, traits] of Object.entries(UNIT_TRAITS)) {
      const surfaces = UNIT_PROFILES[kind as keyof typeof UNIT_PROFILES].surfaces;
      if (traits.flying) continue;
      expect(surfaces.has(Surface.ShallowWater), kind).toBe(traits.river);
    }
  });

  it("flying units ignore every surface", () => {
    const all = Object.values(Surface).length;
    expect(UNIT_PROFILES.mage.surfaces.size).toBe(all);
    expect(UNIT_PROFILES.warrior.surfaces.size).toBeLessThan(all);
  });

  it("heavy infantry cannot cross water", () => {
    expect(UNIT_PROFILES.warrior.surfaces.has(Surface.ShallowWater)).toBe(false);
    expect(UNIT_PROFILES.barbarian.surfaces.has(Surface.ShallowWater)).toBe(true);
    expect(UNIT_PROFILES.archer.surfaces.has(Surface.ShallowWater)).toBe(true);
  });
});
