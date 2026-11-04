import {
  Surface,
  encodeBitmapBase64,
  encodeInt16Base64,
  encodeUint8Base64,
} from "@marchlands/nav";
import type { MapDef, MapGridDef } from "@marchlands/sim";

/** 用场景地形采样出的分米坐标接口，避免与渲染层循环依赖。 */
export interface TerrainSampler {
  hasGround(xDm: number, zDm: number): boolean;
  groundHeight(xDm: number, zDm: number): number;
}

const CELL_SIZE_DM = 10;
const CELL_SIZE_CM = CELL_SIZE_DM * 10;

/**
 * 给旧据点图补一张 1 米网格：高度取自实际地形，水面/悬空处阻挡。
 * 已有网格的地图原样返回。这样据点图也能按格子通行规则寻路和派兵。
 */
export function synthesizeGrid(map: MapDef, sampler: TerrainSampler): MapDef {
  if (map.grid) return map;
  const width = Math.floor(map.size[0] / CELL_SIZE_DM);
  const height = Math.floor(map.size[1] / CELL_SIZE_DM);
  if (width < 2 || height < 2) return map;
  const cells = width * height;
  const heights = new Int16Array(cells);
  const surface = new Uint8Array(cells);
  const blocked = new Uint8Array(cells);
  for (let z = 0; z < height; z += 1) {
    const zDm = -map.size[1] / 2 + (z + 0.5) * CELL_SIZE_DM;
    for (let x = 0; x < width; x += 1) {
      const index = z * width + x;
      const xDm = -map.size[0] / 2 + (x + 0.5) * CELL_SIZE_DM;
      if (!sampler.hasGround(xDm, zDm)) {
        blocked[index] = 1;
        surface[index] = Surface.DeepWater;
        continue;
      }
      const heightCm = Math.round(sampler.groundHeight(xDm, zDm) * 100);
      heights[index] = Math.max(-32768, Math.min(32767, heightCm));
      surface[index] = Surface.Grass;
    }
  }
  const grid: MapGridDef = {
    cellSizeCm: CELL_SIZE_CM,
    width,
    height,
    heightCm: encodeInt16Base64(heights),
    surface: encodeUint8Base64(surface),
    blocked: encodeBitmapBase64(blocked),
    walkableOverride: encodeBitmapBase64(new Uint8Array(cells)),
  };
  return { ...map, grid };
}
