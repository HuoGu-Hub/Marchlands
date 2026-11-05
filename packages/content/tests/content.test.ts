import { describe, expect, it } from "vitest";
import { DEFAULT_RULESET, isProductionSiteKind } from "@marchlands/sim";
import { loadContent } from "../src/node";
import { ContentError, validateContent, validateMap, validateRules } from "../src";
import type { MapCity, MapDef } from "@marchlands/sim";

describe("forest01", () => {
  const { map, rules } = loadContent();

  it("loads nine producing sites, two granaries and two outposts", () => {
    expect(map.cities).toHaveLength(13);
    expect(map.cities.filter((city) => isProductionSiteKind(city.kind))).toHaveLength(9);
    expect(map.cities.filter((city) => city.kind === "granary")).toHaveLength(2);
    expect(map.cities.filter((city) => city.kind === "outpost")).toHaveLength(2);
    expect(map.cities.filter((city) => city.kind === "mage")).toHaveLength(2);
    expect(map.players).toHaveLength(2);
    expect(map.cities.filter((city) => city.owner === 0)).toHaveLength(11);
    expect(map.edges).toHaveLength(20);
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
    expect(length("c4", "g1")).toBe(100);
    expect(length("c4", "o1")).toBe(85);
    expect(map.edges.every((edge) => Number.isInteger(edge.length))).toBe(true);
  });

  it("places buildings as roadside leaves", () => {
    for (const granary of map.cities.filter((city) => city.kind === "granary")) {
      const degree = map.edges.filter((edge) => edge.from === granary.id || edge.to === granary.id);
      expect(degree).toHaveLength(1);
      expect(granary.level).toBe(1);
    }
    for (const outpost of map.cities.filter((city) => city.kind === "outpost")) {
      const degree = map.edges.filter((edge) => edge.from === outpost.id || edge.to === outpost.id);
      expect(degree).toHaveLength(1);
      expect(outpost.level).toBe(1);
      expect(outpost.stance).toBe("evade");
      expect(outpost.watch).toBeTruthy();
      const watch = outpost.watch as [string, string];
      expect(
        map.edges.some(
          (edge) =>
            (edge.from === watch[0] && edge.to === watch[1]) ||
            (edge.from === watch[1] && edge.to === watch[0]),
        ),
      ).toBe(true);
    }
  });

  it("matches the rules default in sim", () => {
    expect(rules).toEqual(DEFAULT_RULESET);
    expect(map.ruleset).toBe(rules.ruleset);
  });
});

describe("crossroads01", () => {
  const { map, rules } = loadContent("maps/crossroads01.json");

  it("loads twenty-two sites with fourteen producing sites", () => {
    expect(map.cities).toHaveLength(22);
    expect(map.cities.filter((city) => isProductionSiteKind(city.kind))).toHaveLength(14);
    expect(map.cities.filter((city) => city.kind === "granary")).toHaveLength(4);
    expect(map.cities.filter((city) => city.kind === "outpost")).toHaveLength(4);
    expect(map.cities.filter((city) => city.kind === "mage")).toHaveLength(2);
    expect(map.cities.filter((city) => city.owner === 0)).toHaveLength(20);
    expect(map.players).toHaveLength(2);
    expect(map.edges).toHaveLength(35);
    expect(map.cities.every((city) => city.layer === 0)).toBe(true);
  });

  it("keeps special buildings as watched roadside leaves", () => {
    for (const granary of map.cities.filter((city) => city.kind === "granary")) {
      expect(map.edges.filter((edge) => edge.from === granary.id || edge.to === granary.id)).toHaveLength(1);
    }
    for (const outpost of map.cities.filter((city) => city.kind === "outpost")) {
      expect(map.edges.filter((edge) => edge.from === outpost.id || edge.to === outpost.id)).toHaveLength(1);
      const watch = outpost.watch as [string, string];
      expect(
        map.edges.some(
          (edge) =>
            (edge.from === watch[0] && edge.to === watch[1]) ||
            (edge.from === watch[1] && edge.to === watch[0]),
        ),
      ).toBe(true);
    }
  });

  it("passes full content validation", () => {
    expect(() => validateContent(map, rules)).not.toThrow();
  });
});

