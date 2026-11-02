import {
  NavGrid,
  Surface,
  decodeBitmapBase64,
  decodeInt16Base64,
  decodeUint8Base64,
  encodeBitmapBase64,
  encodeInt16Base64,
  encodeUint8Base64,
  findCellPath,
} from "@marchlands/nav";
import type { MapGridDef } from "@marchlands/sim";
import type { GridDraft } from "./types";

export const DEFAULT_CELL_SIZE_DM = 10;
export const DEFAULT_FOOTPRINT_DM = 80;
export const DEFAULT_CAPTURE_RADIUS_DM = 40;

export interface GridDraftOptions {
  readonly cellSizeDm?: number;
  readonly heightCm?: ArrayLike<number>;
  readonly surface?: ArrayLike<number>;
  readonly blocked?: string;
  readonly walkableOverride?: string;
}

export function emptyBitmap(cells: number): string {
  return encodeBitmapBase64(new Uint8Array(cells));
}

export function createGridDraft(size: [number, number], options: GridDraftOptions = {}): GridDraft {
  const cellSizeDm = options.cellSizeDm ?? DEFAULT_CELL_SIZE_DM;
  if (!Number.isInteger(cellSizeDm) || cellSizeDm <= 0) throw new Error("网格尺寸必须是正整数分米");
  if (size[0] % cellSizeDm !== 0 || size[1] % cellSizeDm !== 0) {
    throw new Error("地图尺寸必须能被网格尺寸整除");
  }
  const width = size[0] / cellSizeDm;
  const height = size[1] / cellSizeDm;
  const cells = width * height;

  const heightCm = options.heightCm ? Array.from(options.heightCm) : new Array<number>(cells).fill(0);
  if (heightCm.length !== cells) throw new Error("网格高度数量与格子数不一致");
  for (const value of heightCm) {
    if (!Number.isInteger(value) || value < -32768 || value > 32767) {
      throw new Error("网格高度必须是 -32768 到 32767 的整数厘米");
    }
  }

  const surface = options.surface ? Array.from(options.surface) : new Array<number>(cells).fill(0);
  if (surface.length !== cells) throw new Error("网格地表数量与格子数不一致");
  for (const value of surface) {
    if (!Number.isInteger(value) || value < 0 || value > 9) throw new Error("网格地表必须是 0 到 9");
  }

  const blocked = options.blocked ?? emptyBitmap(cells);
  const walkableOverride = options.walkableOverride ?? emptyBitmap(cells);
  decodeBitmapBase64(blocked, cells);
  decodeBitmapBase64(walkableOverride, cells);

  return { cellSizeDm, width, height, heightCm, surface, blocked, walkableOverride };
}

export function gridIssues(grid: GridDraft, size: [number, number]): string[] {
  const issues: string[] = [];
  if (!Number.isInteger(grid.cellSizeDm) || grid.cellSizeDm <= 0) {
    issues.push("网格尺寸必须是正整数分米");
    return issues;
  }
  if (grid.width * grid.cellSizeDm !== size[0]) issues.push("网格宽度与地图像素尺寸不一致");
  if (grid.height * grid.cellSizeDm !== size[1]) issues.push("网格高度与地图像素尺寸不一致");
  const cells = grid.width * grid.height;
  if (cells <= 0) {
    issues.push("网格必须至少有一个格子");
    return issues;
  }
  if (grid.heightCm.length !== cells) issues.push("网格高度数量与格子数不一致");
  if (grid.surface.length !== cells) issues.push("网格地表数量与格子数不一致");
  for (let index = 0; index < grid.heightCm.length; index += 1) {
    const value = grid.heightCm[index];
    if (!Number.isInteger(value) || value < -32768 || value > 32767) {
      issues.push("网格高度必须是 -32768 到 32767 的整数厘米");
      break;
    }
  }
  for (let index = 0; index < grid.surface.length; index += 1) {
    const value = grid.surface[index];
    if (!Number.isInteger(value) || value < 0 || value > 9) {
      issues.push("网格地表必须是 0 到 9");
      break;
    }
  }
  try {
    decodeBitmapBase64(grid.blocked, cells);
  } catch {
    issues.push("网格阻挡位图无效");
  }
  try {
    decodeBitmapBase64(grid.walkableOverride, cells);
  } catch {
    issues.push("网格可走覆盖位图无效");
  }
  return issues;
}

export function packGridDraft(grid: GridDraft): MapGridDef {
  return {
    cellSizeCm: grid.cellSizeDm * 10,
    width: grid.width,
    height: grid.height,
    heightCm: encodeInt16Base64(grid.heightCm),
    surface: encodeUint8Base64(grid.surface),
    blocked: grid.blocked,
    walkableOverride: grid.walkableOverride,
  };
}

