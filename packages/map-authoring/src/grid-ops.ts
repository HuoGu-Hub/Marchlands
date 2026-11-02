import {
  decodeBitmapBase64,
  encodeBitmapBase64,
  Surface,
} from "@marchlands/nav";
import { cloneDocument } from "./document";
import { gridCellAt } from "./grid";
import type { GridDraft, MapDocument } from "./types";

export type GridBrushMode =
  | "raise"
  | "lower"
  | "smooth"
  | "ramp"
  | "cliff"
  | "water"
  | "surface"
  | "blocker"
  | "passable";

export interface GridBrushOptions {
  readonly mode: GridBrushMode;
  /** 笔刷中心格子。 */
  readonly cell: [number, number];
  /** 笔刷半径，格。 */
  readonly radiusCells: number;
  /** 单次高度变化，厘米。 */
  readonly strengthCm: number;
  /** 坡道起点格子。 */
  readonly startCell?: [number, number];
  /** 地表刷使用的地表枚举。 */
  readonly surface?: number;
}

export function gridCellFromGround(
  document: MapDocument,
  groundDm: [number, number],
): [number, number] | null {
  if (!document.grid) return null;
  return gridCellAt(document.grid, document.size, groundDm);
}

function indexOf(grid: GridDraft, cell: [number, number]): number {
  return cell[1] * grid.width + cell[0];
}

function inBounds(grid: GridDraft, x: number, z: number): boolean {
  return x >= 0 && z >= 0 && x < grid.width && z < grid.height;
}

function clampHeight(value: number): number {
  return Math.max(-32768, Math.min(32767, Math.round(value)));
}

function setBit(bitmap: string, cells: number, index: number, value: boolean): string {
  const flags = decodeBitmapBase64(bitmap, cells);
  flags[index] = value ? 1 : 0;
  return encodeBitmapBase64(flags);
}

function smoothCell(grid: GridDraft, x: number, z: number): number {
  let total = 0;
  let count = 0;
  for (let dz = -1; dz <= 1; dz += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const nx = x + dx;
      const nz = z + dz;
      if (!inBounds(grid, nx, nz)) continue;
      total += grid.heightCm[indexOf(grid, [nx, nz])];
      count += 1;
    }
  }
  return Math.round(total / count);
}

export function applyGridBrush(document: MapDocument, options: GridBrushOptions): MapDocument {
  if (!document.grid) return document;
  const grid = document.grid;
  const cells = grid.width * grid.height;
  const radius = Math.max(1, Math.min(12, Math.round(options.radiusCells)));
  const [cx, cz] = options.cell;
  if (!inBounds(grid, cx, cz)) return document;

  const next = cloneDocument(document);
  const target = next.grid as GridDraft;
  const strength = Math.max(1, Math.round(options.strengthCm));
  const start = options.startCell && inBounds(grid, options.startCell[0], options.startCell[1])
    ? options.startCell
    : [cx, cz] as [number, number];

  if (options.mode === "ramp") {
    const minX = Math.max(0, Math.min(start[0], cx) - radius);
    const maxX = Math.min(target.width - 1, Math.max(start[0], cx) + radius);
    const minZ = Math.max(0, Math.min(start[1], cz) - radius);
    const maxZ = Math.min(target.height - 1, Math.max(start[1], cz) + radius);
    const vx = cx - start[0];
    const vz = cz - start[1];
    const lengthSq = vx * vx + vz * vz;
    for (let z = minZ; z <= maxZ; z += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        let t = 0;
        if (lengthSq > 0) {
          t = Math.max(0, Math.min(1, ((x - start[0]) * vx + (z - start[1]) * vz) / lengthSq));
        }
        const px = start[0] + vx * t;
        const pz = start[1] + vz * t;
        if (Math.hypot(x - px, z - pz) > radius) continue;
        const startHeight = target.heightCm[indexOf(target, start)];
        const endHeight = target.heightCm[indexOf(target, [cx, cz])];
        target.heightCm[indexOf(target, [x, z])] = clampHeight(startHeight + (endHeight - startHeight) * t);
      }
    }
    return next;
  }

  for (let dz = -radius; dz <= radius; dz += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const x = cx + dx;
      const z = cz + dz;
      if (!inBounds(target, x, z)) continue;
      const distance = Math.sqrt(dx * dx + dz * dz);
      if (distance > radius) continue;
      const index = indexOf(target, [x, z]);

      if (options.mode === "blocker") {
        target.blocked = setBit(target.blocked, cells, index, true);
        continue;
      }
      if (options.mode === "passable") {
        target.walkableOverride = setBit(target.walkableOverride, cells, index, true);
        continue;
      }
      if (options.mode === "water") {
        target.surface[index] = Surface.ShallowWater;
        continue;
      }
      if (options.mode === "surface") {
        target.surface[index] = Math.max(0, Math.min(9, Math.round(options.surface ?? 0)));
        continue;
      }
      if (options.mode === "smooth") {
        const average = smoothCell(target, x, z);
        target.heightCm[index] = clampHeight(target.heightCm[index] * 0.5 + average * 0.5);
        continue;
      }
      if (options.mode === "cliff") {
        target.heightCm[index] = clampHeight(target.heightCm[index] + strength);
        continue;
      }

      const falloff = 1 - distance / (radius + 0.5);
      const delta = Math.max(1, Math.round(strength * falloff));
      target.heightCm[index] = clampHeight(
        target.heightCm[index] + (options.mode === "lower" ? -delta : delta),
      );
    }
  }
  return next;
}
