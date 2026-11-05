import type { MapCity, MapDef, MapEdge } from "@marchlands/sim";

function hashText(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 给官方地图补两座中立法师塔：位置按地图 slug 定种子随机挑，
 * 离已有据点至少 70，两座之间至少 200，各自连到最近的两个据点。
 */
export function withMageSites(map: MapDef): MapDef {
  if (map.cities.some((city) => city.kind === "mage")) return map;

  const [width, height] = map.size;
  const margin = 50;
  const step = 20;
  const random = mulberry32(hashText(map.slug));
  const candidates: Array<[number, number]> = [];
  for (let x = -width / 2 + margin; x <= width / 2 - margin; x += step) {
    for (let z = -height / 2 + margin; z <= height / 2 - margin; z += step) {
      let nearest = Infinity;
      for (const city of map.cities) {
        nearest = Math.min(nearest, Math.hypot(city.pos[0] - x, city.pos[1] - z));
      }
      if (nearest >= 70 && nearest <= 150) candidates.push([Math.round(x), Math.round(z)]);
    }
  }

  const picked: Array<[number, number]> = [];
  for (let guard = 0; guard < 400 && picked.length < 2 && candidates.length > 0; guard += 1) {
    const [x, z] = candidates.splice(Math.floor(random() * candidates.length), 1)[0];
    if (picked.every((point) => Math.hypot(point[0] - x, point[1] - z) >= 200)) picked.push([x, z]);
  }
  if (picked.length < 2) return map;

  const cities: MapCity[] = picked.map((pos, index) => ({
    id: "m" + (index + 1),
    kind: "mage",
    owner: 0,
    level: 1,
    pop: 12,
    pos: [pos[0], pos[1]],
    layer: 0,
  }));

  const edges: MapEdge[] = [];
  // 只连生产据点：驻兵点必须是叶子据点，粮仓也不该多接一条边。
  const known: Array<{ id: string; pos: [number, number] }> = map.cities
    .filter((city) => city.kind !== "outpost" && city.kind !== "granary")
    .map((city) => ({ id: city.id, pos: city.pos }));
  for (const city of cities) {
    const nearest = known
      .map((other) => ({ id: other.id, distance: Math.hypot(other.pos[0] - city.pos[0], other.pos[1] - city.pos[1]) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 2);
    for (const link of nearest) {
      edges.push({ from: city.id, to: link.id, length: Math.max(1, Math.round(link.distance)) });
    }
    known.push({ id: city.id, pos: city.pos });
  }

  return { ...map, cities: [...map.cities, ...cities], edges: [...map.edges, ...edges] };
}