export function unpackGridDef(grid: MapGridDef): GridDraft {
  if (!Number.isInteger(grid.cellSizeCm) || grid.cellSizeCm <= 0 || grid.cellSizeCm % 10 !== 0) {
    throw new Error("网格格子尺寸必须是正整数厘米且能被 10 整除");
  }
  const cells = grid.width * grid.height;
  return {
    cellSizeDm: grid.cellSizeCm / 10,
    width: grid.width,
    height: grid.height,
    heightCm: Array.from(decodeInt16Base64(grid.heightCm, cells)),
    surface: Array.from(decodeUint8Base64(grid.surface, cells)),
    blocked: grid.blocked,
    walkableOverride: grid.walkableOverride,
  };
}

/** 把地图坐标（分米，中心为原点）换算为格子坐标。 */
export function gridCellAt(
  grid: Pick<GridDraft, "cellSizeDm" | "width" | "height">,
  size: [number, number],
  pos: [number, number],
): [number, number] | null {
  const x = Math.floor((pos[0] + size[0] / 2) / grid.cellSizeDm);
  const z = Math.floor((pos[1] + size[1] / 2) / grid.cellSizeDm);
  if (x < 0 || z < 0 || x >= grid.width || z >= grid.height) return null;
  return [x, z];
}

/** 把格子中心换算为地图坐标（分米，中心为原点）。 */
export function gridCellCenter(
  grid: Pick<GridDraft, "cellSizeDm">,
  size: [number, number],
  cell: [number, number],
): [number, number] {
  return [
    -size[0] / 2 + (cell[0] + 0.5) * grid.cellSizeDm,
    -size[1] / 2 + (cell[1] + 0.5) * grid.cellSizeDm,
  ];
}

export interface GridSitePoint {
  readonly id: string;
  readonly pos: [number, number];
}

export interface GridNavigationIssue {
  readonly siteId?: string;
  readonly message: string;
}

export function gridNavigationIssues(
  grid: GridDraft,
  size: [number, number],
  sites: ReadonlyArray<GridSitePoint>,
): GridNavigationIssue[] {
  const cells = grid.width * grid.height;
  const nav = new NavGrid({
    cellSizeCm: grid.cellSizeDm * 10,
    width: grid.width,
    height: grid.height,
    heightCm: grid.heightCm,
    surface: grid.surface,
    blocked: decodeBitmapBase64(grid.blocked, cells),
    walkableOverride: decodeBitmapBase64(grid.walkableOverride, cells),
  });
  const issues: GridNavigationIssue[] = [];
  const reached: Array<{ id: string; index: number }> = [];
  for (const site of sites) {
    const cell = gridCellAt(grid, size, site.pos);
    if (!cell) {
      issues.push({ siteId: site.id, message: `${site.id} 超出网格范围` });
      continue;
    }
    const index = nav.index(cell[0], cell[1]);
    if (!nav.isWalkable(index)) {
      issues.push({ siteId: site.id, message: `${site.id} 所在格不可走` });
      continue;
    }
    reached.push({ id: site.id, index });
  }
  if (reached.length >= 2) {
    const start = reached[0];
    for (let index = 1; index < reached.length; index += 1) {
      const target = reached[index];
      if (!findCellPath(nav, start.index, target.index, { radiusCm: 40 })) {
        issues.push({ siteId: target.id, message: `${start.id} 无法到达 ${target.id}` });
      }
    }
  }
  return issues;
}

/** 把道路栅格化为运行时地表层，不改动编辑器文档。 */
export function rasterizeRoadSurface(
  grid: GridDraft,
  size: [number, number],
  roads: ReadonlyArray<{ path?: Array<[number, number]>; widthDm?: number }>,
): Uint8Array {
  const surface = Uint8Array.from(grid.surface);
  const halfW = size[0] / 2;
  const halfH = size[1] / 2;
  const cell = grid.cellSizeDm;
  for (const road of roads) {
    if (!road.path || road.path.length < 2) continue;
    const radius = Math.max(0.5, (road.widthDm ?? 16) / cell / 2);
    for (let index = 0; index < road.path.length - 1; index += 1) {
      const [ax, az] = road.path[index];
      const [bx, bz] = road.path[index + 1];
      const length = Math.hypot(bx - ax, bz - az);
      const steps = Math.max(1, Math.ceil((length / cell) * 2));
      for (let step = 0; step <= steps; step += 1) {
        const t = step / steps;
        const x = ax + (bx - ax) * t;
        const z = az + (bz - az) * t;
        const cx = Math.floor((x + halfW) / cell);
        const cz = Math.floor((z + halfH) / cell);
        for (let dz = -Math.ceil(radius); dz <= Math.ceil(radius); dz += 1) {
          for (let dx = -Math.ceil(radius); dx <= Math.ceil(radius); dx += 1) {
            if (Math.hypot(dx, dz) > radius) continue;
            const nx = cx + dx;
            const nz = cz + dz;
            if (nx < 0 || nz < 0 || nx >= grid.width || nz >= grid.height) continue;
            const cellIndex = nz * grid.width + nx;
            const current = surface[cellIndex];
            if (current === Surface.ShallowWater || current === Surface.DeepWater) continue;
            surface[cellIndex] = Surface.Road;
          }
        }
      }
    }
  }
  return surface;
}
