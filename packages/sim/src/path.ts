import type { CityId, MapDef } from "./types";

export interface Route {
  path: CityId[];
  distance: number;
}

interface Adjacency {
  to: CityId;
  length: number;
}

const SEP = "\u0000";

export class MapGraph {
  private readonly adjacency: Map<CityId, Adjacency[]>;
  private readonly cache = new Map<string, Route | null>();

  constructor(map: MapDef) {
    const adjacency = new Map<CityId, Adjacency[]>();
    for (const city of map.cities) adjacency.set(city.id, []);
    for (const edge of map.edges) {
      const from = adjacency.get(edge.from);
      const to = adjacency.get(edge.to);
      if (!from || !to) throw new Error(`edge references unknown city: ${edge.from}-${edge.to}`);
      from.push({ to: edge.to, length: edge.length });
      to.push({ to: edge.from, length: edge.length });
    }
    for (const list of adjacency.values()) {
      list.sort((a, b) => (a.to < b.to ? -1 : a.to > b.to ? 1 : 0));
    }
    this.adjacency = adjacency;
  }

  edgeLength(from: CityId, to: CityId): number | null {
    for (const edge of this.adjacency.get(from) ?? []) {
      if (edge.to === to) return edge.length;
    }
    return null;
  }

  neighbors(from: CityId): CityId[] {
    return (this.adjacency.get(from) ?? []).map((edge) => edge.to);
  }

  route(from: CityId, to: CityId, blocked?: ReadonlySet<CityId>): Route | null {
    if (from === to) return { path: [from], distance: 0 };
    const blockedKey = blocked && blocked.size > 0 ? "|" + [...blocked].sort().join(",") : "";
    const key = `${from}${SEP}${to}${blockedKey}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    const result = this.shortest(from, to, blocked);
    this.cache.set(key, result);
    return result;
  }

  private shortest(from: CityId, to: CityId, blocked?: ReadonlySet<CityId>): Route | null {
    const distance = new Map<CityId, number>();
    const path = new Map<CityId, CityId[]>();
    const visited = new Set<CityId>();
    distance.set(from, 0);
    path.set(from, [from]);

    for (;;) {
      let current: CityId | null = null;
      let bestDistance = Number.POSITIVE_INFINITY;
      let bestKey = "";
      for (const [id, value] of distance) {
        if (visited.has(id)) continue;
        const key = (path.get(id) ?? []).join(SEP);
        if (value < bestDistance || (value === bestDistance && key < bestKey)) {
          current = id;
          bestDistance = value;
          bestKey = key;
        }
      }
      if (current === null) return null;
      if (current === to) {
        const found = path.get(current);
        return found ? { path: found.slice(), distance: bestDistance } : null;
      }
      visited.add(current);
      const base = path.get(current);
      if (!base) continue;
      for (const edge of this.adjacency.get(current) ?? []) {
        if (visited.has(edge.to)) continue;
        if (blocked?.has(edge.to) && edge.to !== to) continue;
        const candidateDistance = bestDistance + edge.length;
        const candidatePath = [...base, edge.to];
        const existing = distance.get(edge.to);
        if (existing === undefined || candidateDistance < existing) {
          distance.set(edge.to, candidateDistance);
          path.set(edge.to, candidatePath);
          continue;
        }
        if (candidateDistance === existing) {
          const candidateKey = candidatePath.join(SEP);
          if (candidateKey < (path.get(edge.to) ?? []).join(SEP)) path.set(edge.to, candidatePath);
        }
      }
    }
  }
}
