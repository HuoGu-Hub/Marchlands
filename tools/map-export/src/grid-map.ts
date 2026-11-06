import { mapHashOf } from "@marchlands/sim";
import type { MapCity, MapDef } from "@marchlands/sim";

const SURFACE_GRASS = 0;
const SURFACE_ROAD = 3;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function encodeBase64(bytes: Uint8Array): string {
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const b0 = bytes[index];
    const has1 = index + 1 < bytes.length;
    const has2 = index + 2 < bytes.length;
    const b1 = has1 ? bytes[index + 1] : 0;
    const b2 = has2 ? bytes[index + 2] : 0;
    output += ALPHABET[b0 >> 2];
    output += ALPHABET[((b0 & 3) << 4) | (b1 >> 4)];
    output += has1 ? ALPHABET[((b1 & 15) << 2) | (b2 >> 6)] : "=";
    output += has2 ? ALPHABET[b2 & 63] : "=";
  }
  return output;
}

function encodeInt16Base64(values: ArrayLike<number>): string {
  const bytes = new Uint8Array(values.length * 2);
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    bytes[index * 2] = value & 255;
    bytes[index * 2 + 1] = (value >> 8) & 255;
  }
  return encodeBase64(bytes);
}

function encodeUint8Base64(values: ArrayLike<number>): string {
  return encodeBase64(Uint8Array.from(Array.from(values)));
}

function encodeBitmapBase64(flags: ArrayLike<number>): string {
  const bytes = new Uint8Array(Math.ceil(flags.length / 8));
  for (let index = 0; index < flags.length; index += 1) {
    if (flags[index]) bytes[index >> 3] |= 1 << (index & 7);
  }
  return encodeBase64(bytes);
}

export interface GridOptions {
  /** 每格边长，厘米。 */
  cellSizeCm?: number;
  /** 需要铺进地图的中立产兵据点，例如马厩。 */
  stables?: number;
}

/**
 * 把"据点 + 边"的地图转成网格地图：
 * 可达性由网格决定，边只负责铺道路格与画路面。
 * 道路格在引擎里既有寻路代价优势，也有 25% 行军速度加成。
 */
export function toGridMap(map: MapDef, options: GridOptions = {}): MapDef {
  const CELL_CM = options.cellSizeCm ?? 100;
  const [width, height] = map.size;
  const cols = Math.round((width * 10) / CELL_CM);
  const rows = Math.round((height * 10) / CELL_CM);
  const cells = cols * rows;

  const heights = new Int16Array(cells);
  const surface = new Uint8Array(cells).fill(SURFACE_GRASS);
  const blocked = new Uint8Array(cells);
  const walkableOverride = new Uint8Array(cells);

  const toCell = (pos: [number, number]): [number, number] => [
    Math.floor((pos[0] * 10 + width * 5) / CELL_CM),
    Math.floor((pos[1] * 10 + height * 5) / CELL_CM),
  ];

  const byId = new Map(map.cities.map((city) => [city.id, city]));
  for (const edge of map.edges ?? []) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) continue;
    const [x0, z0] = toCell(from.pos);
    const [x1, z1] = toCell(to.pos);
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(z1 - z0), 1);
    for (let step = 0; step <= steps; step += 1) {
      const cx = Math.round(x0 + ((x1 - x0) * step) / steps);
      const cz = Math.round(z0 + ((z1 - z0) * step) / steps);
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dz = -1; dz <= 1; dz += 1) {
          const x = cx + dx;
          const z = cz + dz;
          if (x < 0 || z < 0 || x >= cols || z >= rows) continue;
          const index = z * cols + x;
          if (surface[index] === SURFACE_GRASS) surface[index] = SURFACE_ROAD;
        }
      }
    }
  }

  const stables: MapCity[] = [];
  const stableCount = options.stables ?? 0;
  if (stableCount > 0) {
    const candidates: Array<[number, number]> = [];
    for (let z = 4; z < rows - 4; z += 1) {
      for (let x = 4; x < cols - 4; x += 1) {
        const index = z * cols + x;
        if (surface[index] !== SURFACE_GRASS) continue;
        let nearRoad = false;
        for (let dz = -2; dz <= 2 && !nearRoad; dz += 1) {
          for (let dx = -2; dx <= 2 && !nearRoad; dx += 1) {
            const nx = x + dx;
            const nz = z + dz;
            if (nx < 0 || nz < 0 || nx >= cols || nz >= rows) continue;
            if (surface[nz * cols + nx] === SURFACE_ROAD) nearRoad = true;
          }
        }
        if (!nearRoad) continue;
        const px = x - cols / 2 + 0.5;
        const pz = z - rows / 2 + 0.5;
        const farFromCities = map.cities.every(
          (city) => Math.hypot(city.pos[0] / 10 - px, city.pos[1] / 10 - pz) > 6,
        );
        if (farFromCities) candidates.push([x, z]);
      }
    }
    const picked: Array<[number, number]> = [];
    if (candidates.length > 0) {
      picked.push(candidates[Math.floor(candidates.length * 0.31)]);
      let best: [number, number] | null = null;
      let bestDistance = -1;
      for (const [x, z] of candidates) {
        const distance = Math.hypot(x - picked[0][0], z - picked[0][1]);
        if (distance > bestDistance) {
          bestDistance = distance;
          best = [x, z];
        }
      }
      if (best && bestDistance >= 10) picked.push(best);
    }
    picked.slice(0, stableCount).forEach(([x, z], index) => {
      stables.push({
        id: "s" + (index + 1),
        kind: "cavalry",
        owner: 0,
        level: 1,
        pop: 12,
        pos: [Math.round((x - cols / 2 + 0.5) * 10), Math.round((z - rows / 2 + 0.5) * 10)],
        layer: 0,
      } as MapCity);
    });
  }

  const next: MapDef = {
    ...map,
    schema: 2,
    navigation: "grid",
    grid: {
      cellSizeCm: CELL_CM,
      width: cols,
      height: rows,
      heightCm: encodeInt16Base64(heights),
      surface: encodeUint8Base64(surface),
      blocked: encodeBitmapBase64(blocked),
      walkableOverride: encodeBitmapBase64(walkableOverride),
    },
    cities: [...map.cities, ...stables],
  };
  next.mapHash = mapHashOf(next);
  return next;
}
