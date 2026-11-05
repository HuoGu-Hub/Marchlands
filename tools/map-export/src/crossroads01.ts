import type { Level, MapCity, MapDef, MapEdge, Owner, SiteKind, Stance } from "@marchlands/sim";

interface SiteSeed {
  id: string;
  kind: SiteKind;
  owner: Owner;
  level: Level;
  pop: number;
  pos: [number, number];
  stance?: Stance;
  watch?: [string, string];
}

const SITES: SiteSeed[] = [
  { id: "c1", kind: "barbarian", owner: 1, level: 3, pop: 30, pos: [-240, -180] },
  { id: "c2", kind: "ranger", owner: 0, level: 1, pop: 10, pos: [-80, -180] },
  { id: "c3", kind: "warrior", owner: 0, level: 2, pop: 20, pos: [80, -180] },
  { id: "c4", kind: "archer", owner: 0, level: 1, pop: 10, pos: [240, -180] },
  { id: "c5", kind: "barbarian", owner: 0, level: 2, pop: 20, pos: [-240, 0] },
  { id: "c6", kind: "ranger", owner: 0, level: 2, pop: 20, pos: [-80, 0] },
  { id: "c7", kind: "warrior", owner: 0, level: 2, pop: 20, pos: [80, 0] },
  { id: "c8", kind: "archer", owner: 0, level: 2, pop: 20, pos: [240, 0] },
  { id: "c9", kind: "barbarian", owner: 0, level: 1, pop: 10, pos: [-240, 180] },
  { id: "c10", kind: "ranger", owner: 0, level: 2, pop: 20, pos: [-80, 180] },
  { id: "c11", kind: "warrior", owner: 0, level: 1, pop: 10, pos: [80, 180] },
  { id: "c12", kind: "archer", owner: 2, level: 2, pop: 20, pos: [240, 180] },
  { id: "g1", kind: "granary", owner: 0, level: 1, pop: 0, pos: [-240, -260] },
  { id: "g2", kind: "granary", owner: 0, level: 1, pop: 0, pos: [160, 80] },
  { id: "g3", kind: "granary", owner: 0, level: 1, pop: 0, pos: [-160, 240] },
  { id: "g4", kind: "granary", owner: 0, level: 1, pop: 0, pos: [240, 260] },
  {
    id: "o1",
    kind: "outpost",
    owner: 0,
    level: 1,
    pop: 0,
    pos: [-240, 80],
    stance: "evade",
    watch: ["c5", "c6"],
  },
  {
    id: "o2",
    kind: "outpost",
    owner: 0,
    level: 1,
    pop: 0,
    pos: [-80, -240],
    stance: "evade",
    watch: ["c2", "c3"],
  },
  {
    id: "o3",
    kind: "outpost",
    owner: 0,
    level: 1,
    pop: 0,
    pos: [80, 240],
    stance: "evade",
    watch: ["c11", "c12"],
  },
  {
    id: "o4",
    kind: "outpost",
    owner: 0,
    level: 1,
    pop: 0,
    pos: [290, 0],
    stance: "evade",
    watch: ["c4", "c8"],
  },
];

const EDGES: Array<[string, string]> = [
  ["c1", "c2"],
  ["c2", "c3"],
  ["c3", "c4"],
  ["c5", "c6"],
  ["c6", "c7"],
  ["c7", "c8"],
  ["c9", "c10"],
  ["c10", "c11"],
  ["c11", "c12"],
  ["c1", "c5"],
  ["c5", "c9"],
  ["c2", "c6"],
  ["c6", "c10"],
  ["c3", "c7"],
  ["c7", "c11"],
  ["c4", "c8"],
  ["c8", "c12"],
  ["c1", "c6"],
  ["c3", "c6"],
  ["c7", "c12"],
  ["c8", "c11"],
  ["c2", "c5"],
  ["c4", "c7"],
  ["c1", "g1"],
  ["c7", "g2"],
  ["c10", "g3"],
  ["c12", "g4"],
  ["c5", "o1"],
  ["c2", "o2"],
  ["c11", "o3"],
  ["c8", "o4"],
];

export function buildCrossroads01(): MapDef {
  const byId = new Map(SITES.map((site) => [site.id, site]));
  const cities: MapCity[] = SITES.map((site) => ({
    id: site.id,
    kind: site.kind,
    owner: site.owner,
    level: site.level,
    pop: site.pop,
    pos: [site.pos[0], site.pos[1]],
    layer: 0,
    ...(site.stance ? { stance: site.stance } : {}),
    ...(site.watch ? { watch: [site.watch[0], site.watch[1]] } : {}),
  }));

  const edges: MapEdge[] = EDGES.map(([from, to]) => {
    const a = byId.get(from);
    const b = byId.get(to);
    if (!a || !b) throw new Error(`unknown edge ${from}-${to}`);
    return { from, to, length: Math.round(Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1])) };
  });

  return {
    schema: 1,
    slug: "crossroads01",
    name: "Crossroads 01",
    biome: "frontier",
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
