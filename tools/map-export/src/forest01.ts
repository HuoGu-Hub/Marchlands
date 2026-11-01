import type { Level, MapCity, MapDef, MapEdge, Owner } from "@marchlands/sim";

interface CitySeed {
  id: string;
  owner: Owner;
  level: Level;
  pop: number;
  pos: [number, number];
}

const CITIES: CitySeed[] = [
  { id: "c1", owner: 1, level: 3, pop: 30, pos: [-220, 0] },
  { id: "c2", owner: 2, level: 2, pop: 20, pos: [220, 0] },
  { id: "c3", owner: 0, level: 2, pop: 20, pos: [0, 0] },
  { id: "c4", owner: 0, level: 1, pop: 10, pos: [-120, 120] },
  { id: "c5", owner: 0, level: 1, pop: 10, pos: [120, 120] },
  { id: "c6", owner: 0, level: 1, pop: 10, pos: [-120, -120] },
  { id: "c7", owner: 0, level: 1, pop: 10, pos: [120, -120] },
];

const EDGES: Array<[string, string]> = [
  ["c1", "c4"],
  ["c1", "c6"],
  ["c1", "c3"],
  ["c2", "c5"],
  ["c2", "c7"],
  ["c2", "c3"],
  ["c4", "c5"],
  ["c6", "c7"],
  ["c4", "c3"],
  ["c5", "c3"],
  ["c6", "c3"],
  ["c7", "c3"],
];

export function buildForest01(): MapDef {
  const byId = new Map(CITIES.map((city) => [city.id, city]));
  const cities: MapCity[] = CITIES.map((city) => ({
    id: city.id,
    kind: "town",
    owner: city.owner,
    level: city.level,
    pop: city.pop,
    pos: [city.pos[0], city.pos[1]],
    layer: 0,
  }));

  const edges: MapEdge[] = EDGES.map(([from, to]) => {
    const a = byId.get(from);
    const b = byId.get(to);
    if (!a || !b) throw new Error(`unknown edge ${from}-${to}`);
    return { from, to, length: Math.round(Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1])) };
  });

  return {
    schema: 1,
    slug: "forest01",
    name: "Forest 01",
    biome: "forest",
    size: [600, 600],
    scale: 0.1,
    ruleset: "1",
    players: [
      { id: 1, name: "Player", color: "green", ai: false },
      { id: 2, name: "AI", color: "red", ai: true },
    ],
    cities,
    edges,
    objectives: [
      { type: "capture_all" },
      { type: "time_limit", ticks: 18000 },
    ],
  };
}