describe("validation", () => {
  const { map, rules } = loadContent();

  it("rejects duplicate city ids", () => {
    const broken: MapDef = {
      ...map,
      cities: [...map.cities, { ...map.cities[0] }],
    };
    expect(() => validateMap(broken)).toThrow(ContentError);
  });

  it("rejects a disconnected graph", () => {
    const towns = map.cities.filter((city) => isProductionSiteKind(city.kind));
    const ids = new Set(towns.map((city) => city.id));
    const townEdges = map.edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to));
    const broken: MapDef = { ...map, cities: towns, edges: [townEdges[0], townEdges[3]] };
    expect(() => validateMap(broken)).toThrow(/not connected/);
  });

  it("rejects an edge length that disagrees with positions", () => {
    const broken: MapDef = {
      ...map,
      edges: map.edges.map((edge, index) => (index === 0 ? { ...edge, length: 999 } : edge)),
    };
    expect(() => validateMap(broken)).toThrow(/does not match positions/);
  });

  it("rejects a duplicate edge", () => {
    const first = map.edges[0];
    const broken: MapDef = { ...map, edges: [...map.edges, { ...first, from: first.to, to: first.from }] };
    expect(() => validateMap(broken)).toThrow(/duplicated/);
  });

  it("rejects a building with more than one road", () => {
    const granary = map.cities.find((city) => city.kind === "granary");
    if (!granary) throw new Error("missing granary");
    const broken: MapDef = {
      ...map,
      edges: [...map.edges, { from: granary.id, to: "c1", length: 63 }],
    };
    expect(() => validateMap(broken)).toThrow(/must be a leaf site/);
  });

  it("rejects an outpost without a watch edge", () => {
    const broken: MapDef = {
      ...map,
      cities: map.cities.map((city) =>
        city.id === "o1" ? ({ ...city, watch: undefined } as MapCity) : city,
      ),
    };
    expect(() => validateMap(broken)).toThrow(/watch must be/);
  });

  it("rejects an outpost watching a road that does not exist", () => {
    const broken: MapDef = {
      ...map,
      cities: map.cities.map((city) =>
        city.id === "o1" ? ({ ...city, watch: ["c1", "c2"] } as MapCity) : city,
      ),
    };
    expect(() => validateMap(broken)).toThrow(/watch edge not found/);
  });

  it("rejects a building with a town level", () => {
    const broken: MapDef = {
      ...map,
      cities: map.cities.map((city) =>
        city.id === "g1" ? ({ ...city, level: 2 } as MapCity) : city,
      ),
    };
    expect(() => validateMap(broken)).toThrow(/level must be 1/);
  });

  it("rejects missing granary and outpost rules", () => {
    const { granary: _granary, ...withoutGranary } = rules;
    expect(() => validateRules(withoutGranary)).toThrow(/granary required/);
    const { outpost: _outpost, ...withoutOutpost } = rules;
    expect(() => validateRules(withoutOutpost)).toThrow(/outpost required/);
  });

  it("rejects a missing or broken supply rule", () => {
    const { supply: _supply, ...withoutSupply } = rules;
    expect(() => validateRules(withoutSupply)).toThrow(/supply required/);
    expect(() =>
      validateRules({ ...rules, supply: { ...rules.supply, starveIntervalTicks: 0 } }),
    ).toThrow(/starveIntervalTicks/);
    expect(() =>
      validateRules({ ...rules, supply: { ...rules.supply, carryTicks: -1 } }),
    ).toThrow(/carryTicks/);
  });

  it("rejects negative granary bonuses and zero decay intervals", () => {
    expect(() =>
      validateRules({ ...rules, granary: { ...rules.granary, speedBonusMilli: -1 } }),
    ).toThrow(/speedBonusMilli/);
    expect(() =>
      validateRules({ ...rules, outpost: { ...rules.outpost, decayIntervalTicks: 0 } }),
    ).toThrow(/decayIntervalTicks/);
  });

  it("rejects an initial garrison above the building capacity", () => {
    const broken: MapDef = {
      ...map,
      cities: map.cities.map((city) =>
        city.id === "g1" ? ({ ...city, pop: rules.granary.capacity + 1 } as MapCity) : city,
      ),
    };
    expect(() => validateContent(broken, rules)).toThrow(/granary capacity/);
  });
});

describe("frontier01", () => {
  const { map } = loadContent("maps/frontier01.json");

  it("builds a forty-two-site frontier with thirty-four producing sites", () => {
    expect(map.cities).toHaveLength(42);
    expect(map.cities.filter((city) => isProductionSiteKind(city.kind))).toHaveLength(34);
    expect(map.cities.filter((city) => city.kind === "granary")).toHaveLength(4);
    expect(map.cities.filter((city) => city.kind === "outpost")).toHaveLength(4);
    expect(map.cities.filter((city) => city.kind === "mage")).toHaveLength(2);
    expect(map.edges).toHaveLength(79);
  });

  it("requires friendly transit", () => {
    expect(map.transit).toBe("friendly");
  });
});
