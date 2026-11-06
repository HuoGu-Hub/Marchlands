import type { Level, MapCity, MapDef, MapEdge, Owner, SiteKind, Stance } from "@marchlands/sim";
import { toGridMap } from "./grid-map";
import { withMageSites } from "./mage-sites";

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
  { id: "c1", kind: "barbarian", owner: 1, level: 3, pop: 30, pos: [-220, 0] },
  { id: "c2", kind: "ranger", owner: 2, level: 2, pop: 20, pos: [220, 0] },
  { id: "c3", kind: "warrior", owner: 0, level: 2, pop: 20, pos: [0, 0] },
  { id: "c4", kind: "archer", owner: 0, level: 1, pop: 10, pos: [-120, 120] },
  { id: "c5", kind: "barbarian", owner: 0, level: 1, pop: 10, pos: [120, 120] },
  { id: "c6", kind: "ranger", owner: 0, level: 1, pop: 10, pos: [-120, -120] },
  { id: "c7", kind: "warrior", owner: 0, level: 1, pop: 10, pos: [120, -120] },
  { id: "g1", kind: "granary", owner: 0, level: 1, pop: 0, pos: [-200, 60] },
  { id: "g2", kind: "granary", owner: 0, level: 1, pop: 0, pos: [200, 60] },
  {
    id: "o1",
    kind: "outpost",
    owner: 0,
    level: 1,
    pop: 0,
    pos: [-40, 150],
    stance: "evade",
    watch: ["c4", "c5"],
  },
  {
    id: "o2",
    kind: "outpost",
    owner: 0,
    level: 1,
    pop: 0,
    pos: [40, -150],
    stance: "evade",
    watch: ["c6", "c7"],
  },
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
  ["c4", "g1"],
  ["c5", "g2"],
  ["c4", "o1"],
  ["c7", "o2"],
];

export function buildForest01(): MapDef {
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

  return toGridMap(withMageSites({
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
  }), { stables: 2, terrain: { seed: 20261123, amplitude: 1 } });
}
