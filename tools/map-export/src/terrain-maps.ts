import type { Level, MapCity, MapDef, MapEdge, Owner, SiteKind, Stance } from "@marchlands/sim";
import { toGridMap } from "./grid-map";
import { withMageSites } from "./mage-sites";

export interface TerrainMapRecipe {
  slug: string;
  name: string;
  seed: number;
  size: [number, number];
  towns: number;
  outposts: number;
  granaries: number;
  minGap: number;
  playerCorner: [number, number];
  /** 地表起伏振幅，米；和客户端地表保持一致。 */
  terrainAmplitude?: number;
  /** 地表噪声种子；不填就用 seed。 */
  terrainSeed?: number;
}

export interface TerrainMapPreset {
  style: "frontier" | "meadow" | "autumn" | "ash" | "coast" | "snow";
  amplitude: number;
  seed: number;
  roadStyle: "cobble" | "dirt";
  foundation: { assetId: string; scale: number; rotation: number; offsetY: number };
  description: string;
}

export const TERRAIN_MAP_PRESETS: Record<string, TerrainMapPreset> = {
  highland01: {
    style: "meadow",
    amplitude: 2.6,
    seed: 4711,
    roadStyle: "cobble",
    foundation: { assetId: "builtin:foundation.terrain003", scale: 0.052, rotation: 24, offsetY: -4.5 },
    description: "岩脊高地：城镇散落在起伏的岩台上，坡道上连着碎石路，谁先站住高处谁就能看清整片谷地。",
  },
  autumnvale01: {
    style: "autumn",
    amplitude: 2.4,
    seed: 923,
    roadStyle: "dirt",
    foundation: { assetId: "builtin:foundation.terrain001", scale: 0.055, rotation: -38, offsetY: -4 },
    description: "秋色谷地：落叶林里藏着三十座城镇，土路沿着缓坡绕行，粮仓卡在谷口。",
  },
  snowpass01: {
    style: "snow",
    amplitude: 2.2,
    seed: 1607,
    roadStyle: "cobble",
    foundation: { assetId: "builtin:foundation.terrain004", scale: 0.05, rotation: 8, offsetY: -5 },
    description: "雪岭关隘：积雪覆盖的山道上，据点沿坡层层设防，翻过垭口才算真正进入对方腹地。",
  },
};

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Placed {
  id: string;
  kind: SiteKind;
  owner: Owner;
  level: Level;
  pop: number;
  pos: [number, number];
  stance?: Stance;
  watch?: [string, string];
}

