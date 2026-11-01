import { describe, expect, it } from "vitest";
import { DEFAULT_RULESET } from "@marchlands/sim";
import { loadContent } from "../src/node";
import { ContentError, validateMap } from "../src";
import type { MapDef } from "@marchlands/sim";

describe("forest01", () => {
  const { map, rules } = loadContent();

  it("loads seven cities, two players, five neutrals", () => {
    expect(map.cities).toHaveLength(7);
    expect(map.players).toHaveLength(2);
    expect(map.cities.filter((city) => city.owner === 0)).toHaveLength(5);
    expect(map.edges).toHaveLength(12);
    expect(map.cities.every((city) => city.layer === 0)).toBe(true);
  });

  it("matches the approved starting table", () => {
    const expected = [
      ["c1", 1, 3, 30, [-220, 0]],
      ["c2", 2, 2, 20, [220, 0]],
      ["c3", 0, 2, 20, [0, 0]],
      ["c4", 0, 1, 10, [-120, 120]],
      ["c5", 0, 1, 10, [120, 120]],
      ["c6", 0, 1, 10, [-120, -120]],
      ["c7", 0, 1, 10, [120, -120]],
    ] as const;
    for (const [id, owner, level, pop, pos] of expected) {
      const city = map.cities.find((entry) => entry.id === id);
      expect(city, id).toBeTruthy();
      expect(city?.owner).toBe(owner);
      expect(city?.level).toBe(level);
      expect(city?.pop).toBe(pop);
      expect(city?.pos).toEqual(pos);
    }
  });

  it("stores precomputed integer edge lengths", () => {
    const length = (from: string, to: string) =>
      map.edges.find(
        (edge) =>
          (edge.from === from && edge.to === to) || (edge.from === to && edge.to === from),
      )?.length;
    expect(length("c1", "c4")).toBe(156);
    expect(length("c1", "c3")).toBe(220);
    expect(length("c4", "c3")).toBe(170);
    expect(length("c4", "c5")).toBe(240);
    expect(map.edges.every((edge) => Number.isInteger(edge.length))).toBe(true);
  });

  it("matches the rules default in sim", () => {
    expect(rules).toEqual(DEFAULT_RULESET);
    expect(map.ruleset).toBe(rules.ruleset);
  });
});

describe("validation", () => {
  it("rejects duplicate city ids", () => {
    const { map } = loadContent();
    const broken: MapDef = {
      ...map,
      cities: [...map.cities, { ...map.cities[0] }],
    };
    expect(() => validateMap(broken)).toThrow(ContentError);
  });

  it("rejects a disconnected graph", () => {
    const { map } = loadContent();
    const broken: MapDef = { ...map, edges: [map.edges[0], map.edges[3]] };
    expect(() => validateMap(broken)).toThrow(/not connected/);
  });

  it("rejects an edge length that disagrees with positions", () => {
    const { map } = loadContent();
    const broken: MapDef = {
      ...map,
      edges: map.edges.map((edge, index) => (index === 0 ? { ...edge, length: 999 } : edge)),
    };
    expect(() => validateMap(broken)).toThrow(/does not match positions/);
  });

  it("rejects a duplicate edge", () => {
    const { map } = loadContent();
    const first = map.edges[0];
    const broken: MapDef = { ...map, edges: [...map.edges, { ...first, from: first.to, to: first.from }] };
    expect(() => validateMap(broken)).toThrow(/duplicated/);
  });
});
