import { createHeightField } from "@marchlands/map-authoring";
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

/** 按地图地形参数采样每格高度，再平滑两遍，避免出现一格一步的断崖。 */
function sampleHeights(
  map: MapDef,
  cols: number,
  rows: number,
  cellSizeCm: number,
  terrain?: { seed: number; amplitude: number },
): Int16Array {
  const cells = cols * rows;
  const out = new Int16Array(cells);
  if (!terrain) return out;
  const field = createHeightField({
    cities: map.cities.map((city) => [city.pos[0], city.pos[1]] as [number, number]),
    terrain: { seed: terrain.seed, amplitude: terrain.amplitude },
  });
  const stepMeters = cellSizeCm / 100;
  let values = new Float32Array(cells);
  for (let z = 0; z < rows; z += 1) {
    for (let x = 0; x < cols; x += 1) {
      const metersX = (x - cols / 2 + 0.5) * stepMeters;
      const metersZ = (z - rows / 2 + 0.5) * stepMeters;
      values[z * cols + x] = field.heightAt(metersX, metersZ);
    }
  }
  for (let pass = 0; pass < 2; pass += 1) {
    const next = new Float32Array(cells);
    for (let z = 0; z < rows; z += 1) {
      for (let x = 0; x < cols; x += 1) {
        let sum = 0;
        let count = 0;
        for (let dz = -1; dz <= 1; dz += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const nx = x + dx;
            const nz = z + dz;
            if (nx < 0 || nz < 0 || nx >= cols || nz >= rows) continue;
            sum += values[nz * cols + nx];
            count += 1;
          }
        }
        next[z * cols + x] = sum / count;
      }
    }
    values = next;
  }
  // 限制相邻格高差：坡再陡也能走，陡坎交给 blocked 标记。
  const MAX_RISE_CM = 70;
  for (let pass = 0; pass < 12; pass += 1) {
    let changed = false;
    for (let z = 0; z < rows; z += 1) {
      for (let x = 0; x < cols; x += 1) {
        const index = z * cols + x;
        const here = values[index];
        for (const [dx, dz] of [[1, 0], [0, 1]] as const) {
          const nx = x + dx;
          const nz = z + dz;
          if (nx >= cols || nz >= rows) continue;
          const neighbor = nz * cols + nx;
          const diff = (values[neighbor] - here) * 100;
          if (Math.abs(diff) <= MAX_RISE_CM) continue;
          const adjust = ((Math.abs(diff) - MAX_RISE_CM) / 2 / 100) * Math.sign(diff);
          values[neighbor] -= adjust;
          values[index] += adjust;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  for (let index = 0; index < cells; index += 1) {
    out[index] = Math.round(values[index] * 100);
  }
  return out;
}

export interface GridOptions {
  /** 每格边长，厘米。 */
  cellSizeCm?: number;
  /** 需要铺进地图的中立产兵据点，例如马厩。 */
  stables?: number;
  /** 地形参数；网格高度按它采样，客户端地表也用同一份。 */
  terrain?: { seed: number; amplitude: number };
  /** 抬升的台地：位置、半径与高度，边缘自动做成陡坡。 */
  plateaus?: Array<{ pos: [number, number]; radiusCm: number; heightCm: number }>;
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

  const surface = new Uint8Array(cells).fill(SURFACE_GRASS);
  const heights = sampleHeights(map, cols, rows, CELL_CM, options.terrain);
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

  // 台地：把一块圆形区域整体抬升，边缘在几格内收拢成陡坡，
  // 重甲单位上不去，轻装和游侠还能爬。
  if (options.plateaus && options.plateaus.length > 0) {
    const cellCm = CELL_CM;
    for (const plateau of options.plateaus) {
      const centerX = (plateau.pos[0] + map.size[0] * 5) / cellCm - 0.5;
      const centerZ = (plateau.pos[1] + map.size[1] * 5) / cellCm - 0.5;
      const radiusCells = plateau.radiusCm / cellCm;
      const reach = Math.ceil(radiusCells) + 5;
      for (let dz = -reach; dz <= reach; dz += 1) {
        for (let dx = -reach; dx <= reach; dx += 1) {
          const cx = Math.round(centerX) + dx;
          const cz = Math.round(centerZ) + dz;
          if (cx < 0 || cz < 0 || cx >= cols || cz >= rows) continue;
          const distance = Math.hypot(cx - centerX, cz - centerZ);
          // 台地边缘是硬边：一格里直接抬起来，才算悬崖，不是缓坡。
          const t = Math.min(1, Math.max(0, radiusCells - distance + 0.5));
          heights[cz * cols + cx] += Math.round(plateau.heightCm * t);
        }
      }
    }
  }

  // 路面走廊压平：路面附近的高程取同一段路的平均值，
  // 否则 18 厘米的路面抬升盖不住一格一格的台阶，路边会露出锯齿。
  const roadCellsList: number[] = [];
  for (let index = 0; index < cells; index += 1) {
    if (surface[index] === SURFACE_ROAD) roadCellsList.push(index);
  }
  if (roadCellsList.length > 0) {
    const corridor = new Int16Array(roadCellsList.length);
    for (let slot = 0; slot < roadCellsList.length; slot += 1) {
      const index = roadCellsList[slot];
      const cx = index % cols;
      const cz = Math.floor(index / cols);
      let sum = 0;
      let count = 0;
      for (let dz = -2; dz <= 2; dz += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          const nx = cx + dx;
          const nz = cz + dz;
          if (nx < 0 || nz < 0 || nx >= cols || nz >= rows) continue;
          sum += heights[nz * cols + nx];
          count += 1;
        }
      }
      corridor[slot] = Math.round(sum / Math.max(1, count));
    }
    // 路面格直接取走廊高度，两侧三格内做几轮平滑，避免路边形成一圈陡坎。
    const nearRoad = new Uint8Array(cells);
    for (let slot = 0; slot < roadCellsList.length; slot += 1) {
      const index = roadCellsList[slot];
      heights[index] = corridor[slot];
      const cx = index % cols;
      const cz = Math.floor(index / cols);
      for (let dz = -3; dz <= 3; dz += 1) {
        for (let dx = -3; dx <= 3; dx += 1) {
          const nx = cx + dx;
          const nz = cz + dz;
          if (nx < 0 || nz < 0 || nx >= cols || nz >= rows) continue;
          nearRoad[nz * cols + nx] = 1;
        }
      }
    }
    for (let pass = 0; pass < 3; pass += 1) {
      const next = Int16Array.from(heights);
      for (let z = 1; z < rows - 1; z += 1) {
        for (let x = 1; x < cols - 1; x += 1) {
          const index = z * cols + x;
          if (!nearRoad[index] || surface[index] === SURFACE_ROAD) continue;
          let sum = 0;
          let count = 0;
          for (let dz = -1; dz <= 1; dz += 1) {
            for (let dx = -1; dx <= 1; dx += 1) {
              sum += heights[(z + dz) * cols + (x + dx)];
              count += 1;
            }
          }
          next[index] = Math.round(sum / count);
        }
      }
      heights.set(next);
    }
  }

  const next: MapDef = {
    ...map,
    schema: 2,
    navigation: "grid",
    ...(options.terrain ? { terrain: { ...options.terrain } } : {}),
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