function distance(a: [number, number], b: [number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

export function buildTerrainMap(recipe: TerrainMapRecipe): MapDef {
  const random = mulberry32(recipe.seed);
  const [width, height] = recipe.size;
  const margin = 140;
  const total = recipe.towns + recipe.outposts + recipe.granaries;

  const points: Array<[number, number]> = [];
  let guard = 0;
  while (points.length < total && guard < 60000) {
    guard += 1;
    const x = margin + random() * (width - margin * 2);
    const z = margin + random() * (height - margin * 2);
    if (points.some((point) => distance(point, [x, z]) < recipe.minGap)) continue;
    points.push([x - width / 2, z - height / 2]);
  }
  if (points.length < total) throw new Error(`${recipe.slug}: 放不下 ${total} 个据点`);

  const corner: [number, number] = [recipe.playerCorner[0] * (width / 2 - margin), recipe.playerCorner[1] * (height / 2 - margin)];
  const farCorner: [number, number] = [-corner[0] * 0.9, -corner[1] * 0.9];

  const towns = points.slice(0, recipe.towns);
  const townOrder = [...towns].sort((a, b) => distance(a, corner) - distance(b, corner));
  const playerStart = townOrder[0];
  const aiStart = [...towns].sort((a, b) => distance(a, farCorner) - distance(b, farCorner))[0];

  const sites: Placed[] = [];
  towns.forEach((pos, index) => {
    const isPlayer = pos === playerStart;
    const isAi = pos === aiStart;
    const level: Level = isPlayer || isAi ? 3 : ((1 + Math.floor(random() * 2.4)) as Level);
    sites.push({
      id: `c${index + 1}`,
      kind: "barbarian",
      owner: isPlayer ? 1 : isAi ? 2 : 0,
      level,
      pop: level * 10,
      pos,
    });
  });

  const rest = points.slice(recipe.towns);
  const townIds = sites.map((site) => site.id);
  for (let index = 0; index < recipe.outposts; index += 1) {
    const pos = rest[index];
    const watch: [string, string] = [
      townIds[Math.floor(random() * townIds.length)],
      townIds[Math.floor(random() * townIds.length)],
    ];
    sites.push({
      id: `o${index + 1}`,
      kind: "outpost",
      owner: 0,
      level: 1,
      pop: 0,
      pos,
      stance: "evade",
      watch: watch[0] === watch[1] ? [watch[0], townIds[(townIds.indexOf(watch[0]) + 1) % townIds.length]] : watch,
    });
  }
  for (let index = 0; index < recipe.granaries; index += 1) {
    sites.push({
      id: `g${index + 1}`,
      kind: "granary",
      owner: 0,
      level: 1,
      pop: 0,
      pos: rest[recipe.outposts + index],
    });
  }

  const neighbours = new Map<string, string[]>();
  for (const site of sites) neighbours.set(site.id, []);
  const link = (a: Placed, b: Placed): void => {
    neighbours.get(a.id)!.push(b.id);
    neighbours.get(b.id)!.push(a.id);
  };

  const byId = new Map(sites.map((site) => [site.id, site]));
  const townsOnly = sites.filter((site) => site.kind === "barbarian");
  const pairOf = (a: Placed, b: Placed) => ({ a, b, d: distance(a.pos, b.pos) });

  const townPairs: Array<{ a: Placed; b: Placed; d: number }> = [];
  for (let i = 0; i < townsOnly.length; i += 1) {
    for (let j = i + 1; j < townsOnly.length; j += 1) {
      townPairs.push(pairOf(townsOnly[i], townsOnly[j]));
    }
  }
  townPairs.sort((left, right) => left.d - right.d);

  const linked = new Set<string>();
  const key = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const addEdge = (a: Placed, b: Placed): void => {
    const id = key(a.id, b.id);
    if (linked.has(id)) return;
    linked.add(id);
    link(a, b);
  };

  const parent = new Map(townsOnly.map((site) => [site.id, site.id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(id, root);
    return root;
  };
  const union = (a: string, b: string): boolean => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return false;
    parent.set(ra, rb);
    return true;
  };

  for (const pair of townPairs) {
    if (union(pair.a.id, pair.b.id)) addEdge(pair.a, pair.b);
  }

  for (const pair of townPairs) {
    if (linked.size >= townsOnly.length * 1.35) break;
    if (random() < 0.22) addEdge(pair.a, pair.b);
  }

  for (const site of sites) {
    if (site.kind === "barbarian") continue;
    const nearest = townsOnly.reduce((best, town) => (distance(town.pos, site.pos) < distance(best.pos, site.pos) ? town : best), townsOnly[0]);
    addEdge(site, nearest);
    if (site.kind === "outpost") {
      const partner = neighbours.get(nearest.id)!.find((id) => byId.get(id)?.kind === "barbarian");
      if (partner) site.watch = [nearest.id, partner];
      site.stance = site.stance === "engage" ? "evade" : "engage";
    }
  }

  const edges: MapEdge[] = [];
  for (const pair of townPairs) {
    if (!linked.has(key(pair.a.id, pair.b.id))) continue;
    edges.push({ from: pair.a.id, to: pair.b.id, length: Math.round(pair.d) });
  }
  for (const site of sites) {
    if (site.kind === "barbarian") continue;
    const other = townsOnly.find((town) => linked.has(key(site.id, town.id)));
    if (other) edges.push({ from: site.id, to: other.id, length: Math.round(distance(site.pos, other.pos)) });
  }

  const cities: MapCity[] = sites.map((site) => ({
    id: site.id,
    kind: site.kind,
    owner: site.owner,
    level: site.level,
    pop: site.pop,
    pos: [Math.round(site.pos[0]), Math.round(site.pos[1])],
    layer: 0,
    ...(site.stance ? { stance: site.stance } : {}),
    ...(site.watch ? { watch: site.watch } : {}),
  }));

  return toGridMap(withMageSites({
    schema: 1,
    slug: recipe.slug,
    name: recipe.name,
    biome: "frontier",
    size: [width, height],
    scale: 0.1,
    ruleset: "1",
    players: [
      { id: 1, name: "Player", color: "green", ai: false },
      { id: 2, name: "AI", color: "red", ai: true },
    ],
    cities,
    edges,
    objectives: [{ type: "capture_all" }, { type: "time_limit", ticks: 18000 }],
  }), {
    stables: 2,
    terrain: { seed: recipe.terrainSeed ?? recipe.seed, amplitude: recipe.terrainAmplitude ?? 1 },
  });
}

export const TERRAIN_MAP_RECIPES: TerrainMapRecipe[] = [
  {
    slug: "highland01",
    name: "Highland 01",
    seed: 4711,
    size: [1700, 1300],
    towns: 22,
    outposts: 9,
    granaries: 4,
    minGap: 158,
    playerCorner: [-0.78, -0.72],
    terrainAmplitude: 2.6,
  },
  {
    slug: "autumnvale01",
    name: "Autumn Vale 01",
    seed: 932,
    size: [1650, 1350],
    towns: 21,
    outposts: 9,
    granaries: 4,
    minGap: 160,
    playerCorner: [0.76, -0.7],
    terrainAmplitude: 2.4,
    terrainSeed: 923,
  },
  {
    slug: "snowpass01",
    name: "Snow Pass 01",
    seed: 1607,
    size: [1600, 1400],
    towns: 20,
    outposts: 10,
    granaries: 4,
    minGap: 162,
    playerCorner: [-0.72, 0.74],
    terrainAmplitude: 2.2,
  },
];
